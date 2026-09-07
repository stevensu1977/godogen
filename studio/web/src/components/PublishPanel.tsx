import { useState } from 'react';
import { IMPLEMENTED_TARGETS, PUBLISH_TARGETS, type PublishTarget, type RunSummary } from '@goscene/shared';
import { api } from '../lib/api';
import type { Action, RunState } from '../lib/runState';

const LABEL: Record<PublishTarget, string> = { web: 'Web (play in browser)', linux: 'Linux x86_64', windows: 'Windows x86_64', macos: 'macOS (unsigned)', android: 'Android (phase 2)', ios: 'iOS (phase 3)', stream: 'Stream (phase 4)' };

/** Publish tab: choose targets, package, and see per-target results (play link, downloads, proof screenshot, log). */
export function PublishPanel({ state, run, dispatch }: { state: RunState; run?: RunSummary; dispatch: React.Dispatch<Action> }) {
  const [sel, setSel] = useState<PublishTarget[]>(run?.targets?.length ? run.targets : ['web']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [openLog, setOpenLog] = useState<PublishTarget | null>(null);
  if (!run) return null;
  const active = run.status === 'running' || run.status === 'queued' || state.publishing;
  const toggle = (t: PublishTarget) => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  const go = async () => {
    setBusy(true); setErr(undefined);
    try { const updated = await api.publish(run.id, sel); dispatch({ type: 'run', run: updated }); }
    catch (e) { setErr(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  const web = state.publish.web;
  return (
    <div className="pub">
      <div className="pub-targets">
        {PUBLISH_TARGETS.map((t) => (
          <label key={t} className={`pub-target ${IMPLEMENTED_TARGETS.includes(t) ? '' : 'later'}`}>
            <input type="checkbox" checked={sel.includes(t)} onChange={() => toggle(t)} disabled={active} /> {LABEL[t]}
          </label>
        ))}
      </div>
      <div className="pub-actions">
        <button className="btn primary" disabled={active || busy || sel.length === 0} onClick={() => void go()}>{state.publishing ? 'Publishing…' : busy ? 'Starting…' : 'Publish'}</button>
        {web?.ok && <a className="btn" href={api.playUrl(run.id)} target="_blank" rel="noreferrer">▶ Play in browser</a>}
        {active && !state.publishing && <span className="hint">Available once the current turn finishes.</span>}
        {err && <span className="err">{err}</span>}
      </div>
      <div className="pub-results">
        {Object.values(state.publish).sort((a, b) => a.target.localeCompare(b.target)).map((r) => (
          <div key={r.target} className={`pub-result ${r.ok ? 'ok' : 'fail'}`}>
            <div className="row">
              <span className="st">{r.ok ? '✓' : '✕'}</span>
              <span className="t">{LABEL[r.target]}</span>
              <span className="meta">{new Date(r.finishedAt).toLocaleTimeString()} · {(r.durationMs / 1000).toFixed(0)}s</span>
              {r.url && r.ok && <a className="btn sm primary" href={api.playUrl(run.id)} target="_blank" rel="noreferrer">▶ Play</a>}
              {r.archive && r.ok && <a className="btn sm" href={api.fileUrl(run.id, r.archive)}>Download zip</a>}
              <button className="btn ghost sm" onClick={() => setOpenLog(openLog === r.target ? null : r.target)}>{openLog === r.target ? 'Hide log' : 'Log'}</button>
            </div>
            {r.screenshot && r.ok && <img className="shot" src={`${api.fileUrl(run.id, r.screenshot)}?v=${encodeURIComponent(r.finishedAt)}`} alt={`${r.target} proof`} />}
            {openLog === r.target && <pre className="log">{r.log}</pre>}
          </div>
        ))}
        {Object.keys(state.publish).length === 0 && <div className="art-empty">Nothing published yet. Pick targets and press Publish; Studio exports with Godot, hosts the web build and screenshots it as proof.</div>}
      </div>
    </div>
  );
}
