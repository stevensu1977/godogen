import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Artifact, ArtifactKind } from '@goscene/shared';
import { api } from '../lib/api';
import { bytes, timeOfDay } from '../lib/format';
import type { Action } from '../lib/runState';
import { CodeViewer } from '../viewers/CodeViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { VideoViewer } from '../viewers/VideoViewer';
import { HistoryPanel } from './HistoryPanel';
import { PublishPanel } from './PublishPanel';
import type { RunState } from '../lib/runState';
import type { RunSummary } from '@goscene/shared';

const ModelViewer = lazy(() => import('../viewers/ModelViewer'));

type Tab = 'all' | 'code' | 'image' | 'video' | 'model' | 'history' | 'publish';
const TABS: { id: Tab; label: string; kinds: ArtifactKind[] }[] = [
  { id: 'all', label: 'All', kinds: ['code', 'image', 'video', 'model', 'doc', 'other'] },
  { id: 'code', label: 'Code', kinds: ['code', 'doc'] },
  { id: 'image', label: 'Images', kinds: ['image'] },
  { id: 'video', label: 'Video', kinds: ['video'] },
  { id: 'model', label: '3D', kinds: ['model'] },
  { id: 'history', label: 'History', kinds: [] },
  { id: 'publish', label: 'Publish', kinds: [] },
];

const ext = (p: string) => (p.split('.').pop() ?? '').toLowerCase();

function Thumb({ a, url }: { a: Artifact; url: string }) {
  switch (a.kind) {
    case 'image': return <div className="thumb image"><img src={url} alt={a.title} loading="lazy" /></div>;
    case 'video': return <div className="thumb video"><span className="glyph">🎬</span><span className="ext">{ext(a.path)}</span></div>;
    case 'model': return <div className="thumb model"><span className="glyph">🧊</span><span className="ext">{ext(a.path)}</span></div>;
    case 'code': return <div className="thumb code"><span className="glyph">{'</>'}</span><span className="ext">{ext(a.path)}</span></div>;
    case 'doc': return <div className="thumb doc"><span className="glyph">¶</span><span className="ext">{ext(a.path)}</span></div>;
    default: return <div className="thumb"><span className="glyph">📦</span><span className="ext">{ext(a.path)}</span></div>;
  }
}

