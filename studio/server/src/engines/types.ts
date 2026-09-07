import type {StudioEvent, StudioEventInput } from '@goscene/shared';

export type Emit = (partial: StudioEventInput) => void;

export interface EngineStart {
  workspace: string;
  /** The instruction for this turn (turn 1: the brief). */
  prompt: string;
  resumeSessionId?: string;
  model?: string;
  emit: Emit;
  onSession?: (sessionId: string) => void;
  signal: AbortSignal;
}

export interface EngineResult { status: 'finished' | 'failed' | 'cancelled'; costUsd: number; turns: number; durationMs: number; summary?: string; error?: string }

export interface Engine { kind: 'claude' | 'codex'; run(start: EngineStart): Promise<EngineResult> }

/** Env for child engines: strip the nesting markers of the Claude Code session that may be hosting us. */
export function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.CLAUDECODE; delete env.CLAUDE_CODE_CHILD_SESSION; delete env.CLAUDE_CODE_MESSAGING_SOCKET; delete env.CLAUDE_CODE_MESSAGING_TOKEN;
  env.DOTNET_ROOT ??= `${env.HOME}/.dotnet`;
  if (!env.PATH?.includes('/.dotnet')) env.PATH = `${env.HOME}/.dotnet:${env.PATH}`;
  env.BLENDER_BIN ??= `${env.HOME}/godot-agent/.tools/blender/blender`;
  return env;
}

export const OUTPUT_TAIL = 4000;
export function tail(s: string, n = OUTPUT_TAIL) { return s.length > n ? '…' + s.slice(-n) : s; }
