import type { Artifact, CreateRunRequest, RunSummary } from '@godogen/shared';

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
  postTurn: (id: string, text: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/turns`, { method: 'POST', body: JSON.stringify({ text }) }),
  reply: (id: string, text: string) => request<void>(`/api/runs/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  eventsUrl: (id: string, after?: number) => `/api/runs/${encodeURIComponent(id)}/events${after ? `?after=${after}` : ''}`,
  fileUrl: (runId: string, path: string) =>
    `/api/runs/${encodeURIComponent(runId)}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
};
