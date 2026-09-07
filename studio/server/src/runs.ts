import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
const shortId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 6);
import type {Artifact, CreateRunRequest, RunSummary, StudioEvent, StudioEventInput } from '@godogen/shared';
import { EventLog } from './events.js';
import { claudeEngine } from './engines/claude.js';
import { codexEngine } from './engines/codex.js';
import type { Engine } from './engines/types.js';
import { toArtifact, watchWorkspace } from './watcher.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GODOGEN_ROOT = resolve(HERE, '..', '..', '..');
export const RUNS_ROOT = process.env.STUDIO_RUNS_ROOT ?? join(homedir(), 'godogen-runs');

interface RunRecord { summary: RunSummary; log: EventLog; artifacts: Map<string, Artifact>; abort?: AbortController; closeWatcher?: () => void; }

const ENGINES: Record<string, Engine> = { claude: claudeEngine, codex: codexEngine };

export class RunManager {
  private runs = new Map<string, RunRecord>();

  constructor() {
    mkdirSync(RUNS_ROOT, { recursive: true });
    for (const id of readdirSync(RUNS_ROOT)) {
      const meta = join(RUNS_ROOT, id, 'run.json');
      if (!existsSync(meta)) continue;
      try {
        const summary = JSON.parse(readFileSync(meta, 'utf-8')) as RunSummary;
        if (summary.status === 'running' || summary.status === 'queued') { summary.status = 'failed'; summary.phase = 'failed'; }
        const log = new EventLog(join(RUNS_ROOT, id, 'events.jsonl'), id);
        const artifacts = new Map<string, Artifact>();
        for (const ev of log.all()) if (ev.type === 'artifact') { if (ev.change === 'removed') artifacts.delete(ev.artifact.id); else artifacts.set(ev.artifact.id, ev.artifact); }
        summary.artifactCount = artifacts.size;
        this.runs.set(id, { summary, log, artifacts });
      } catch (e) { console.error(`skip run ${id}:`, e); }
    }
  }

  list(): RunSummary[] { return [...this.runs.values()].map(r => r.summary).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id: string) { return this.runs.get(id); }
  artifacts(id: string) { return [...(this.runs.get(id)?.artifacts.values() ?? [])]; }

  private save(r: RunRecord) { writeFileSync(join(RUNS_ROOT, r.summary.id, 'run.json'), JSON.stringify(r.summary, null, 2)); }

  private emitter(r: RunRecord) {
    return (partial: StudioEventInput) => {
      const ev = r.log.append(partial);
      if (ev.type === 'phase') r.summary.phase = ev.phase;
      if (ev.type === 'cost') { r.summary.costUsd = ev.costUsd; r.summary.turns = ev.turns; }
      if (ev.type === 'tool.call') r.summary.turns++;
      if (ev.type === 'artifact') { if (ev.change === 'removed') r.artifacts.delete(ev.artifact.id); else r.artifacts.set(ev.artifact.id, ev.artifact); r.summary.artifactCount = r.artifacts.size; }
      if (ev.type === 'needs_input') r.summary.phase = 'waiting_input';
    };
  }

