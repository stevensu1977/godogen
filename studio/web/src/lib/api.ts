import type { Artifact, CreateRunRequest, RunSummary } from '@godogen/shared';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = ((await res.json()) as { error?: string }).error ?? detail; } catch { /* not json */ }
    throw new Error(`${res.status} ${detail}`);
  }
  if (res.status === 202 || res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listRuns: () => request<RunSummary[]>('/api/runs'),
  getRun: (id: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}`),
  createRun: (body: CreateRunRequest) => request<RunSummary>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  listArtifacts: (id: string) => request<Artifact[]>(`/api/runs/${encodeURIComponent(id)}/artifacts`),
  cancelRun: (id: string) => request<RunSummary>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  reply: (id: string, text: string) => request<void>(`/api/runs/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  eventsUrl: (id: string) => `/api/runs/${encodeURIComponent(id)}/events`,
  fileUrl: (runId: string, path: string) =>
    `/api/runs/${encodeURIComponent(runId)}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
};
