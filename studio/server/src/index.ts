import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { API_PORT, type CreateRunRequest, type PublishRequest, type RestoreRequest, type TurnRequest } from '@goscene/shared';
import { RunManager, RUNS_ROOT } from './runs.js';

const port = Number(process.env.PORT) || API_PORT;
const runs = new RunManager();
const app = new Hono();
app.use('/api/*', cors());

app.get('/api/health', c => c.json({ ok: true, runs: runs.list().length, runsRoot: RUNS_ROOT }));
app.get('/api/runs', c => c.json(runs.list()));
app.post('/api/runs', async c => {
  const body = (await c.req.json()) as CreateRunRequest;
  if (!body?.brief?.trim()) return c.json({ error: 'brief is required' }, 400);
  try { return c.json(runs.create(body), 201); } catch (e: any) { return c.json({ error: e?.message ?? String(e) }, 500); }
});
app.get('/api/runs/:id', c => { const r = runs.get(c.req.param('id')); return r ? c.json(r.summary) : c.json({ error: 'not found' }, 404); });
app.post('/api/runs/:id/cancel', c => { const s = runs.cancel(c.req.param('id')); return s ? c.json(s) : c.json({ error: 'not found' }, 404); });
app.get('/api/runs/:id/history', c => { const h = runs.history(c.req.param('id')); return h ? c.json(h) : c.json({ error: 'not found' }, 404); });
app.get('/api/runs/:id/history/:hash', c => { if (!runs.get(c.req.param('id'))) return c.json({ error: 'not found' }, 404); const d = runs.commit(c.req.param('id'), c.req.param('hash')); return d ? c.json(d) : c.json({ error: 'unknown commit' }, 404); });
app.post('/api/runs/:id/restore', async c => {
  const body = (await c.req.json()) as RestoreRequest;
  if (!body?.hash) return c.json({ error: 'hash is required' }, 400);
  try {
    const s = runs.restore(c.req.param('id'), body.hash);
    if (s === 'running') return c.json({ error: 'run is in progress; cancel it first' }, 409);
    return s ? c.json(s) : c.json({ error: 'not found' }, 404);
  } catch (e: any) { return c.json({ error: e?.stderr?.toString?.() || e?.message || String(e) }, 400); }
});
app.post('/api/runs/:id/publish', async c => {
  const raw = await c.req.text();
  const body = (raw ? JSON.parse(raw) : {}) as PublishRequest;
  const s = runs.publish(c.req.param('id'), body.targets, `http://localhost:${port}`);
  if (s === 'running') return c.json({ error: 'run or publish in progress' }, 409);
  return s ? c.json(s, 202) : c.json({ error: 'not found' }, 404);
});
// Hosted web builds: COOP/COEP so threaded exports (SharedArrayBuffer) work too.
app.get('/play/:id/*', c => {
  const r = runs.get(c.req.param('id'));
  if (!r) return c.text('not found', 404);
  const root = resolve(r.summary.workspace, 'build', 'web');
  let rel = decodeURIComponent(c.req.path.split(`/play/${c.req.param('id')}/`)[1] ?? '');
  if (!rel) rel = 'index.html';
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep) || !existsSync(abs) || !statSync(abs).isFile()) return c.text('not found', 404);
  const ext = extname(abs).toLowerCase();
  const type = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[ext] ?? 'application/octet-stream';
  return new Response(Readable.toWeb(createReadStream(abs)) as any, { headers: { 'content-type': type, 'content-length': String(statSync(abs).size), 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cross-origin-resource-policy': 'cross-origin', 'cache-control': 'no-cache' } });
});
app.post('/api/runs/:id/turns', async c => {
  const body = (await c.req.json()) as TurnRequest;
  if (!body?.text?.trim()) return c.json({ error: 'text is required' }, 400);
  const s = runs.addTurn(c.req.param('id'), body);
  if (s === 'running') return c.json({ error: 'run is in progress; cancel it first or wait' }, 409);
  return s ? c.json(s, 202) : c.json({ error: 'not found' }, 404);
});
app.post('/api/runs/:id/resume', c => { const s = runs.resume(c.req.param('id')); return s ? c.json(s) : c.json({ error: 'not found or running' }, 404); });
app.post('/api/runs/:id/reply', c => c.json({ error: 'interactive replies are not wired yet' }, 501));
app.get('/api/runs/:id/artifacts', c => runs.get(c.req.param('id')) ? c.json(runs.artifacts(c.req.param('id'))) : c.json({ error: 'not found' }, 404));

app.get('/api/runs/:id/events', c => {
  const r = runs.get(c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const lastId = c.req.header('Last-Event-ID') ?? c.req.query('after');
  let after = lastId ? Number(lastId) || 0 : 0;
  return streamSSE(c, async stream => {
    let closed = false;
    stream.onAbort(() => { closed = true; });
    // Events are sent WITHOUT an `event:` name so EventSource.onmessage receives them all; only the
    // control frames (`ping`, `end`) are named, and the client listens for `end` explicitly.
    const send = async (ev: any) => { await stream.writeSSE({ id: String(ev.seq), data: JSON.stringify(ev) }); after = ev.seq; };
    const end = () => stream.writeSSE({ event: 'end', data: JSON.stringify({ status: r.summary.status }) });
    for (const ev of r.log.after(after)) await send(ev);
    const finished = () => r.summary.status !== 'running' && r.summary.status !== 'queued';
    if (finished()) { await end(); return; }
    const queue: any[] = []; let wake: (() => void) | undefined;
    const unsub = r.log.subscribe(ev => { queue.push(ev); wake?.(); });
    try {
      while (!closed) {
        while (queue.length) await send(queue.shift());
        if (finished() && !queue.length) { await end(); break; }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const woke = await Promise.race([
          new Promise<boolean>(res => { wake = () => res(true); }),
          new Promise<boolean>(res => { timer = setTimeout(() => res(false), 15000); }),
        ]);
        wake = undefined; if (timer) clearTimeout(timer);
        if (!woke && !closed) await stream.writeSSE({ event: 'ping', data: String(Date.now()) });
      }
    } catch { /* client went away mid-write */ } finally { unsub(); }
  });
});

const MIME: Record<string, string> = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.html': 'text/html; charset=utf-8' };
app.get('/api/runs/:id/files/*', c => {
  const r = runs.get(c.req.param('id'));
  if (!r) return c.json({ error: 'not found' }, 404);
  const rel = decodeURIComponent(c.req.path.split('/files/')[1] ?? '');
  const root = resolve(r.summary.workspace);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep) || !existsSync(abs) || !statSync(abs).isFile()) return c.json({ error: 'not found' }, 404);
  const type = MIME[extname(abs).toLowerCase()] ?? 'text/plain; charset=utf-8';
  const size = statSync(abs).size;
  const range = c.req.header('range');
  if (range && type.startsWith('video/')) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    const start = m ? Number(m[1]) : 0; const end = m && m[2] ? Number(m[2]) : size - 1;
    return new Response(Readable.toWeb(createReadStream(abs, { start, end })) as any, { status: 206, headers: { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1) } });
  }
  return new Response(Readable.toWeb(createReadStream(abs)) as any, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'cache-control': 'no-cache' } });
});

serve({ fetch: app.fetch, port }, () => console.log(`GoScene server on http://localhost:${port}  runs=${RUNS_ROOT}`));
