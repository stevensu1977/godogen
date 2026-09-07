import { execFileSync } from 'node:child_process';
import type { CommitDetail, CommitSummary, RunTurn } from '@goscene/shared';

const SEP = '\u001f'; const REC = '\u001e';
export function git(workspace: string, ...args: string[]): string {
  return execFileSync('git', ['-C', workspace, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString();
}
export function isRepo(workspace: string): boolean { try { git(workspace, 'rev-parse', '--is-inside-work-tree'); return true; } catch { return false; } }
export function hasCommits(workspace: string): boolean { try { git(workspace, 'rev-parse', '--verify', 'HEAD'); return true; } catch { return false; } }

export function history(workspace: string, turns: RunTurn[] | undefined, limit = 200): CommitSummary[] {
  if (!isRepo(workspace) || !hasCommits(workspace)) return [];
  const byHash = new Map<string, number>(); for (const t of turns ?? []) if (t.commit) byHash.set(t.commit, t.index);
  const raw = git(workspace, 'log', `-n${limit}`, `--format=${REC}%H${SEP}%h${SEP}%an${SEP}%aI${SEP}%s${SEP}%b`, '--shortstat');
  const out: CommitSummary[] = [];
  for (const rec of raw.split(REC)) {
    if (!rec.trim()) continue;
    const [head, ...rest] = rec.split('\n');
    const [hash, short, author, date, subject, ...bodyParts] = head.split(SEP);
    let body = bodyParts.join(SEP); const tail = rest.join('\n');
    // %b may span lines; the shortstat line is the last non-empty line when present.
    const lines = tail.split('\n'); const statLine = lines.filter(l => /files? changed/.test(l)).pop() ?? '';
    body = (body + '\n' + lines.filter(l => !/files? changed/.test(l)).join('\n')).trim();
    const files = Number(/(\d+) files? changed/.exec(statLine)?.[1] ?? 0);
    out.push({ hash, short, author, date, subject, body, filesChanged: files, turnIndex: byHash.get(short), restore: /^Restore to /.test(subject) });
  }
  return out;
}

export function commitDetail(workspace: string, hash: string, turns: RunTurn[] | undefined, maxDiff = 300_000): CommitDetail | undefined {
  const list = history(workspace, turns, 1000);
  const meta = list.find(c => c.hash === hash || c.short === hash);
  if (!meta) return undefined;
  const numstat = git(workspace, 'show', '--numstat', '--format=', '--no-renames', meta.hash).trim();
  const status = git(workspace, 'show', '--name-status', '--format=', '--no-renames', meta.hash).trim();
  const st = new Map<string, string>(); for (const l of status.split('\n')) { const [s, p] = l.split('\t'); if (p) st.set(p, s); }
  const files = numstat.split('\n').filter(Boolean).map(l => { const [a, d, p] = l.split('\t'); return { path: p, additions: a === '-' ? 0 : Number(a), deletions: d === '-' ? 0 : Number(d), status: st.get(p) ?? 'M' }; });
  let diff = git(workspace, 'show', '--format=', '--no-renames', '-p', meta.hash, '--', '.', ':(exclude)*.glb', ':(exclude)*.png', ':(exclude)*.mp4', ':(exclude)*.avi', ':(exclude)*.wav');
  const truncated = diff.length > maxDiff; if (truncated) diff = diff.slice(0, maxDiff) + '\n… diff truncated …\n';
  return { ...meta, files, diff, diffTruncated: truncated };
}

/** Make the worktree + index equal to `hash`'s tree (tracked files only), then commit it as a new restore commit. */
export function restoreTo(workspace: string, hash: string, subject: string, body: string, author: string): string {
  git(workspace, 'read-tree', '-u', '--reset', hash);
  git(workspace, 'add', '-A');
  const staged = git(workspace, 'diff', '--cached', '--name-only').trim();
  if (!staged) throw new Error('workspace already matches that commit');
  const name = author.replace(/\s*<.*$/, ''); const email = /<(.*)>/.exec(author)?.[1] ?? 'studio@goscene.ai';
  git(workspace, '-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', subject, '-m', body);
  return git(workspace, 'rev-parse', '--short', 'HEAD').trim();
}