  /** Publish the godogen runtime into a fresh workspace, write the brief, start the engine. */
  create(req: CreateRunRequest): RunSummary {
    const id = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${shortId()}`;
    const engine = req.engine ?? 'godot';
    const agent = req.agent ?? 'claude';
    const dir = join(RUNS_ROOT, id); const workspace = join(dir, 'workspace');
    mkdirSync(workspace, { recursive: true });
    execFileSync(join(GODOGEN_ROOT, 'publish.sh'), ['--engine', engine, '--agent', agent, '--out', workspace], { stdio: 'pipe' });
    writeFileSync(join(workspace, 'BRIEF.md'), req.brief.trim() + '\n');
    const summary: RunSummary = {
      id, title: req.title?.trim() || req.brief.trim().split('\n')[0].slice(0, 80), brief: req.brief, engine, agent,
      status: 'queued', phase: 'idle', createdAt: new Date().toISOString(), costUsd: 0, turns: 0, workspace, artifactCount: 0, model: req.model,
    };
    const r: RunRecord = { summary, log: new EventLog(join(dir, 'events.jsonl'), id), artifacts: new Map() };
    this.runs.set(id, r); this.save(r);
    void this.start(r, req.budgetUsd);
    return summary;
  }

  private async start(r: RunRecord, budgetUsd?: number, resume = false) {
    const emit = this.emitter(r);
    const engine = ENGINES[r.summary.agent];
    r.abort = new AbortController();
    r.summary.status = 'running'; r.summary.startedAt = new Date().toISOString(); this.save(r);
    emit({ type: 'run.started', run: r.summary });
    const watcher = watchWorkspace(r.summary.workspace, (a, change) => emit({ type: 'artifact', artifact: a, change }));
    r.closeWatcher = () => { void watcher.close(); };
    const budgetGuard = budgetUsd ? r.log.subscribe(ev => { if (ev.type === 'cost' && ev.costUsd > budgetUsd) { emit({ type: 'log', level: 'warn', text: `Budget $${budgetUsd} exceeded, cancelling` }); r.abort?.abort(); } }) : undefined;
    const brief = readFileSync(join(r.summary.workspace, 'BRIEF.md'), 'utf-8');
    const result = await engine.run({ workspace: r.summary.workspace, brief, model: r.summary.model, emit, signal: r.abort.signal, resumeSessionId: resume ? r.summary.sessionId : undefined, onSession: sid => { r.summary.sessionId = sid; this.save(r); } });
    budgetGuard?.();
    // Give the watcher a moment to flush the last files, then close.
    await new Promise(res => setTimeout(res, 1500));
    r.closeWatcher?.(); r.closeWatcher = undefined;
    r.summary.status = result.status; r.summary.finishedAt = new Date().toISOString();
    r.summary.phase = result.status === 'finished' ? 'done' : result.status === 'cancelled' ? 'idle' : 'failed';
    if (result.costUsd) r.summary.costUsd = result.costUsd;
    if (result.turns) r.summary.turns = result.turns;
    this.save(r);
    emit({ type: 'run.finished', status: result.status, costUsd: r.summary.costUsd, turns: r.summary.turns, durationMs: result.durationMs, summary: result.summary, error: result.error });
  }

  cancel(id: string) { const r = this.runs.get(id); if (!r) return undefined; r.abort?.abort(); r.summary.status = 'cancelled'; return r.summary; }

  /** Resume a failed/cancelled run in place (Claude sessions support it). */
  resume(id: string) { const r = this.runs.get(id); if (!r || r.summary.status === 'running') return undefined; void this.start(r, undefined, !!r.summary.sessionId); return r.summary; }

  /** Register an existing workspace + event log as a run (used by the importer). */
  register(summary: RunSummary, events: StudioEventInput[]) {
    const dir = join(RUNS_ROOT, summary.id); mkdirSync(dir, { recursive: true });
    const r: RunRecord = { summary, log: new EventLog(join(dir, 'events.jsonl'), summary.id), artifacts: new Map() };
    // Cost/turn events inside an imported log are per-session; the caller's totals win over what emit() derives.
    const totals = { costUsd: summary.costUsd, turns: summary.turns, status: summary.status, phase: summary.phase };
    const emit = this.emitter(r);
    for (const ev of events) emit(ev);
    Object.assign(r.summary, totals);
    this.runs.set(summary.id, r); this.save(r);
    return r;
  }

  scanArtifacts(workspace: string): Artifact[] {
    const out: Artifact[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 6) return;
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, name.name);
        if (name.isDirectory()) { if (!['.git', '.godot', 'bin', 'obj', 'node_modules', '.claude', '.agents', 'video', 'sequence', 'net', 'preview'].includes(name.name)) walk(abs, depth + 1); }
        else { const a = toArtifact(workspace, abs); if (a) out.push(a); }
      }
    };
    walk(workspace, 0);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }
}
