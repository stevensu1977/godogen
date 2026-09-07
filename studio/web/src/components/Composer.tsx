import { useState } from 'react';
import type { RunSummary } from '@godogen/shared';
import { api } from '../lib/api';
import type { Action } from '../lib/runState';

const QUICK = [
  ['Re-record video', 'Re-record the proof video with ./record.sh and check it frame by frame; fix anything that looks wrong.'],
  ['Add sound', 'Add sound effects (shots, pickups, hits, extraction) with procedurally generated or CC0 audio, wire them in, and prove it in the README.'],
  ['Polish models', 'Make the 3D models more detailed and better textured with Blender scripts; keep triangle counts sane and re-import.'],
  ['Fix from screenshots', 'Review the latest screenshots in screenshots/result, list every visual or gameplay defect you can see, fix them, and capture again.'],
];

/** Follow-up instruction box: starts a new turn on the same workspace when the run is not running. */
export function Composer({ run, dispatch, onSent }: { run?: RunSummary; dispatch: React.Dispatch<Action>; onSent: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const active = run?.status === 'running' || run?.status === 'queued';
  const disabled = !run || active || busy;
  const send = async () => {
    if (!run || !text.trim()) return;
    setBusy(true); setErr(undefined);
    try {
      const updated = await api.postTurn(run.id, text.trim());
      dispatch({ type: 'run', run: updated });
      setText('');
      onSent();
    } catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  return (
    <div className="composer">
      <div className="quick">
        {QUICK.map(([label, prompt]) => <button key={label} className="btn ghost sm" disabled={disabled} onClick={() => setText(prompt)}>{label}</button>)}
      </div>
      <div className="row">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={2} disabled={disabled}
          placeholder={active ? 'Run in progress — cancel it or wait for the turn to finish before sending a follow-up.' : 'Tell the agent what to do next on this game… (Ctrl/⌘+Enter to send)'}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void send(); } }}
        />
        <button className="btn primary" disabled={disabled || !text.trim()} onClick={() => void send()}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
      {err && <div className="err">{err}</div>}
      {run && !active && run.turns_history && run.turns_history.length > 0 && <div className="hint">{run.turns_history.length} turn{run.turns_history.length > 1 ? 's' : ''} so far · the engine session is resumed, so the agent keeps its memory of earlier turns</div>}
    </div>
  );
}
