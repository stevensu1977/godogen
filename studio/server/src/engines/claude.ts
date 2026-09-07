import { query } from '@anthropic-ai/claude-agent-sdk';
import { mapClaudeMessage, newMapState } from './claude-map.js';
import { childEnv, type Engine, type EngineResult, type EngineStart } from './types.js';

/** Claude Code as the engine, through the Agent SDK (which drives the installed `claude` binary). */
export const claudeEngine: Engine = {
  kind: 'claude',
  async run({ workspace, brief, resumeSessionId, model, emit, onSession, signal }: EngineStart): Promise<EngineResult> {
    const st = newMapState();
    const abort = new AbortController();
    signal.addEventListener('abort', () => abort.abort(), { once: true });
    const t0 = Date.now();
    let result: EngineResult | undefined;
    const prompt = resumeSessionId
      ? 'The previous turn was interrupted. Re-read README.md and the brief, check the current build state, and continue until the Done criteria are met.'
      : brief;
    try {
      const q = query({
        prompt,
        options: {
          cwd: workspace,
          env: childEnv(),
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          settingSources: ['project'],
          systemPrompt: { type: 'preset', preset: 'claude_code' },
          abortController: abort,
          resume: resumeSessionId,
          model: model ?? process.env.STUDIO_CLAUDE_MODEL ?? 'global.anthropic.claude-fable-5-1',
        },
      });
      for await (const msg of q) {
        const m: any = msg;
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) onSession?.(m.session_id);
        for (const ev of mapClaudeMessage(m, st)) {
          if (ev.type === 'run.finished') result = { status: ev.status === 'finished' ? 'finished' : 'failed', costUsd: ev.costUsd, turns: ev.turns, durationMs: ev.durationMs, summary: ev.summary, error: ev.error };
          else emit(ev);
        }
      }
    } catch (e: any) {
      if (signal.aborted) return { status: 'cancelled', costUsd: 0, turns: st.turns, durationMs: Date.now() - t0 };
      return { status: 'failed', costUsd: 0, turns: st.turns, durationMs: Date.now() - t0, error: e?.message ?? String(e) };
    }
    return result ?? { status: signal.aborted ? 'cancelled' : 'failed', costUsd: 0, turns: st.turns, durationMs: Date.now() - t0, error: signal.aborted ? undefined : 'engine ended without a result' };
  },
};
