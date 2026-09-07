import { watch, type FSWatcher } from 'chokidar';
import { statSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { classifyArtifact, type Artifact } from '@goscene/shared';

const IGNORED_DIRS = new Set(['.git', '.godot', 'bin', 'obj', 'node_modules', '.claude', '.agents', '.codex', 'target', 'dist', '.venv', '__pycache__', 'video', 'build']);
const IGNORED_EXT = /\.(import|uid|md5|tmp|log|jsonl|lock|avi|wav|ttf|otf|pyc|meta|swp)$/i;

export function isArtifactPath(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some(p => IGNORED_DIRS.has(p) || (p.startsWith('.') && p !== '.gitignore'))) return false;
  if (IGNORED_EXT.test(rel)) return false;
  if (/^(run\.sh|resume\.sh|coop\.sh|record.*\.sh|progress\.py|BRIEF.*\.md|CLAUDE\.md|AGENTS\.md|[a-z]+\.md)$/.test(rel) && !/^README\.md$/.test(rel)) return rel === 'README.md';
  return classifyArtifact(rel) !== 'other';
}

export function toArtifact(workspace: string, abs: string, toolCallId?: string): Artifact | null {
  const rel = relative(workspace, abs).split(sep).join('/');
  if (!isArtifactPath(rel)) return null;
  let bytes = 0; let mtime = new Date();
  try { const s = statSync(abs); if (!s.isFile()) return null; bytes = s.size; mtime = s.mtime; } catch { /* removed */ }
  return { id: rel, kind: classifyArtifact(rel), path: rel, bytes, updatedAt: mtime.toISOString(), toolCallId, title: rel.split('/').pop() ?? rel };
}

/** Watch a run workspace and report artifact files as they appear, change, or vanish. */
export function watchWorkspace(workspace: string, onChange: (a: Artifact, change: 'added' | 'updated' | 'removed') => void): FSWatcher {
  const w = watch(workspace, {
    ignoreInitial: true,
    ignored: (p, stats) => { const rel = relative(workspace, p).split(sep).join('/'); if (!rel) return false; const parts = rel.split('/'); return parts.some(x => IGNORED_DIRS.has(x)) || (!!stats?.isFile() && !isArtifactPath(rel)); },
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
  });
  w.on('add', p => { const a = toArtifact(workspace, p); if (a) onChange(a, 'added'); });
  w.on('change', p => { const a = toArtifact(workspace, p); if (a) onChange(a, 'updated'); });
  w.on('unlink', p => { const a = toArtifact(workspace, p); if (a) onChange(a, 'removed'); });
  return w;
}
