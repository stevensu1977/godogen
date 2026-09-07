import { memo, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { PHASE_LABEL, shortDuration, timeOfDay, toolIcon } from '../lib/format';
import { renderMarkdown } from '../lib/markdown';
import type { Action, TimelineItem } from '../lib/runState';

const MessageItem = memo(function MessageItem({ item }: { item: Extract<TimelineItem, { kind: 'message' }> }) {
  return (
    <div className="tl-msg">
      <span className="tl-time">{timeOfDay(item.ts)}</span>
      <div className={`bubble ${item.final ? '' : 'streaming'}`}>{renderMarkdown(item.text)}</div>
    </div>
  );
});

function fmtInput(input: Record<string, unknown>): string {
  if (typeof input.command === 'string') return input.command;
  if (typeof input.file_path === 'string' && Object.keys(input).length === 1) return input.file_path;
  try { return JSON.stringify(input, null, 2); } catch { return String(input); }
}

const ToolItem = memo(function ToolItem({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const pending = item.ok === undefined;
  return (
    <div className="tl-tool">
      <span className="tl-time">{timeOfDay(item.ts)}</span>
      <div className="card">
        <div className={`head ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)}>
          <span className="chev">▶</span>
          <span className="icon">{toolIcon(item.tool)}</span>
          <span className="tool-name">{item.tool}</span>
          <span className="tool-title" title={item.title}>{item.title}</span>
          <span className={`status ${pending ? '' : item.ok ? 'ok' : 'err'}`}>
            {pending ? <><span className="spin" />running</> : <>{item.ok ? '✓' : '✕'} {shortDuration(item.durationMs)}</>}
          </span>
        </div>
        {open && (
          <div className="body">
            <div><div className="lbl">Input</div><pre>{fmtInput(item.input)}</pre></div>
            {item.output !== undefined && <div><div className="lbl">Output{item.ok === false ? ' (error)' : ''}</div><pre>{item.output || '(empty)'}</pre></div>}
          </div>
        )}
      </div>
    </div>
  );
});

function InputItem({ item, runId, dispatch }: { item: Extract<TimelineItem, { kind: 'needs_input' }>; runId: string; dispatch: React.Dispatch<Action> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try { await api.reply(runId, value.trim()); dispatch({ type: 'answered', key: item.key, text: value.trim() }); } catch (e) { alert(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void send(text); };
  return (
    <div className="tl-input">
      <span className="tl-time">{timeOfDay(item.ts)}</span>
      <div className="box">
        <div className="q"><span>❔</span><span>{item.prompt}</span></div>
        {item.answered ? (
          <div className="answered">You replied: <b>{item.answered}</b></div>
        ) : (
          <>
            {item.options && item.options.length > 0 && (
              <div className="opts">{item.options.map((o) => <button key={o} className="btn sm" disabled={busy} onClick={() => void send(o)}>{o}</button>)}</div>
            )}
            <form onSubmit={submit}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a reply…" disabled={busy} />
              <button type="submit" className="btn primary sm" disabled={busy || !text.trim()}>Send</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function Item({ item, runId, dispatch }: { item: TimelineItem; runId: string; dispatch: React.Dispatch<Action> }) {
  switch (item.kind) {
    case 'message': return <MessageItem item={item} />;
    case 'tool': return <ToolItem item={item} />;
    case 'phase':
      return (
        <div className="tl-phase" style={{ ['--ph' as string]: `var(--ph-${item.phase})` }}>
          <span className="dot" />{PHASE_LABEL[item.phase]}{item.detail && <span className="detail">· {item.detail}</span>}
        </div>
      );
    case 'log':
      return <div className={`tl-log ${item.level}`}><span className="tl-time">{timeOfDay(item.ts)}</span><span className="txt">{item.text}</span></div>;
    case 'needs_input': return <InputItem item={item} runId={runId} dispatch={dispatch} />;
    case 'turn':
      return (
        <div className="tl-turn">
          <span className="tl-time">{timeOfDay(item.ts)}</span>
          <div className="box"><div className="h">Turn {item.index} · follow-up</div><div className="t">{item.text}</div></div>
        </div>
      );
    case 'finished':
      return (
        <div className="tl-finished">
          <span className="tl-time">{timeOfDay(item.ts)}</span>
          <div className={`box ${item.status}`}>
            <div className="h">{item.status === 'finished' ? '✓ Turn finished' : item.status === 'cancelled' ? '⏹ Turn cancelled' : '✕ Turn failed'} <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>in {shortDuration(item.durationMs)}</span></div>
            {item.summary && <div className="s">{item.summary}</div>}
            {item.error && <pre>{item.error}</pre>}
          </div>
        </div>
      );
  }
}

export function Timeline({ items, runId, dispatch, connecting }: { items: TimelineItem[]; runId: string; dispatch: React.Dispatch<Action>; connecting: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const lastCount = useRef(items.length);

  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setFollow(atBottom);
    if (atBottom) setUnseen(0);
  };

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (follow) el.scrollTop = el.scrollHeight;
    else if (items.length > lastCount.current) setUnseen((n) => n + (items.length - lastCount.current));
    lastCount.current = items.length;
  }, [items, follow]);

  useEffect(() => {
    // Keep pinned while a streaming message grows even if items array identity changed only by text.
    const el = ref.current; if (!el || !follow) return;
    el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    // Re-pin on layout changes (pane resize, images/fonts loading) so follow-mode survives reflow.
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => { if (follow) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [follow, items.length]);

  const jump = () => { const el = ref.current; if (el) { el.scrollTop = el.scrollHeight; setFollow(true); setUnseen(0); } };

  return (
    <>
      <div className="timeline" ref={ref} onScroll={onScroll}>
        {items.length === 0 && <div className="tl-empty">{connecting ? 'Connecting to the run…' : 'No events yet.'}</div>}
        {items.map((it) => <Item key={it.key} item={it} runId={runId} dispatch={dispatch} />)}
      </div>
      {!follow && <button className="jump" onClick={jump}>↓ Jump to latest{unseen > 0 ? ` (${unseen} new)` : ''}</button>}
    </>
  );
}
