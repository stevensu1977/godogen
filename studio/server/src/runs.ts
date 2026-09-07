import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * One commit per turn: everything the agent changed on the workspace during this turn, whether or not the agent
 * committed anything itself. Returns undefined when the tree is clean.
 */
function autoCommit(workspace: string, turn: RunTurn, runTitle: string): { commit: string; files: number } | undefined {
  const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try { git('rev-parse', '--is-inside-work-tree'); } catch { git('init', '-q'); }
  git('add', '-A');
  const staged = git('diff', '--cached', '--name-only');
  if (!staged) return undefined;
  const files = staged.split('\n').filter(Boolean).length;
  const first = turn.text.split('\n').find(l => l.trim())?.trim().replace(/^#+\s*/, '') ?? 'turn';
  const subject = `Turn ${turn.index}: ${first}`.slice(0, 72);
  const body = `${runTitle}\n\nInstruction:\n${turn.text.trim()}\n\nStatus: ${turn.status} · cost $${turn.costUsd.toFixed(2)} · committed by Godogen Studio`;
  const author = process.env.STUDIO_GIT_AUTHOR ?? 'Godogen Studio <studio@godogen.local>';
  git('-c', `user.name=${author.replace(/\s*<.*$/, '')}`, '-c', `user.email=${/<(.*)>/.exec(author)?.[1] ?? 'studio@godogen.local'}`, 'commit', '-q', '-m', subject, '-m', body);
  return { commit: git('rev-parse', '--short', 'HEAD'), files };
}

function current(r: RunRecord): RunTurn | undefined { const h = r.summary.turns_history; return h && h.length ? h[h.length - 1] : undefined; }
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customAlphabet } from 'nanoid';
const shortId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 6);
import type { Artifact, CreateRunRequest, RunSummary, RunTurn, StudioEventInput, TurnRequest } from '@godogen/shared';
import { EventLog } from './events.js';
import { claudeEngine } from './engines/claude.js';
import { codexEngine } from './engines/codex.js';
import type { Engine } from './engines/types.js';
import { toArtifact, watchWorkspace } from './watcher.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const GODOGEN_ROOT = resolve(HERE, '..', '..', '..');
export const RUNS_ROOT = process.env.STUDIO_RUNS_ROOT ?? join(homedir(), 'godogen-runs');

