/**
 * Vite dev-server plugin that serves the Studio HTTP API from fixtures, so the UI can be developed
 * and verified without the Node server. Enabled by `npm run dev:mock` (STUDIO_MOCK=1).
 *
 * The finished run replays its whole history on connect and closes the stream. The live run plays
 * `LIVE_INTRO` once and then loops `liveLoop()` forever with real delays; a `needs_input` pauses the
 * script until POST /reply arrives. Cancel emits run.finished(cancelled). Runs created via POST get
 * the same script but stop after two loops.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import type { Artifact, RunSummary, StudioEvent } from '@goscene/shared';
import { FINISHED_HISTORY, LIVE_INTRO, RUNS, liveLoop, type Ev, type Step } from './fixtures';

const FILES_DIR = new URL('./files/', import.meta.url).pathname;

const MIME: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

interface RunState {
  run: RunSummary;
  events: StudioEvent[];
  artifacts: Map<string, Artifact>;
  subscribers: Set<ServerResponse>;
  queue: Step[];
  timer?: ReturnType<typeof setTimeout>;
  waitingInput: boolean;
  loopsLeft: number; // Infinity for the fixture live run
  loopsDone: number;
}

class MockStore {
  runs = new Map<string, RunState>();

  constructor() {
    for (const run of Object.values(RUNS)) {
      this.runs.set(run.id, {
        run: { ...run }, events: [], artifacts: new Map(), subscribers: new Set(), queue: [], waitingInput: false, loopsLeft: 0, loopsDone: 0,
      });
    }
    // Finished run: materialise history instantly.
    const fin = this.runs.get('run-duckov')!;
    for (const step of FINISHED_HISTORY) this.emit(fin, step.ev, true);
    fin.run = { ...RUNS['run-duckov'], artifactCount: fin.artifacts.size };
    // Live run: scripted with delays, forever.
    const live = this.runs.get('run-pond')!;
    live.loopsLeft = Infinity;
    live.queue = [...LIVE_INTRO];
    this.schedule(live);
  }

  private emit(st: RunState, ev: Ev, silent = false) {
    const full = { ...ev, seq: st.events.length + 1, runId: st.run.id, ts: new Date().toISOString() } as StudioEvent;
    st.events.push(full);
    this.applyToSummary(st, full);
    if (!silent) {
      const frame = `id: ${full.seq}\ndata: ${JSON.stringify(full)}\n\n`;
      for (const res of st.subscribers) res.write(frame);
      if (full.type === 'run.finished') {
        for (const res of st.subscribers) res.end();
        st.subscribers.clear();
      }
    }
  }

  private applyToSummary(st: RunState, ev: StudioEvent) {
    const r = st.run;
    switch (ev.type) {
      case 'run.started': r.status = 'running'; r.startedAt = ev.ts; break;
      case 'phase': r.phase = ev.phase; break;
      case 'cost': r.costUsd = ev.costUsd; r.turns = ev.turns; break;
      case 'artifact':
        if (ev.change === 'removed') st.artifacts.delete(ev.artifact.id); else st.artifacts.set(ev.artifact.id, ev.artifact);
        r.artifactCount = st.artifacts.size; break;
      case 'needs_input': r.phase = 'waiting_input'; break;
      case 'run.finished':
        r.status = ev.status; r.finishedAt = ev.ts; r.costUsd = ev.costUsd; r.turns = ev.turns;
        r.phase = ev.status === 'finished' ? 'done' : 'failed'; break;
    }
  }

  private schedule(st: RunState) {
    if (st.timer || st.waitingInput || st.run.status !== 'running') return;
    if (st.queue.length === 0) {
      if (st.loopsDone >= st.loopsLeft) {
        this.emit(st, { type: 'phase', phase: 'done' });
        this.emit(st, { type: 'run.finished', status: 'finished', costUsd: st.run.costUsd, turns: st.run.turns, durationMs: Date.now() - Date.parse(st.run.startedAt ?? st.run.createdAt), summary: 'Mock run complete.' });
        return;
      }
      st.queue = liveLoop();
      st.loopsDone += 1;
    }
    const step = st.queue.shift()!;
    st.timer = setTimeout(() => {
      st.timer = undefined;
      this.emit(st, step.ev);
      if (step.ev.type === 'needs_input') {
        st.waitingInput = true;
        // Demo convenience: don't stall the fixture run forever if nobody replies.
        setTimeout(() => { if (st.waitingInput) this.reply(st, '(no reply after 60s — mock continues)'); }, 60_000);
      }
      this.schedule(st);
    }, step.delay);
  }

  create(body: { brief: string; title?: string; engine?: RunSummary['engine']; agent?: RunSummary['agent'] }): RunSummary {
    const id = `run-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    const run: RunSummary = {
      id, title: body.title?.trim() || body.brief.slice(0, 48).trim(), brief: body.brief, engine: body.engine ?? 'godot', agent: body.agent ?? 'claude',
      status: 'running', phase: 'idle', createdAt: now, costUsd: 0, turns: 0, workspace: `/srv/studio/runs/${id}`, artifactCount: 0,
    };
    const st: RunState = { run, events: [], artifacts: new Map(), subscribers: new Set(), queue: [], waitingInput: false, loopsLeft: 2, loopsDone: 0 };
    st.queue = LIVE_INTRO.map((s, i) => (i === 0 ? { delay: 400, ev: { type: 'run.started', run } } : s));
    this.runs.set(id, st);
    this.schedule(st);
    return run;
  }

  cancel(st: RunState) {
    if (st.run.status !== 'running') return st.run;
    if (st.timer) clearTimeout(st.timer);
    st.timer = undefined;
    st.waitingInput = false;
    this.emit(st, { type: 'log', level: 'warn', text: 'cancel requested by user' });
    this.emit(st, { type: 'run.finished', status: 'cancelled', costUsd: st.run.costUsd, turns: st.run.turns, durationMs: Date.now() - Date.parse(st.run.startedAt ?? st.run.createdAt), summary: 'Cancelled by user.' });
    return st.run;
  }

  reply(st: RunState, text: string) {
    this.emit(st, { type: 'log', level: 'info', text: `user reply: ${text}` });
    if (st.waitingInput) {
      st.waitingInput = false;
      st.queue.unshift({ delay: 300, ev: { type: 'phase', phase: 'thinking' } }, { delay: 600, ev: { type: 'message', messageId: `reply-${Date.now()}`, delta: `Got it — "${text}". Continuing.`, final: true } });
      this.schedule(st);
    }
  }

  subscribe(st: RunState, res: ServerResponse, after: number) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': studio mock\n\n');
    for (const ev of st.events) if (ev.seq > after) res.write(`id: ${ev.seq}\ndata: ${JSON.stringify(ev)}\n\n`);
    if (st.run.status !== 'running' && st.run.status !== 'queued') { res.end(); return; }
    st.subscribers.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    res.on('close', () => { clearInterval(ping); st.subscribers.delete(res); });
  }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => { try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); } });
  });
}

function serveFile(req: IncomingMessage, res: ServerResponse, rel: string) {
  const safe = normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, '');
  const abs = join(FILES_DIR, safe);
  if (!abs.startsWith(FILES_DIR) || !existsSync(abs) || !statSync(abs).isFile()) { json(res, 404, { error: 'file not found', path: rel }); return; }
  const size = statSync(abs).size;
  const type = MIME[extname(abs).toLowerCase()] ?? 'text/plain; charset=utf-8';
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' });
    createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  createReadStream(abs).pipe(res);
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'studio-mock-api',
    configureServer(server) {
      const store = new MockStore();
      server.config.logger.info('[studio-mock] serving fixture API at /api (runs: run-duckov finished, run-pond live)');
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();
        const parts = url.pathname.split('/').filter(Boolean); // ['api','runs',id,...]
        const method = req.method ?? 'GET';

        if (parts[1] !== 'runs') return json(res, 404, { error: 'not found' });
        if (parts.length === 2) {
          if (method === 'GET') return json(res, 200, [...store.runs.values()].map((s) => s.run).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
          if (method === 'POST') {
            const body = (await readBody(req)) as { brief?: string; title?: string; engine?: RunSummary['engine']; agent?: RunSummary['agent'] };
            if (!body.brief?.trim()) return json(res, 400, { error: 'brief is required' });
            return json(res, 201, store.create({ ...body, brief: body.brief }));
          }
        }
        const st = store.runs.get(parts[2]);
        if (!st) return json(res, 404, { error: 'run not found' });
        const sub = parts[3];
        if (!sub && method === 'GET') return json(res, 200, st.run);
        if (sub === 'events') {
          const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0) || 0;
          return store.subscribe(st, res, after);
        }
        if (sub === 'artifacts') return json(res, 200, [...st.artifacts.values()]);
        if (sub === 'files') return serveFile(req, res, parts.slice(4).join('/'));
        if (sub === 'cancel' && method === 'POST') return json(res, 200, store.cancel(st));
        if (sub === 'reply' && method === 'POST') {
          const body = (await readBody(req)) as { text?: string };
          store.reply(st, String(body.text ?? ''));
          res.writeHead(202); return res.end();
        }
        return json(res, 404, { error: 'not found' });
      });
    },
  };
}
