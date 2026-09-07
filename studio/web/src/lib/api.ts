import type { Artifact, CommitDetail, CommitSummary, CreateRunRequest, PublishTarget, RunSummary } from '@goscene/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = ((await res.json()) as { error?: string }).error ?? detail; } catch { /* not json */ }
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  listRuns: () => request<RunSummary[]>('/api/runs'),
  getRun: (id: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}`),
  createRun: (body: CreateRunRequest) => request<RunSummary>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  listArtifacts: (id: string) => request<Artifact[]>(`/api/runs/${encodeURIComponent(id)}/artifacts`),
  cancelRun: (id: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  history: (id: string) => request<CommitSummary[]>(`/api/runs/${encodeURIComponent(id)}/history`),
  commit: (id: string, hash: string) => request<CommitDetail>(`/api/runs/${encodeURIComponent(id)}/history/${hash}`),
  restore: (id: string, hash: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/restore`, { method: 'POST', body: JSON.stringify({ hash }) }),
  publish: (id: string, targets?: PublishTarget[]) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify({ targets }) }),
  playUrl: (id: string) => `/play/${encodeURIComponent(id)}/`,
  postTurn: (id: string, text: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/turns`, { method: 'POST', body: JSON.stringify({ text }) }),
  reply: (id: string, text: string) => request<void>(`/api/runs/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  eventsUrl: (id: string, after?: number) => `/api/runs/${encodeURIComponent(id)}/events${after ? `?after=${after}` : ''}`,
  fileUrl: (runId: string, path: string) =>
    `/api/runs/${encodeURIComponent(runId)}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
};
