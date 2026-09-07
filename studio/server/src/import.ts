/**
 * Import an existing godogen run (workspace + `claude -p --output-format stream-json` log) as a Studio run.
 * Usage: npm run import -- <workspace> <stream.jsonl> [title] [more stream.jsonl...]
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolve } from 'node:path';
import type {RunSummary, StudioEvent, StudioEventInput } from '@godogen/shared';
import { mapClaudeMessage, newMapState } from './engines/claude-map.js';
import { RunManager } from './runs.js';

const [workspaceArg, ...rest] = process.argv.slice(2);
if (!workspaceArg || !rest.length) { console.error('usage: import <workspace> <stream.jsonl> [title] [more.jsonl...]'); process.exit(1); }
const logs = rest.filter(a => a.endsWith('.jsonl')); const title = rest.find(a => !a.endsWith('.jsonl')) ?? workspaceArg.split('/').pop()!;
const workspace = resolve(workspaceArg);
const mgr = new RunManager();
const id = `import-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const events: StudioEventInput[] = [];
let brief = ''; let cost = 0; let turns = 0; let first: string | undefined; let last: string | undefined; let sessionId: string | undefined; let summary: string | undefined;
for (const file of logs) {
  const st = newMapState();
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue; let msg: any; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'user' && typeof msg.message?.content === 'string' && !brief) brief = msg.message.content;
    first ??= msg.timestamp; last = msg.timestamp ?? last;
    for (const ev of mapClaudeMessage(msg, st)) {
      if (ev.type === 'run.finished') { cost += ev.costUsd; turns += ev.turns; summary = ev.summary ?? summary; continue; }
      events.push(ev);
    }
  }
  sessionId = st.sessionId ?? sessionId;
}
for (const a of mgr.scanArtifacts(workspace)) events.push({ type: 'artifact', artifact: a, change: 'added' });
events.push({ type: 'phase', phase: 'done' });
events.push({ type: 'run.finished', status: 'finished', costUsd: cost, turns, durationMs: first && last ? Date.parse(last) - Date.parse(first) : 0, summary });
if (!brief && existsSync(join(workspace, 'BRIEF.md'))) brief = readFileSync(join(workspace, 'BRIEF.md'), 'utf-8');
const run: RunSummary = { id, title, brief: brief || `(imported from ${logs.join(', ')})`, engine: 'godot', agent: 'claude', status: 'finished', phase: 'done', createdAt: first ?? new Date().toISOString(), startedAt: first, finishedAt: last, costUsd: cost, turns, workspace, sessionId, artifactCount: 0 };
mgr.register(run, [{ type: 'run.started', run }, ...events]);
console.log(`imported ${id}: ${events.length} events, $${cost.toFixed(2)}, ${mgr.artifacts(id).length} artifacts, workspace ${workspace}`);
