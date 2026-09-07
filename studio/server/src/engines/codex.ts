import { spawn } from 'node:child_process';
import { phaseForTool } from '@goscene/shared';
import { childEnv, tail, type Engine, type EngineResult, type EngineStart } from './types.js';

/**
 * Codex CLI as the engine: `codex exec --json` prints JSONL events (thread.started, turn.*, item.*).
 * Mapping is best-effort against the 0.13x event shape; unknown items become log lines.
 */
export const codexEngine: Engine = {
  kind: 'codex',
  run({ workspace, prompt, resumeSessionId, model, env, emit, onSession, signal }: EngineStart): Promise<EngineResult> {
    return new Promise((resolve) => {
      const t0 = Date.now();
      let turns = 0; let costUsd = 0; let summary = ''; let msgN = 0; const msgPrefix = `${Date.now().toString(36)}-`;
      const m = model ?? process.env.STUDIO_CODEX_MODEL;
      const common = ['--json', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '-C', workspace, ...(m ? ['-m', m] : [])];
      const args = resumeSessionId ? ['exec', 'resume', resumeSessionId, ...common, '-'] : ['exec', ...common, '-'];
      const child = spawn('codex', args, { env: childEnv(env), cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end(prompt);
      signal.addEventListener('abort', () => child.kill('SIGTERM'), { once: true });
      let buf = '';
      child.stdout.on('data', (d) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          let ev: any; try { ev = JSON.parse(line); } catch { emit({ type: 'log', level: 'info', text: line.slice(0, 500) }); continue; }
          const t = ev.type as string;
          if (t === 'thread.started') { onSession?.(ev.thread_id); emit({ type: 'log', level: 'info', text: `Codex thread ${ev.thread_id}` }); emit({ type: 'phase', phase: 'thinking' }); }
          else if (t === 'turn.completed') { const u = ev.usage ?? {}; emit({ type: 'cost', costUsd, turns, inputTokens: u.input_tokens, outputTokens: u.output_tokens }); }
          else if (t === 'item.started' || t === 'item.completed') {
            const it = ev.item ?? {}; const kind = it.type as string; const id = it.id ?? `codex-${turns}`;
            if (kind === 'agent_message' && t === 'item.completed') { const mid = `${msgPrefix}m${++msgN}`; summary = it.text ?? ''; emit({ type: 'message', messageId: mid, delta: it.text ?? '' }); emit({ type: 'message', messageId: mid, delta: '', final: true }); }
            else if (kind === 'command_execution') {
              if (t === 'item.started') { turns++; const input = { command: it.command ?? '' }; emit({ type: 'tool.call', toolCallId: id, tool: 'shell', title: String(it.command ?? '').split('\n')[0].slice(0, 120), input }); emit({ type: 'phase', phase: phaseForTool('shell', input) }); }
              else emit({ type: 'tool.result', toolCallId: id, ok: (it.exit_code ?? 0) === 0, output: tail(it.aggregated_output ?? '') });
            } else if (kind === 'file_change' && t === 'item.completed') {
              turns++; const files = (it.changes ?? []).map((c: any) => `${c.kind ?? 'edit'} ${c.path}`).join(', ');
              emit({ type: 'tool.call', toolCallId: id, tool: 'Edit', title: `Edit ${files}`.slice(0, 120), input: { changes: it.changes ?? [] } }); emit({ type: 'phase', phase: 'writing' });
              emit({ type: 'tool.result', toolCallId: id, ok: it.status !== 'failed', output: files });
            } else if (kind === 'reasoning' && t === 'item.completed') { emit({ type: 'phase', phase: 'thinking', detail: (it.text ?? '').slice(0, 120) }); }
            else if (t === 'item.completed') emit({ type: 'log', level: 'info', text: `${kind}: ${JSON.stringify(it).slice(0, 300)}` });
          } else if (t === 'error') emit({ type: 'log', level: 'error', text: ev.message ?? line.slice(0, 500) });
        }
      });
      let err = '';
      child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
      child.on('close', (code) => {
        if (signal.aborted) return resolve({ status: 'cancelled', costUsd, turns, durationMs: Date.now() - t0 });
        resolve(code === 0 ? { status: 'finished', costUsd, turns, durationMs: Date.now() - t0, summary } : { status: 'failed', costUsd, turns, durationMs: Date.now() - t0, error: tail(err, 2000) || `codex exited ${code}` });
      });
      child.on('error', (e) => resolve({ status: 'failed', costUsd, turns, durationMs: Date.now() - t0, error: e.message }));
    });
  },
};