export function ArtifactPanel({ runId, artifacts, freshIds, dispatch, run, onRestored, state }: { runId: string; artifacts: Artifact[]; freshIds: string[]; dispatch: React.Dispatch<Action>; run?: RunSummary; onRestored: () => void; state: RunState }) {
  const [histKey, setHistKey] = useState(0);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'recent' | 'name'>('recent');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('studio.artifacts.view') as 'grid' | 'list') || 'grid');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => { localStorage.setItem('studio.artifacts.view', view); }, [view]);
  // The open artifact lives in the URL (?artifact=<id>) so a viewer can be deep-linked.
  const [params, setParams] = useSearchParams();
  const openId = params.get('artifact');
  const setOpenId = useCallback((id: string | null) => {
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('artifact', id); else n.delete('artifact'); return n; }, { replace: true });
  }, [setParams]);
  const open = artifacts.find((a) => a.id === openId) ?? null;

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: 0, code: 0, image: 0, video: 0, model: 0, history: 0, publish: 0 };
    for (const a of artifacts) for (const t of TABS) if (t.kinds.includes(a.kind)) c[t.id]++;
    return c;
  }, [artifacts]);
  const visible = useMemo(() => {
    const kinds = TABS.find((t) => t.id === tab)!.kinds;
    const q = query.trim().toLowerCase();
    const list = artifacts.filter((a) => kinds.includes(a.kind) && (!q || a.path.toLowerCase().includes(q)));
    return list.sort((a, b) => (sort === 'recent' ? b.updatedAt.localeCompare(a.updatedAt) : a.path.localeCompare(b.path)));
  }, [artifacts, tab, query, sort]);
  // Group by folder so a long list reads as a tree, not a wall of cards. Groups are ordered by their newest file.
  const groups = useMemo(() => {
    const m = new Map<string, Artifact[]>();
    for (const a of visible) { const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '/'; (m.get(dir) ?? m.set(dir, []).get(dir)!).push(a); }
    const arr = [...m.entries()].map(([dir, items]) => ({ dir, items, newest: items.reduce((t, a) => (a.updatedAt > t ? a.updatedAt : t), '') }));
    return arr.sort((x, y) => (sort === 'recent' ? y.newest.localeCompare(x.newest) : x.dir.localeCompare(y.dir)));
  }, [visible, sort]);
  const grouped = groups.length > 1;
  const setAll = (c: boolean) => setCollapsed(Object.fromEntries(groups.map((g) => [g.dir, c])));

  // Clear "fresh" highlight after the animation.
  useEffect(() => {
    if (freshIds.length === 0) return;
    const ids = freshIds.slice();
    const t = setTimeout(() => dispatch({ type: 'unfresh', ids }), 2600);
    return () => clearTimeout(t);
  }, [freshIds, dispatch]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpenId]);

  return (
    <>
      <div className="art-tabs">
        {open ? (
          <>
            <button className="btn ghost sm" onClick={() => setOpenId(null)}>← Artifacts</button>
            <span className="spacer" />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Esc to close</span>
          </>
        ) : (
          TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}{t.id !== 'history' && t.id !== 'publish' && <span className="n">{counts[t.id]}</span>}{t.id === 'publish' && state.publish.web?.ok && <span className="n">▶</span>}</button>
          ))
        )}
      </div>
      {open ? (
        <Viewer runId={runId} artifact={open} />
      ) : tab === 'publish' ? (
        <PublishPanel state={state} run={run} dispatch={dispatch} />
      ) : tab === 'history' ? (
        <HistoryPanel run={run} dispatch={dispatch} refreshKey={histKey} onRestored={() => { setHistKey((k) => k + 1); onRestored(); }} />
      ) : (
        <div className="art-body">
          <div className="art-toolbar">
            <input className="art-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or path…" />
            <select value={sort} onChange={(e) => setSort(e.target.value as 'recent' | 'name')} title="Sort">
              <option value="recent">Newest first</option>
              <option value="name">By path</option>
            </select>
            <div className="seg" title="View">
              <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} aria-label="Grid">▦</button>
              <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} aria-label="List">☰</button>
            </div>
            {grouped && <button className="btn ghost sm" onClick={() => setAll(!groups.every((g) => collapsed[g.dir]))}>{groups.every((g) => collapsed[g.dir]) ? 'Expand all' : 'Collapse all'}</button>}
          </div>
          <div className="art-scroll">
            {visible.length === 0 && <div className="art-empty">{artifacts.length === 0 ? 'No artifacts yet — they appear here as the agent writes files.' : query ? 'No artifact matches the filter.' : 'Nothing in this category yet.'}</div>}
            {groups.map((g) => {
              const isCollapsed = grouped && !!collapsed[g.dir];
              const freshHere = g.items.filter((a) => freshIds.includes(a.id)).length;
              return (
                <section key={g.dir} className="art-group">
                  {grouped && (
                    <button className={`art-group-head ${isCollapsed ? 'collapsed' : ''}`} onClick={() => setCollapsed((c) => ({ ...c, [g.dir]: !c[g.dir] }))}>
                      <span className="chev">▶</span>
                      <span className="dir">{g.dir === '/' ? 'project root' : g.dir}</span>
                      <span className="n">{g.items.length}</span>
                      {freshHere > 0 && <span className="badge">{freshHere} NEW</span>}
                    </button>
                  )}
                  {!isCollapsed && (view === 'grid' ? (
                    <div className="art-grid">
                      {g.items.map((a) => (
                        <button key={a.id} className={`art-card ${freshIds.includes(a.id) ? 'fresh' : ''}`} onClick={() => setOpenId(a.id)} title={a.path}>
                          {freshIds.includes(a.id) && <span className="badge">NEW</span>}
                          <Thumb a={a} url={api.fileUrl(runId, a.path)} />
                          <div className="info">
                            <span className="name">{a.title}</span>
                            <span className="path">{grouped ? bytes(a.bytes) : `${a.path} · ${bytes(a.bytes)}`}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="art-list">
                      {g.items.map((a) => (
                        <button key={a.id} className={`art-row ${freshIds.includes(a.id) ? 'fresh' : ''}`} onClick={() => setOpenId(a.id)} title={a.path}>
                          <span className={`kind ${a.kind}`}>{a.kind === 'image' ? '🖼' : a.kind === 'video' ? '🎬' : a.kind === 'model' ? '🧊' : a.kind === 'doc' ? '¶' : '</>'}</span>
                          <span className="name">{a.title}</span>
                          {!grouped && <span className="path">{a.path}</span>}
                          {freshIds.includes(a.id) && <span className="badge">NEW</span>}
                          <span className="size">{bytes(a.bytes)}</span>
                          <span className="time">{timeOfDay(a.updatedAt)}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function Viewer({ runId, artifact }: { runId: string; artifact: Artifact }) {
  const url = `${api.fileUrl(runId, artifact.path)}?v=${encodeURIComponent(artifact.updatedAt)}`;
  let body: JSX.Element;
  switch (artifact.kind) {
    case 'image': body = <ImageViewer url={url} alt={artifact.title} />; break;
    case 'video': body = <VideoViewer url={url} />; break;
    case 'model':
      body = (
        <Suspense fallback={<div className="viewer-body center"><div className="viewer-loading"><span className="spin" />Loading 3D viewer…</div></div>}>
          <ModelViewer url={url} />
        </Suspense>
      );
      break;
    default: body = <CodeViewer url={url} path={artifact.path} />;
  }
  return (
    <div className="viewer">
      <div className="viewer-bar">
        <span className="name">{artifact.title}</span>
        <span className="path" title={artifact.path}>{artifact.path}</span>
        <span className="size">{bytes(artifact.bytes)}</span>
        <a className="btn ghost sm" href={api.fileUrl(runId, artifact.path)} target="_blank" rel="noreferrer">Open raw ↗</a>
      </div>
      {body}
    </div>
  );
}
