/**
 * Godogen Studio event model.
 *
 * The one contract between engines (Claude Code, Codex, ...), the server and the web UI. Engines never
 * leak their native event formats past their adapter; the UI never consumes anything but these.
 * Each run persists its events as append-only JSONL (`events.jsonl`) so a run can be replayed,
 * resumed after a crash, and audited.
 */

export type EngineKind = 'claude' | 'codex';
export type EngineName = 'godot' | 'bevy' | 'babylon';

/** Coarse state of the agent, driving the "working" animation in the UI. Derived from tool events. */
export type Phase =
  | 'idle'
  | 'thinking'
  | 'reading'
  | 'command'
  | 'writing'
  | 'blender'
  | 'godot'
  | 'capturing'
  | 'reviewing'
  | 'waiting_input'
  | 'done'
  | 'failed';

export type ArtifactKind = 'code' | 'image' | 'video' | 'model' | 'doc' | 'other';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  /** Path relative to the run workspace, always forward slashes. */
  path: string;
  bytes: number;
  /** ISO time the file was first seen or last changed. */
  updatedAt: string;
  /** Tool call that produced it, when known. */
  toolCallId?: string;
  /** Short human title (basename by default). */
  title: string;
}

export type RunStatus = 'queued' | 'running' | 'finished' | 'failed' | 'cancelled';

/** One engine session on the run's workspace. Turn 1 is the brief; later turns are follow-up instructions. */
export interface RunTurn {
  id: string;
  index: number;
  text: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  costUsd: number;
}

export interface RunSummary {
  id: string;
  title: string;
  brief: string;
  engine: EngineName;
  agent: EngineKind;
  status: RunStatus;
  phase: Phase;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  costUsd: number;
  turns: number;
  /** Absolute workspace directory on the server. */
  workspace: string;
  /** Engine session id, when the engine supports resume. */
  sessionId?: string;
  model?: string;
  artifactCount: number;
  /** Turn history; `costUsd` above is the sum over turns. */
  turns_history?: RunTurn[];
}

interface Base {
  /** Monotonic sequence within the run; the SSE `id` field. */
  seq: number;
  runId: string;
  ts: string;
}

export type StudioEvent =
  | (Base & { type: 'run.started'; run: RunSummary })
  /** A turn ended. Not terminal for the run: a follow-up turn may start later (see turn.started). */
  | (Base & { type: 'run.finished'; status: Exclude<RunStatus, 'queued' | 'running'>; costUsd: number; turns: number; durationMs: number; summary?: string; error?: string; turnId?: string })
  /** A follow-up turn started on the same workspace, resuming the engine session when possible. */
  | (Base & { type: 'turn.started'; turnId: string; index: number; text: string })
  /** Assistant text for humans, streamed. `final` closes the message. */
  | (Base & { type: 'message'; messageId: string; delta: string; final?: boolean })
  | (Base & { type: 'phase'; phase: Phase; detail?: string })
  | (Base & { type: 'tool.call'; toolCallId: string; tool: string; title: string; input: Record<string, unknown> })
  | (Base & { type: 'tool.result'; toolCallId: string; ok: boolean; /** Tail of the output, capped. */ output: string; durationMs?: number })
  | (Base & { type: 'artifact'; artifact: Artifact; change: 'added' | 'updated' | 'removed' })
  | (Base & { type: 'cost'; costUsd: number; turns: number; inputTokens?: number; outputTokens?: number })
  | (Base & { type: 'needs_input'; prompt: string; options?: string[] })
  | (Base & { type: 'log'; level: 'info' | 'warn' | 'error'; text: string });

export type StudioEventType = StudioEvent['type'];

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
/** A StudioEvent before the log stamps seq/runId/ts. Distributive so the discriminant survives. */
export type StudioEventInput = DistributiveOmit<StudioEvent, 'seq' | 'runId' | 'ts'>;

/** Request body for POST /api/runs. */
export interface CreateRunRequest {
  title?: string;
  brief: string;
  engine?: EngineName;
  agent?: EngineKind;
  /** Optional budget in USD; the server cancels the engine when exceeded. */
  budgetUsd?: number;
  /** Engine-specific model id; server default when omitted (STUDIO_CLAUDE_MODEL / STUDIO_CODEX_MODEL). */
  model?: string;
}

export interface ReplyRequest { text: string }
/** Body for POST /api/runs/:id/turns — a follow-up instruction on a run that is not running. */
export interface TurnRequest { text: string; model?: string }

/**
 * HTTP API (server, default port 4700):
 *   GET  /api/runs                         -> RunSummary[]
 *   POST /api/runs                         -> RunSummary            (CreateRunRequest)
 *   GET  /api/runs/:id                     -> RunSummary
 *   GET  /api/runs/:id/events              -> SSE; replays from `Last-Event-ID` (or ?after=seq), then live.
 *                                             Each SSE frame: `id: <seq>` and `data: <StudioEvent JSON>`.
 *   GET  /api/runs/:id/artifacts           -> Artifact[]
 *   GET  /api/runs/:id/files/<path>        -> raw file from the workspace (code text, PNG, MP4, GLB)
 *   POST /api/runs/:id/turns               -> RunSummary (202) | 409 while running   (TurnRequest)
 *   POST /api/runs/:id/cancel              -> RunSummary
 *   POST /api/runs/:id/reply               -> 202              (ReplyRequest; answers a needs_input)
 */
export const API_PORT = 4700;

export function classifyArtifact(relPath: string): ArtifactKind {
  const ext = relPath.toLowerCase().split('.').pop() ?? '';
  if (['glb', 'gltf'].includes(ext)) return 'model';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'avi', 'mov'].includes(ext)) return 'video';
  if (['md', 'txt'].includes(ext)) return 'doc';
  if (['cs', 'gd', 'ts', 'tsx', 'js', 'py', 'rs', 'tscn', 'godot', 'csproj', 'json', 'cfg', 'sh', 'gdshader', 'toml', 'yaml', 'yml', 'html', 'css'].includes(ext)) return 'code';
  return 'other';
}

export function phaseForTool(tool: string, input: Record<string, unknown>): Phase {
  const cmd = String(input.command ?? input.cmd ?? '').toLowerCase();
  if (tool === 'Read' || tool === 'Glob' || tool === 'Grep') return 'reading';
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return 'writing';
  if (tool === 'Bash' || tool === 'shell' || tool === 'exec') {
    if (/blender/.test(cmd)) return 'blender';
    if (/write-movie|xvfb-run|ffmpeg|record/.test(cmd)) return 'capturing';
    if (/godot|dotnet build|cargo|npm run build|vite/.test(cmd)) return 'godot';
    return 'command';
  }
  return 'command';
}
