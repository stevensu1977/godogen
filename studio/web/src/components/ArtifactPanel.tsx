import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Artifact, ArtifactKind } from '@godogen/shared';
import { api } from '../lib/api';
import { bytes } from '../lib/format';
import type { Action } from '../lib/runState';
import { CodeViewer } from '../viewers/CodeViewer';
import { ImageViewer } from '../viewers/ImageViewer';
import { VideoViewer } from '../viewers/VideoViewer';

const ModelViewer = lazy(() => import('../viewers/ModelViewer'));

type Tab = 'all' | 'code' | 'image' | 'video' | 'model';
const TABS: { id: Tab; label: string; kinds: ArtifactKind[] }[] = [
  { id: 'all', label: 'All', kinds: ['code', 'image', 'video', 'model', 'doc', 'other'] },
  { id: 'code', label: 'Code', kinds: ['code', 'doc'] },
  { id: 'image', label: 'Images', kinds: ['image'] },
  { id: 'video', label: 'Video', kinds: ['video'] },
  { id: 'model', label: '3D', kinds: ['model'] },
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

export function ArtifactPanel({ runId, artifacts, freshIds, dispatch }: { runId: string; artifacts: Artifact[]; freshIds: string[]; dispatch: React.Dispatch<Action> }) {
  const [tab, setTab] = useState<Tab>('all');
  // The open artifact lives in the URL (?artifact=<id>) so a viewer can be deep-linked.
  const [params, setParams] = useSearchParams();
  const openId = params.get('artifact');
  const setOpenId = useCallback((id: string | null) => {
    setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('artifact', id); else n.delete('artifact'); return n; }, { replace: true });
  }, [setParams]);
  const open = artifacts.find((a) => a.id === openId) ?? null;

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { all: 0, code: 0, image: 0, video: 0, model: 0 };
    for (const a of artifacts) for (const t of TABS) if (t.kinds.includes(a.kind)) c[t.id]++;
    return c;
  }, [artifacts]);
  const visible = useMemo(() => {
    const kinds = TABS.find((t) => t.id === tab)!.kinds;
    return artifacts.filter((a) => kinds.includes(a.kind)).slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [artifacts, tab]);

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
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>{t.label}<span className="n">{counts[t.id]}</span></button>
          ))
        )}
      </div>
      {open ? (
        <Viewer runId={runId} artifact={open} />
      ) : (
        <div className="art-grid">
          {visible.length === 0 && <div className="art-empty">{artifacts.length === 0 ? 'No artifacts yet — they appear here as the agent writes files.' : 'Nothing in this category yet.'}</div>}
          {visible.map((a) => (
            <button key={a.id} className={`art-card ${freshIds.includes(a.id) ? 'fresh' : ''}`} onClick={() => setOpenId(a.id)} title={a.path}>
              {freshIds.includes(a.id) && <span className="badge">NEW</span>}
              <Thumb a={a} url={api.fileUrl(runId, a.path)} />
              <div className="info">
                <span className="name">{a.title}</span>
                <span className="path">{a.path} · {bytes(a.bytes)}</span>
              </div>
            </button>
          ))}
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
