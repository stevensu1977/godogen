/**
 * Reduces the StudioEvent stream into UI state: a run summary, an ordered timeline, artifacts,
 * cost and phase. Streaming message deltas are merged by messageId; tool results attach to their call.
 */
import type { Artifact, Phase, PublishResult, PublishTarget, RunStatus, RunSummary, StudioEvent } from '@goscene/shared';

export type TimelineItem =
  | { kind: 'message'; key: string; messageId: string; text: string; final: boolean; ts: string }
  | { kind: 'tool'; key: string; toolCallId: string; tool: string; title: string; input: Record<string, unknown>; ts: string; output?: string; ok?: boolean; durationMs?: number; phase: Phase }
  | { kind: 'phase'; key: string; phase: Phase; detail?: string; ts: string }
  | { kind: 'needs_input'; key: string; prompt: string; options?: string[]; ts: string; answered?: string }
  | { kind: 'log'; key: string; level: 'info' | 'warn' | 'error'; text: string; ts: string }
  | { kind: 'finished'; key: string; status: Exclude<RunStatus, 'queued' | 'running'>; summary?: string; error?: string; durationMs: number; ts: string; commit?: string; commitFiles?: number }
  | { kind: 'turn'; key: string; index: number; text: string; ts: string }
  | { kind: 'restored'; key: string; toShort: string; toSubject: string; turnIndex?: number; commit: string; ts: string }
  | { kind: 'publish'; key: string; result: PublishResult; ts: string }
  | { kind: 'publish_started'; key: string; targets: PublishTarget[]; ts: string };

export type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed';

export interface RunState {
  run?: RunSummary;
  items: TimelineItem[];
  artifacts: Artifact[];
  /** Artifact ids that arrived over the live stream (for the "new" highlight). */
  freshArtifactIds: string[];
  phase: Phase;
  phaseDetail?: string;
  costUsd: number;
  turns: number;
  inputTokens?: number;
  outputTokens?: number;
  finished?: { status: Exclude<RunStatus, 'queued' | 'running'>; summary?: string; error?: string; durationMs: number };
  pendingInput?: { key: string; prompt: string; options?: string[] };
  connection: Connection;
  lastSeq: number;
  error?: string;
  publish: Partial<Record<PublishTarget, PublishResult>>;
  publishing: boolean;
}

export const initialRunState = (run?: RunSummary): RunState => ({
  run,
  items: [],
  artifacts: [],
  freshArtifactIds: [],
  phase: run?.phase ?? 'idle',
  costUsd: run?.costUsd ?? 0,
  turns: run?.turns ?? 0,
  connection: 'connecting',
  lastSeq: 0,
  publish: run?.publish ?? {},
  publishing: !!run?.publishing,
});

export type Action =
  | { type: 'event'; event: StudioEvent; live: boolean }
  | { type: 'run'; run: RunSummary }
  | { type: 'artifacts'; artifacts: Artifact[] }
  | { type: 'connection'; connection: Connection; error?: string }
  | { type: 'answered'; key: string; text: string }
  | { type: 'unfresh'; ids: string[] };

function upsertArtifact(list: Artifact[], a: Artifact, change: 'added' | 'updated' | 'removed'): Artifact[] {
  const idx = list.findIndex((x) => x.id === a.id || x.path === a.path);
  if (change === 'removed') return idx >= 0 ? [...list.slice(0, idx), ...list.slice(idx + 1)] : list;
  if (idx >= 0) { const next = list.slice(); next[idx] = a; return next; }
  return [...list, a];
}

export function reduce(state: RunState, action: Action): RunState {
  switch (action.type) {
    case 'run': {
      const active = action.run.status === 'running' || action.run.status === 'queued';
      return { ...state, run: action.run, phase: state.items.length && !active ? state.phase : action.run.phase, costUsd: Math.max(state.costUsd, action.run.costUsd), turns: Math.max(state.turns, action.run.turns), finished: active ? undefined : state.finished, publish: { ...state.publish, ...(action.run.publish ?? {}) }, publishing: !!action.run.publishing };
    }
    case 'artifacts': {
      // Initial load; merge with anything already seen from the stream.
      let list = state.artifacts;
      for (const a of action.artifacts) list = upsertArtifact(list, a, 'added');
      return { ...state, artifacts: list };
    }
    case 'connection':
      return { ...state, connection: action.connection, error: action.error };
    case 'answered':
      return {
        ...state,
        pendingInput: state.pendingInput?.key === action.key ? undefined : state.pendingInput,
        items: state.items.map((it) => (it.kind === 'needs_input' && it.key === action.key ? { ...it, answered: action.text } : it)),
      };
    case 'unfresh':
      return { ...state, freshArtifactIds: state.freshArtifactIds.filter((id) => !action.ids.includes(id)) };
    case 'event':
      return applyEvent(state, action.event, action.live);
  }
}

