import { ArtifactPanel } from './ArtifactPanel';
import { RunHeader } from './RunHeader';
import { Timeline } from './Timeline';
import { useRunStream } from '../lib/useRunStream';

export function RunView({ runId }: { runId: string }) {
  const [state, dispatch] = useRunStream(runId);
  return (
    <div className="run-view">
      <RunHeader state={state} runId={runId} />
      <div className="run-body">
        <section className="timeline-pane">
          <Timeline items={state.items} runId={runId} dispatch={dispatch} connecting={state.connection === 'connecting'} />
        </section>
        <section className="artifact-pane">
          <ArtifactPanel runId={runId} artifacts={state.artifacts} freshIds={state.freshArtifactIds} dispatch={dispatch} />
        </section>
      </div>
    </div>
  );
}
