import { useEffect, useState } from 'react';
import type { CommitDetail, CommitSummary, RunSummary } from '@godogen/shared';
import { api } from '../lib/api';
import type { Action } from '../lib/runState';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Git history of the run workspace: one row per commit (Studio turn commits are labelled), modal with message, files, diff, restore. */
export function HistoryPanel({ run, dispatch, onRestored, refreshKey }: { run?: RunSummary; dispatch: React.Dispatch<Action>; onRestored: () => void; refreshKey: number }) {
  const [commits, setCommits] = useState<CommitSummary[] | undefined>();
  const [err, setErr] = useState<string | undefined>();
  const [openHash, setOpenHash] = useState<string | null>(null);
  useEffect(() => {
    if (!run) return;
    let dead = false;
    api.history(run.id).then((h) => !dead && setCommits(h)).catch((e) => !dead && setErr(String(e.message ?? e)));
    return () => { dead = true; };
  }, [run?.id, run?.status, refreshKey]);
  if (!run) return null;
  const active = run.status === 'running' || run.status === 'queued';
  return (
    <div className="hist">
      {err && <div className="art-empty">{err}</div>}
      {commits && commits.length === 0 && <div className="art-empty">No commits yet. Studio commits the workspace at the end of every turn.</div>}
      {commits?.map((c, i) => (
        <button key={c.hash} className={`hist-row ${c.turnIndex ? 'turn' : ''} ${c.restore ? 'restore' : ''}`} onClick={() => setOpenHash(c.hash)}>
          <span className="dot" />
          <span className="hash">{c.short}</span>
          <span className="subj">{c.subject}</span>
          <span className="tags">
            {i === 0 && <span className="tag head">HEAD</span>}
            {c.turnIndex && <span className="tag">turn {c.turnIndex}</span>}
            {c.restore && <span className="tag">restore</span>}
            {!c.turnIndex && !c.restore && <span className="tag by">{c.author.split(' ')[0]}</span>}
          </span>
          <span className="meta">{c.filesChanged} file{c.filesChanged === 1 ? '' : 's'} · {when(c.date)}</span>
        </button>
      ))}
      {openHash && <CommitModal runId={run.id} hash={openHash} canRestore={!active && commits?.[0]?.hash !== openHash} onClose={() => setOpenHash(null)} onRestored={(s) => { dispatch({ type: 'run', run: s }); setOpenHash(null); onRestored(); }} />}
    </div>
  );
}

function CommitModal({ runId, hash, canRestore, onClose, onRestored }: { runId: string; hash: string; canRestore: boolean; onClose: () => void; onRestored: (run: RunSummary) => void }) {
  const [d, setD] = useState<CommitDetail | undefined>();
  const [err, setErr] = useState<string | undefined>();
  const [tab, setTab] = useState<'files' | 'diff'>('files');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.commit(runId, hash).then(setD).catch((e) => setErr(String(e.message ?? e))); }, [runId, hash]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const restore = async () => {
    if (!d) return;
    if (!confirm(`Restore the workspace to ${d.short} “${d.subject}”?\n\nEverything changed after it is removed from the files (history is kept; a new "Restore" commit is created).`)) return;
    setBusy(true);
    try { onRestored(await api.restore(runId, d.hash)); } catch (e) { alert(String((e as Error).message ?? e)); } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal commit-modal" onClick={(e) => e.stopPropagation()}>
        {err && <div className="art-empty">{err}</div>}
        {!d && !err && <div className="art-empty">Loading commit…</div>}
        {d && (
          <>
            <div className="cm-head">
              <div>
                <div className="cm-subject">{d.subject}</div>
                <div className="cm-meta"><code>{d.short}</code> · {d.author} · {when(d.date)} · {d.files.length} file{d.files.length === 1 ? '' : 's'} · <span className="add">+{d.files.reduce((n, f) => n + f.additions, 0)}</span> <span className="del">−{d.files.reduce((n, f) => n + f.deletions, 0)}</span></div>
              </div>
              <div className="cm-actions">
                {canRestore && <button className="btn danger sm" disabled={busy} onClick={() => void restore()}>{busy ? 'Restoring…' : '↺ Restore to this commit'}</button>}
                <button className="btn ghost sm" onClick={onClose}>Close</button>
              </div>
            </div>
            {d.body && <pre className="cm-body">{d.body}</pre>}
            <div className="cm-tabs">
              <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>Files</button>
              <button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>Diff{d.diffTruncated ? ' (truncated)' : ''}</button>
            </div>
            {tab === 'files' ? (
              <div className="cm-files">
                {d.files.map((f) => <div key={f.path} className="cm-file"><span className={`st ${f.status[0]}`}>{f.status[0]}</span><span className="p">{f.path}</span><span className="add">+{f.additions}</span><span className="del">−{f.deletions}</span></div>)}
              </div>
            ) : (
              <pre className="cm-diff">{d.diff.split('\n').map((l, i) => <span key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'a' : l.startsWith('-') && !l.startsWith('---') ? 'd' : l.startsWith('@@') ? 'h' : l.startsWith('diff ') ? 'f' : ''}>{l}{'\n'}</span>)}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