interface RunRecord { summary: RunSummary; log: EventLog; artifacts: Map<string, Artifact>; abort?: AbortController; closeWatcher?: () => void; /** cost of finished turns; live cost events add to it */ costBase: number; }

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
        // Runs recorded before turn history existed: their whole log is turn 1.
        if (!summary.turns_history?.length) summary.turns_history = [{ id: 't1-legacy', index: 1, text: summary.brief, startedAt: summary.startedAt ?? summary.createdAt, finishedAt: summary.finishedAt, status: summary.status, costUsd: summary.costUsd }];
        this.runs.set(id, { summary, log, artifacts, costBase: summary.costUsd });
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
      if (ev.type === 'cost') { r.summary.costUsd = r.costBase + ev.costUsd; r.summary.turns = ev.turns; const t = current(r); if (t) t.costUsd = ev.costUsd; }
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
      status: 'queued', phase: 'idle', createdAt: new Date().toISOString(), costUsd: 0, turns: 0, workspace, artifactCount: 0, model: req.model, turns_history: [],
    };
    const r: RunRecord = { summary, log: new EventLog(join(dir, 'events.jsonl'), id), artifacts: new Map(), costBase: 0 };
    this.runs.set(id, r); this.save(r);
    void this.start(r, this.newTurn(r, req.brief.trim()), req.budgetUsd);
    return summary;
  }

  private newTurn(r: RunRecord, text: string): RunTurn {
    r.summary.turns_history ??= [];
    const turn: RunTurn = { id: `t${r.summary.turns_history.length + 1}-${shortId()}`, index: r.summary.turns_history.length + 1, text, startedAt: new Date().toISOString(), status: 'queued', costUsd: 0 };
    r.summary.turns_history.push(turn);
    return turn;
  }

  /** Follow-up instruction on a run that is not running: same workspace, engine session resumed when known. */
  addTurn(id: string, req: TurnRequest): RunSummary | 'running' | undefined {
    const r = this.runs.get(id);
    if (!r) return undefined;
    if (r.summary.status === 'running' || r.summary.status === 'queued') return 'running';
    const text = req.text.trim(); if (!text) return undefined;
    if (req.model) r.summary.model = req.model;
    r.costBase = r.summary.costUsd;
    void this.start(r, this.newTurn(r, text));
    return r.summary;
  }

  private async start(r: RunRecord, turn: RunTurn, budgetUsd?: number) {
    const emit = this.emitter(r);
    const engine = ENGINES[r.summary.agent];
    r.abort = new AbortController();
    r.summary.status = 'running'; r.summary.startedAt ??= new Date().toISOString(); r.summary.finishedAt = undefined; turn.status = 'running'; this.save(r);
    const firstTurn = r.log.seq === 0;
    if (firstTurn) emit({ type: 'run.started', run: r.summary });
    else emit({ type: 'turn.started', turnId: turn.id, index: turn.index, text: turn.text });
    const resumeSessionId = firstTurn ? undefined : r.summary.sessionId;
    const watcher = watchWorkspace(r.summary.workspace, (a, change) => emit({ type: 'artifact', artifact: a, change }));
    r.closeWatcher = () => { void watcher.close(); };
    const budgetGuard = budgetUsd ? r.log.subscribe(ev => { if (ev.type === 'cost' && ev.costUsd > budgetUsd) { emit({ type: 'log', level: 'warn', text: `Budget $${budgetUsd} exceeded, cancelling` }); r.abort?.abort(); } }) : undefined;
    const result = await engine.run({ workspace: r.summary.workspace, prompt: turn.text, model: r.summary.model, emit, signal: r.abort.signal, resumeSessionId, onSession: sid => { r.summary.sessionId = sid; this.save(r); } });
    budgetGuard?.();
    // Give the watcher a moment to flush the last files, then close.
    await new Promise(res => setTimeout(res, 1500));
    r.closeWatcher?.(); r.closeWatcher = undefined;
    r.summary.status = result.status; r.summary.finishedAt = new Date().toISOString();
    r.summary.phase = result.status === 'finished' ? 'done' : result.status === 'cancelled' ? 'idle' : 'failed';
    if (result.costUsd) { turn.costUsd = result.costUsd; r.summary.costUsd = r.costBase + result.costUsd; }
    if (result.turns) r.summary.turns = result.turns;
    turn.status = result.status; turn.finishedAt = r.summary.finishedAt;
    let committed: { commit: string; files: number } | undefined;
    try {
      committed = autoCommit(r.summary.workspace, turn, r.summary.title);
      if (committed) { turn.commit = committed.commit; turn.commitFiles = committed.files; emit({ type: 'log', level: 'info', text: `Committed ${committed.commit}: turn ${turn.index}, ${committed.files} file${committed.files === 1 ? '' : 's'}` }); }
      else emit({ type: 'log', level: 'info', text: `Turn ${turn.index}: nothing to commit` });
    } catch (e: any) { emit({ type: 'log', level: 'warn', text: `Auto-commit failed: ${e?.stderr?.toString?.() || e?.message || e}` }); }
    this.save(r);
    emit({ type: 'run.finished', status: result.status, costUsd: r.summary.costUsd, turns: r.summary.turns, durationMs: result.durationMs, summary: result.summary, error: result.error, turnId: turn.id, commit: committed?.commit, commitFiles: committed?.files });
  }

  cancel(id: string) { const r = this.runs.get(id); if (!r) return undefined; r.abort?.abort(); r.summary.status = 'cancelled'; return r.summary; }

  /** Resume a failed/cancelled run in place as a new turn with a generic continue instruction. */
  resume(id: string) { return this.addTurn(id, { text: 'The previous turn was interrupted. Re-read README.md and the brief, check the current build state, and continue until the Done criteria are met.' }); }

  /** Register an existing workspace + event log as a run (used by the importer). */
  register(summary: RunSummary, events: StudioEventInput[]) {
    const dir = join(RUNS_ROOT, summary.id); mkdirSync(dir, { recursive: true });
    const r: RunRecord = { summary, log: new EventLog(join(dir, 'events.jsonl'), summary.id), artifacts: new Map(), costBase: 0 };
    // Cost/turn events inside an imported log are per-session; the caller's totals win over what emit() derives.
    const totals = { costUsd: summary.costUsd, turns: summary.turns, status: summary.status, phase: summary.phase };
    const emit = this.emitter(r);
    for (const ev of events) emit(ev);
    Object.assign(r.summary, totals); r.costBase = totals.costUsd;
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
