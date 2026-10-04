import type {
  BulkSummary,
  CheckResult,
  ContainerStats,
  CheckSummary,
  ContainerAction,
  ContainersResponse,
  ContainerSpec,
  AutoUpdateStatus,
  CleanupPreview,
  CleanupResult,
  HistoryEntry,
  HostInfo,
  RunResult,
  Schedule,
  SchedulePreview,
  Settings,
  TemplateSummary,
  UpdateAllSummary,
  UpdateResult,
} from './types'

export class UnauthorizedError extends Error {
  constructor() {
    super('Session expired, please sign in again')
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (res.status === 401) throw new UnauthorizedError()
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    if (body?.error) throw new Error(body.error)
    // No JSON body: the backend did not answer (stopped, crashed, or a proxy error page)
    throw new Error(
      res.status >= 500
        ? 'Cannot reach the DockerUpdates server. Check that the backend is running (see its logs).'
        : `Request failed (${res.status})`,
    )
  }
  return res.json() as Promise<T>
}

const post = <T>(url: string, body?: unknown) =>
  request<T>(url, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

type Ok = { ok: true }

export const api = {
  version: () => request<{ version: string }>('/api/version'),
  me: () => request<{ user: string }>('/api/auth/me'),
  login: (username: string, password: string) =>
    post<{ user: string }>('/api/auth/login', { username, password }),
  logout: () => post<Ok>('/api/auth/logout'),

  list: () => request<ContainersResponse>('/api/containers'),
  stats: () => request<Record<string, ContainerStats>>('/api/stats'),
  action: (id: string, action: ContainerAction) =>
    post<Ok>(`/api/containers/${id}/${action}`),
  remove: (id: string) =>
    request<Ok>(`/api/containers/${id}`, { method: 'DELETE' }),
  setAutostart: (id: string, enabled: boolean) =>
    post<Ok>(`/api/containers/${id}/autostart`, { enabled }),
  checkUpdate: (id: string) => post<CheckResult>(`/api/containers/${id}/check-update`),
  checkAllUpdates: () => post<CheckSummary>('/api/containers/check-updates'),
  update: (id: string) => post<UpdateResult>(`/api/containers/${id}/update`),
  updateAll: () => post<UpdateAllSummary>('/api/containers/update-all'),
  bulk: (action: ContainerAction) => post<BulkSummary>(`/api/containers/bulk/${action}`),
  create: (spec: ContainerSpec) => post<{ id: string }>('/api/containers', spec),
  spec: (id: string) => request<ContainerSpec>(`/api/containers/${id}/spec`),
  edit: (id: string, spec: ContainerSpec) =>
    request<{ name: string }>(`/api/containers/${id}`, { method: 'PUT', body: JSON.stringify(spec) }),
  networks: () => request<string[]>('/api/networks'),
  checkExtraParams: (extraParams: string) =>
    post<{ summary: string[] }>('/api/extra-params/check', { extraParams }),
  host: () => request<HostInfo>('/api/host'),

  history: (container?: string) =>
    request<HistoryEntry[]>(`/api/history${container ? `?container=${encodeURIComponent(container)}` : ''}`),
  templates: () => request<TemplateSummary[]>('/api/templates'),
  template: (name: string) => request<ContainerSpec>(`/api/templates/${encodeURIComponent(name)}`),
  deleteTemplate: (name: string) => request<Ok>(`/api/templates/${encodeURIComponent(name)}`, { method: 'DELETE' }),

  settings: () => request<Settings>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  testNotification: (channel: string) => post<Ok>(`/api/settings/test/${channel}`),
  timezones: () => request<string[]>('/api/timezones'),
  autoUpdateStatus: () => request<AutoUpdateStatus>('/api/auto-update/status'),
  runAutoUpdate: () => post<RunResult>('/api/auto-update/run'),
  previewSchedule: (schedule: Schedule) => post<SchedulePreview>('/api/schedule/preview', schedule),
  cleanupPreview: (mode?: string) => request<CleanupPreview>(`/api/cleanup/preview${mode ? `?mode=${mode}` : ''}`),
  runCleanup: () => post<CleanupResult>('/api/cleanup/run'),
}
