import { ArtifactPanel } from './ArtifactPanel';
import { RunHeader } from './RunHeader';
import { Timeline } from './Timeline';
import { Composer } from './Composer';
import { useRunStream } from '../lib/useRunStream';

export function RunView({ runId }: { runId: string }) {
  const [state, dispatch, reopen] = useRunStream(runId);
  return (
    <div className="run-view">
      <RunHeader state={state} runId={runId} />
      <div className="run-body">
        <section className="timeline-pane">
          <Timeline items={state.items} runId={runId} dispatch={dispatch} connecting={state.connection === 'connecting'} />
          <Composer run={state.run} dispatch={dispatch} onSent={reopen} />
        </section>
        <section className="artifact-pane">
          <ArtifactPanel runId={runId} artifacts={state.artifacts} freshIds={state.freshArtifactIds} dispatch={dispatch} run={state.run} onRestored={reopen} />
        </section>
      </div>
    </div>
  );
}
