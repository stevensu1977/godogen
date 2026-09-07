import { useEffect, useReducer, useRef } from 'react';
import type { StudioEvent } from '@godogen/shared';
import { api } from './api';
import { initialRunState, reduce, type RunState, type Action } from './runState';
import { isTerminal } from './format';

/**
 * Loads a run + its artifacts and subscribes to its SSE stream. EventSource reconnects on its own
 * (sending Last-Event-ID); we close it ourselves once `run.finished` arrives so a finished run
 * doesn't loop reconnecting after the server ends the stream.
 */
export function useRunStream(runId: string): [RunState, React.Dispatch<Action>, () => void] {
  const [state, dispatch] = useReducer(reduce, undefined, () => initialRunState());
  const stateRef = useRef(state);
  stateRef.current = state;
  const reopenRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let disposed = false;
    let es: EventSource | undefined;
    let replaying = true; // events arriving in the first burst after connect are history, not "live"
    let replayTimer: ReturnType<typeof setTimeout> | undefined;

    api.getRun(runId).then((run) => !disposed && dispatch({ type: 'run', run })).catch((e) => !disposed && dispatch({ type: 'connection', connection: 'closed', error: String(e.message ?? e) }));
    api.listArtifacts(runId).then((artifacts) => !disposed && dispatch({ type: 'artifacts', artifacts })).catch(() => undefined);

    const open = (after?: number) => {
      es?.close();
      es = new EventSource(api.eventsUrl(runId, after));
      es.onopen = () => {
        replaying = true;
        dispatch({ type: 'connection', connection: 'live' });
      };
      es.onmessage = (m) => {
        let ev: StudioEvent;
        try { ev = JSON.parse(m.data) as StudioEvent; } catch { return; }
        if (replayTimer) clearTimeout(replayTimer);
        replayTimer = setTimeout(() => { replaying = false; }, 400);
        dispatch({ type: 'event', event: ev, live: !replaying });
        if (ev.type === 'run.finished') { es?.close(); dispatch({ type: 'connection', connection: 'closed' }); }
      };
      es.onerror = () => {
        if (disposed) return;
        const run = stateRef.current.run;
        if (isTerminal(run?.status) || stateRef.current.finished) {
          es?.close();
          dispatch({ type: 'connection', connection: 'closed' });
          return;
        }
        dispatch({ type: 'connection', connection: 'reconnecting' });
      };
    };
    open();
    // After a follow-up turn is posted the server stream is live again: resubscribe from the last seq.
    reopenRef.current = () => { if (!disposed) { replaying = true; open(stateRef.current.lastSeq); } };

    return () => {
      disposed = true;
      if (replayTimer) clearTimeout(replayTimer);
      es?.close();
    };
  }, [runId]);

  return [state, dispatch, () => reopenRef.current()];
}

export function useTicker(active: boolean, intervalMs = 1000): number {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(force, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs]);
  return Date.now();
}
