import type { Phase, RunStatus } from '@goscene/shared';

export const money = (usd: number) => `$${(usd ?? 0).toFixed(2)}`;

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

export function shortDuration(ms?: number): string {
  if (ms === undefined) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return duration(ms);
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function relative(iso: string, now = Date.now()): string {
  const diff = now - Date.parse(iso);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Idle',
  thinking: 'Thinking',
  reading: 'Reading',
  command: 'Running command',
  writing: 'Writing code',
  blender: 'Modelling in Blender',
  godot: 'Building in Godot',
  capturing: 'Capturing footage',
  reviewing: 'Reviewing output',
  waiting_input: 'Waiting for you',
  done: 'Done',
  failed: 'Failed',
};

export const STATUS_LABEL: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  finished: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const isTerminal = (status?: RunStatus) => status === 'finished' || status === 'failed' || status === 'cancelled';

export function toolIcon(tool: string): string {
  switch (tool) {
    case 'Read': return '📖';
    case 'Glob': case 'Grep': return '🔍';
    case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit': return '✏️';
    case 'Bash': case 'shell': case 'exec': return '⌨️';
    case 'WebFetch': case 'WebSearch': return '🌐';
    case 'Task': case 'Agent': return '🤖';
    default: return '🔧';
  }
}

export function langForPath(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'cs': return 'csharp';
    case 'gd': return 'gdscript';
    case 'ts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'js': case 'mjs': return 'javascript';
    case 'jsx': return 'jsx';
    case 'py': return 'python';
    case 'rs': return 'rust';
    case 'json': return 'json';
    case 'sh': case 'bash': return 'bash';
    case 'md': return 'markdown';
    case 'yaml': case 'yml': return 'yaml';
    case 'toml': return 'toml';
    case 'css': return 'css';
    case 'html': return 'markup';
    case 'tscn': case 'tres': case 'godot': case 'cfg': return 'ini';
    case 'gdshader': return 'glsl';
    case 'csproj': return 'markup';
    default: return 'text';
  }
}
