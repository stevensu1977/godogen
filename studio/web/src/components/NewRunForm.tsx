import { useEffect, useState, type FormEvent } from 'react';
import { IMPLEMENTED_TARGETS, PUBLISH_TARGETS, type EngineKind, type EngineName, type PublishTarget, type RunSummary } from '@goscene/shared';
import { api } from '../lib/api';

export function NewRunForm({ onClose, onCreated }: { onClose: () => void; onCreated: (run: RunSummary) => void }) {
  const [brief, setBrief] = useState('');
  const [title, setTitle] = useState('');
  const [engine, setEngine] = useState<EngineName>('godot');
  const [agent, setAgent] = useState<EngineKind>('claude');
  const [budget, setBudget] = useState('25');
  const [targets, setTargets] = useState<PublishTarget[]>(['web', 'linux', 'windows']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!brief.trim()) { setError('A brief is required.'); return; }
    setBusy(true); setError(undefined);
    try {
      const budgetUsd = budget.trim() ? Number(budget) : undefined;
      const run = await api.createRun({ brief: brief.trim(), title: title.trim() || undefined, engine, agent, budgetUsd: Number.isFinite(budgetUsd) ? budgetUsd : undefined, targets });
      onCreated(run);
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal" onSubmit={submit}>
        <h2>New run</h2>
        <div className="field">
          <label htmlFor="nr-brief">Brief</label>
          <textarea id="nr-brief" autoFocus value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What game should the agent build? Genre, mechanics, look, and what to deliver (e.g. a 60s recorded playthrough)." />
        </div>
        <div className="field">
          <label htmlFor="nr-title">Title <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></label>
          <input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Defaults to the first line of the brief" />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="nr-engine">Engine</label>
            <select id="nr-engine" value={engine} onChange={(e) => setEngine(e.target.value as EngineName)}>
              <option value="godot">Godot (GDScript)</option>
              <option value="godot-csharp">Godot (C#, no Web)</option>
              <option value="bevy">Bevy</option>
              <option value="babylon">Babylon.js</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="nr-agent">Agent</label>
            <select id="nr-agent" value={agent} onChange={(e) => setAgent(e.target.value as EngineKind)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="nr-budget">Budget (USD)</label>
            <input id="nr-budget" type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Publish targets</label>
          <div className="targets">
            {PUBLISH_TARGETS.map((t) => (
              <label key={t} className={`target ${IMPLEMENTED_TARGETS.includes(t) ? '' : 'later'}`} title={IMPLEMENTED_TARGETS.includes(t) ? '' : 'Packaged in a later phase; the agent keeps the project compatible'}>
                <input type="checkbox" checked={targets.includes(t)} onChange={() => setTargets((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))} /> {t}
              </label>
            ))}
          </div>
          {engine === 'godot-csharp' && targets.includes('web') && <div className="hint" style={{ color: 'var(--err)' }}>Godot 4 cannot export C# to the Web — pick GDScript or drop the web target.</div>}
        </div>
        {error && <div className="error-box">{error}</div>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Starting…' : 'Start run'}</button>
        </div>
      </form>
    </div>
  );
}
