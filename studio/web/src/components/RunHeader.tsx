import { useState } from 'react';
import { api } from '../lib/api';
import { duration, money } from '../lib/format';
import type { RunState } from '../lib/runState';
import { useTicker } from '../lib/useRunStream';
import { AgentIndicator } from './AgentIndicator';
import { StatusPill } from './StatusPill';

export function RunHeader({ state, runId }: { state: RunState; runId: string }) {
  const { run } = state;
  const running = run?.status === 'running' || run?.status === 'queued';
  const now = useTicker(!!running);
  const [cancelling, setCancelling] = useState(false);

  let elapsedMs = 0;
  if (state.finished) elapsedMs = state.finished.durationMs;
  else if (run) {
    const start = Date.parse(run.startedAt ?? run.createdAt);
    const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
    elapsedMs = end - start;
  }

  const cancel = async () => {
    if (!confirm('Cancel this run? The engine will be stopped.')) return;
    setCancelling(true);
    try { await api.cancelRun(runId); } catch (e) { alert(String((e as Error).message ?? e)); } finally { setCancelling(false); }
  };

  return (
    <div className="run-header">
      <div className="title-block">
        <h1>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{run?.title ?? runId}</span>
          {run && <StatusPill status={run.status} />}
        </h1>
        <div className="sub">
          {run && <><span className="tag">{run.engine}</span><span className="tag">{run.agent}</span></>}
          <span className="mono" style={{ fontSize: 11 }}>{runId}</span>
          <span className={`conn ${state.connection}`}><span className="dot" />{state.connection === 'live' ? 'live' : state.connection === 'reconnecting' ? 'reconnecting…' : state.connection === 'connecting' ? 'connecting…' : 'stream ended'}</span>
          {state.error && <span style={{ color: 'var(--err)' }}>{state.error}</span>}
        </div>
      </div>
      <AgentIndicator phase={state.phase} detail={state.phaseDetail} />
      <div className="stats">
        <div className="stat"><span className="k">Cost</span><span className="v">{money(state.costUsd)}</span></div>
        <div className="stat"><span className="k">Turns</span><span className="v dim">{state.turns}</span></div>
        <div className="stat"><span className="k">Elapsed</span><span className="v dim">{duration(elapsedMs)}</span></div>
        <div className="stat"><span className="k">Artifacts</span><span className="v dim">{state.artifacts.length}</span></div>
      </div>
      {state.publish.web?.ok && <a className="btn primary" href={api.playUrl(runId)} target="_blank" rel="noreferrer">▶ Play</a>}
      {running && <button className="btn danger" onClick={cancel} disabled={cancelling}>{cancelling ? 'Cancelling…' : 'Cancel'}</button>}
    </div>
  );
}
