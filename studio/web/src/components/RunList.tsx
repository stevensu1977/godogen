import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { RunSummary } from '@goscene/shared';
import { api } from '../lib/api';
import { duration, money, PHASE_LABEL, relative, STATUS_LABEL } from '../lib/format';
import { useTicker } from '../lib/useRunStream';
import { NewRunForm } from './NewRunForm';
import { StatusPill } from './StatusPill';

function elapsedOf(run: RunSummary, now: number): number {
  const start = run.startedAt ? Date.parse(run.startedAt) : Date.parse(run.createdAt);
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Math.max(0, end - start);
}

export function RunList() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string>();
  const [showForm, setShowForm] = useState(false);
  const navigate = useNavigate();
  const hasRunning = !!runs?.some((r) => r.status === 'running' || r.status === 'queued');
  const now = useTicker(hasRunning);

  const load = useCallback(() => {
    api.listRuns().then((r) => { setRuns(r); setError(undefined); }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="runs-page">
      <div className="runs-head">
        <div>
          <h1>Runs</h1>
          <p>Describe a game. Play it in minutes. Open a run to follow the agent and browse what it produced.</p>
        </div>
        <button className="btn primary" onClick={() => setShowForm(true)}>+ New run</button>
      </div>
      {error && <div className="error-box">Could not load runs: {error}</div>}
      {runs && runs.length === 0 && <div className="empty">No runs yet. Start one with “New run”.</div>}
      <div className="run-grid">
        {runs?.map((run) => (
          <Link key={run.id} to={`/runs/${encodeURIComponent(run.id)}`} className="run-card" style={{ ['--ph' as string]: `var(--ph-${run.phase})` }}>
            <span className="stripe" />
            <div className="row">
              <span className="title">{run.title || run.brief.slice(0, 60)}</span>
              <StatusPill status={run.status} />
            </div>
            <div className="brief">{run.brief}</div>
            <div className="phase">
              <span className="tag">{run.engine}</span>
              <span className="tag">{run.agent}</span>
              <span>{run.status === 'running' ? PHASE_LABEL[run.phase] : STATUS_LABEL[run.status]}</span>
            </div>
            <div className="meta">
              <span>cost <b>{money(run.costUsd)}</b></span>
              <span>elapsed <b>{duration(elapsedOf(run, now))}</b></span>
              <span>artifacts <b>{run.artifactCount}</b></span>
              <span>turns <b>{run.turns}</b></span>
              <span style={{ marginLeft: 'auto' }}>{relative(run.createdAt, now)}</span>
            </div>
          </Link>
        ))}
      </div>
      {showForm && (
        <NewRunForm
          onClose={() => setShowForm(false)}
          onCreated={(run) => { setShowForm(false); navigate(`/runs/${encodeURIComponent(run.id)}`); }}
        />
      )}
    </div>
  );
}