function applyEvent(state: RunState, ev: StudioEvent, live: boolean): RunState {
  if (ev.seq <= state.lastSeq) return state; // duplicate after reconnect
  const base = { ...state, lastSeq: ev.seq };
  const key = `e${ev.seq}`;
  switch (ev.type) {
    case 'run.started':
      return { ...base, run: { ...ev.run, ...(state.run && state.run.status !== 'queued' ? {} : {}) }, phase: state.phase === 'idle' ? ev.run.phase : state.phase };
    case 'message': {
      const idx = base.items.findIndex((it) => it.kind === 'message' && it.messageId === ev.messageId);
      if (idx >= 0) {
        const cur = base.items[idx] as Extract<TimelineItem, { kind: 'message' }>;
        const items = base.items.slice();
        items[idx] = { ...cur, text: cur.text + ev.delta, final: cur.final || !!ev.final };
        return { ...base, items };
      }
      return { ...base, items: [...base.items, { kind: 'message', key, messageId: ev.messageId, text: ev.delta, final: !!ev.final, ts: ev.ts }] };
    }
    case 'phase': {
      const items = base.items;
      const last = items[items.length - 1];
      // Collapse consecutive identical phase separators.
      const dup = last?.kind === 'phase' && last.phase === ev.phase && last.detail === ev.detail;
      return { ...base, phase: ev.phase, phaseDetail: ev.detail, items: dup ? items : [...items, { kind: 'phase', key, phase: ev.phase, detail: ev.detail, ts: ev.ts }] };
    }
    case 'tool.call':
      return { ...base, items: [...base.items, { kind: 'tool', key, toolCallId: ev.toolCallId, tool: ev.tool, title: ev.title, input: ev.input, ts: ev.ts, phase: state.phase }] };
    case 'tool.result': {
      const idx = base.items.findIndex((it) => it.kind === 'tool' && it.toolCallId === ev.toolCallId);
      if (idx < 0) return { ...base, items: [...base.items, { kind: 'tool', key, toolCallId: ev.toolCallId, tool: 'tool', title: ev.toolCallId, input: {}, ts: ev.ts, output: ev.output, ok: ev.ok, durationMs: ev.durationMs, phase: state.phase }] };
      const items = base.items.slice();
      items[idx] = { ...(items[idx] as Extract<TimelineItem, { kind: 'tool' }>), output: ev.output, ok: ev.ok, durationMs: ev.durationMs };
      return { ...base, items };
    }
    case 'artifact': {
      const artifacts = upsertArtifact(base.artifacts, ev.artifact, ev.change);
      const fresh = live && ev.change !== 'removed' ? [...base.freshArtifactIds.filter((id) => id !== ev.artifact.id), ev.artifact.id] : base.freshArtifactIds;
      return { ...base, artifacts, freshArtifactIds: fresh, run: base.run ? { ...base.run, artifactCount: artifacts.length } : base.run };
    }
    case 'cost':
      return { ...base, costUsd: ev.costUsd, turns: ev.turns, inputTokens: ev.inputTokens ?? base.inputTokens, outputTokens: ev.outputTokens ?? base.outputTokens };
    case 'needs_input':
      return { ...base, phase: 'waiting_input', pendingInput: { key, prompt: ev.prompt, options: ev.options }, items: [...base.items, { kind: 'needs_input', key, prompt: ev.prompt, options: ev.options, ts: ev.ts }] };
    case 'log':
      return { ...base, items: [...base.items, { kind: 'log', key, level: ev.level, text: ev.text, ts: ev.ts }] };
    case 'publish.started':
      return { ...base, publishing: true, items: [...base.items, { kind: 'publish_started', key, targets: ev.targets, ts: ev.ts }] };
    case 'publish.result': {
      const publish = { ...base.publish, [ev.result.target]: ev.result };
      return { ...base, publish, publishing: false, items: [...base.items, { kind: 'publish', key, result: ev.result, ts: ev.ts }] };
    }
    case 'workspace.restored':
      return { ...base, items: [...base.items, { kind: 'restored', key, toShort: ev.toShort, toSubject: ev.toSubject, turnIndex: ev.turnIndex, commit: ev.commit, ts: ev.ts }] };
    case 'turn.started': {
      const run = base.run ? { ...base.run, status: 'running' as RunStatus, phase: 'thinking' as Phase, finishedAt: undefined } : base.run;
      return { ...base, run, phase: 'thinking', phaseDetail: undefined, finished: undefined, pendingInput: undefined, items: [...base.items, { kind: 'turn', key, index: ev.index, text: ev.text, ts: ev.ts }] };
    }
    case 'run.finished': {
      const phase: Phase = ev.status === 'finished' ? 'done' : 'failed';
      const run = base.run ? { ...base.run, status: ev.status, phase, costUsd: ev.costUsd, turns: ev.turns, finishedAt: ev.ts } : base.run;
      return {
        ...base, run, phase, costUsd: ev.costUsd, turns: ev.turns, pendingInput: undefined,
        finished: { status: ev.status, summary: ev.summary, error: ev.error, durationMs: ev.durationMs },
        items: [...base.items, { kind: 'finished', key, status: ev.status, summary: ev.summary, error: ev.error, durationMs: ev.durationMs, ts: ev.ts, commit: ev.commit, commitFiles: ev.commitFiles }],
      };
    }
  }
}
