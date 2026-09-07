/**
 * Pure mapper from Claude Code messages (Agent SDK `SDKMessage`, identical to `claude -p --output-format
 * stream-json` lines) to Studio events. Shared by the live engine and the importer.
 */
import { phaseForTool, type Phase, type StudioEvent, type StudioEventInput } from '@godogen/shared';
import { tail } from './types.js';

type Partial = StudioEventInput;

export interface MapState {
  sessionId?: string;
  /** stream index -> messageId for text blocks currently streaming */
  textBlocks: Map<number, string>;
  toolInputs: Map<number, { id: string; name: string; json: string }>;
  toolNames: Map<string, string>;
  toolStarted: Map<string, number>;
  lastPhase: Phase;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  msgCounter: number;
}
export function newMapState(): MapState {
  return { textBlocks: new Map(), toolInputs: new Map(), toolNames: new Map(), toolStarted: new Map(), lastPhase: 'idle', turns: 0, inputTokens: 0, outputTokens: 0, msgCounter: 0 };
}

function toolTitle(name: string, input: Record<string, unknown>): string {
  const p = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (name) {
    case 'Bash': return (p('description') || p('command')).split('\n')[0].slice(0, 120);
    case 'Read': return `Read ${short(p('file_path'))}`;
    case 'Write': return `Write ${short(p('file_path'))}`;
    case 'Edit': case 'MultiEdit': return `Edit ${short(p('file_path'))}`;
    case 'Glob': return `Glob ${p('pattern')}`;
    case 'Grep': return `Grep ${p('pattern')}`;
    case 'Agent': case 'Task': return `Subagent: ${p('description') || p('prompt').slice(0, 80)}`;
    case 'WebFetch': return `Fetch ${p('url')}`;
    default: return name;
  }
}
function short(path: string) { return path.replace(/^\/home\/[^/]+\//, '~/').replace(/^.*\/(?=[^/]+\/[^/]+$)/, '…/'); }

function phaseFor(name: string, input: Record<string, unknown>): Phase {
  if (name === 'Read' && /\.(png|jpe?g|webp|gif|mp4)$/i.test(String(input.file_path ?? ''))) return 'reviewing';
  return phaseForTool(name, input);
}

/** Map one message; returns the Studio events it produces (may be several or none). */
export function mapClaudeMessage(msg: any, st: MapState): Partial[] {
  const out: Partial[] = [];
  const phase = (p: Phase, detail?: string) => { if (p !== st.lastPhase) { st.lastPhase = p; out.push({ type: 'phase', phase: p, detail }); } };
  const sub = msg.parent_tool_use_id ? ' (subagent)' : '';

  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') { st.sessionId = msg.session_id; out.push({ type: 'log', level: 'info', text: `Claude Code ${msg.claude_code_version ?? ''} session ${msg.session_id} model ${msg.model ?? ''}`.trim() }); phase('thinking'); }
      break;
    }
    case 'stream_event': {
      const ev = msg.event;
      if (ev?.type === 'content_block_start') {
        if (ev.content_block?.type === 'text') { const id = `m${++st.msgCounter}`; st.textBlocks.set(ev.index, id); phase('thinking'); }
        else if (ev.content_block?.type === 'tool_use') st.toolInputs.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
      } else if (ev?.type === 'content_block_delta') {
        if (ev.delta?.type === 'text_delta') { const id = st.textBlocks.get(ev.index); if (id && ev.delta.text) out.push({ type: 'message', messageId: id, delta: ev.delta.text }); }
        else if (ev.delta?.type === 'input_json_delta') { const t = st.toolInputs.get(ev.index); if (t) t.json += ev.delta.partial_json ?? ''; }
      } else if (ev?.type === 'content_block_stop') {
        const id = st.textBlocks.get(ev.index); if (id) { out.push({ type: 'message', messageId: id, delta: '', final: true }); st.textBlocks.delete(ev.index); }
        const t = st.toolInputs.get(ev.index);
        if (t) { st.toolInputs.delete(ev.index); if (!st.toolNames.has(t.id)) { let input: Record<string, unknown> = {}; try { input = JSON.parse(t.json || '{}'); } catch { input = { raw: t.json }; } out.push(...toolCall(t.id, t.name, input, sub, st, phase)); } }
      } else if (ev?.type === 'message_delta' && ev.usage) { st.outputTokens += ev.usage.output_tokens ?? 0; }
      break;
    }
    case 'assistant': {
      const m = msg.message ?? {};
      if (m.usage) { st.inputTokens += (m.usage.input_tokens ?? 0) + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0); }
      for (const block of m.content ?? []) {
        if (block.type === 'text' && block.text && st.textBlocks.size === 0 && !streamed(st)) {
          // Non-streaming producer (e.g. imported `claude -p` log without partial messages): emit whole text.
          const id = `m${++st.msgCounter}`; out.push({ type: 'message', messageId: id, delta: block.text }); out.push({ type: 'message', messageId: id, delta: '', final: true }); phase('thinking');
        } else if (block.type === 'tool_use' && !st.toolNames.has(block.id)) {
          out.push(...toolCall(block.id, block.name, block.input ?? {}, sub, st, phase));
        }
      }
      break;
    }
    case 'user': {
      const content = msg.message?.content;
      if (Array.isArray(content)) for (const block of content) {
        if (block.type !== 'tool_result') continue;
        const text = Array.isArray(block.content) ? block.content.map((c: any) => c.type === 'text' ? c.text : c.type === 'image' ? '[image]' : '').join('\n') : String(block.content ?? '');
        const started = st.toolStarted.get(block.tool_use_id);
        out.push({ type: 'tool.result', toolCallId: block.tool_use_id, ok: !block.is_error, output: tail(text), durationMs: started ? Date.now() - started : undefined });
        st.toolStarted.delete(block.tool_use_id);
      }
      break;
    }
    case 'result': {
      const ok = msg.subtype === 'success';
      out.push({ type: 'cost', costUsd: msg.total_cost_usd ?? 0, turns: msg.num_turns ?? st.turns, inputTokens: st.inputTokens, outputTokens: st.outputTokens });
      phase(ok ? 'done' : 'failed');
      out.push({ type: 'run.finished', status: ok ? 'finished' : 'failed', costUsd: msg.total_cost_usd ?? 0, turns: msg.num_turns ?? st.turns, durationMs: msg.duration_ms ?? 0, summary: typeof msg.result === 'string' ? msg.result : undefined, error: ok ? undefined : (msg.errors?.join?.('\n') || msg.subtype) });
      break;
    }
    default: break;
  }
  return out;
}

function streamed(st: MapState) { return st.msgCounter > 0 && st.textBlocks.size === 0 && false; }

function toolCall(id: string, name: string, input: Record<string, unknown>, sub: string, st: MapState, phase: (p: Phase, d?: string) => void): Partial[] {
  st.toolNames.set(id, name); st.toolStarted.set(id, Date.now()); st.turns++;
  const title = toolTitle(name, input) + sub;
  const out: Partial[] = [{ type: 'tool.call', toolCallId: id, tool: name, title, input }];
  phase(phaseFor(name, input), title);
  return out;
}
