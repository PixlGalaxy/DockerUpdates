import type {
  BulkSummary,
  CheckResult,
  ContainerFolder,
  GroupIcon,
  ContainerStats,
  CheckSummary,
  ContainerAction,
  ContainersResponse,
  ContainerSpec,
  CpuLayout,
  AutoUpdateStatus,
  CleanupPreview,
  CleanupResult,
  HistoryEntry,
  HostInfo,
  HostUsage,
  NetworkInfo,
  LanDetection,
  LanStatus,
  RunResult,
  Schedule,
  SchedulePreview,
  StackAction,
  StackFile,
  Settings,
  TemplateSummary,
  UpdateAllSummary,
  UpdateResult,
} from './types'
import type {
  AdminOverview,
  IpAccessInfo,
  LogChannel,
  LogLevel,
  LogPage,
  SecurityInfo,
  SecurityValues,
  ServerConfig,
  ServerConfigPatch,
  SystemInfo,
} from './adminTypes'

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
  saveOrder: (names: string[]) =>
    request<{ order: string[] }>('/api/containers/order', { method: 'PUT', body: JSON.stringify({ names }) }),
  /** key: "stack:<project>" / "folder:<id>"; url '' removes the icon */
  setGroupIcon: (key: string, url: string) =>
    request<{ groupIcons: Record<string, GroupIcon> }>(`/api/groups/${encodeURIComponent(key)}/icon`, {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),
  saveFolders: (folders: ContainerFolder[]) =>
    request<{ folders: ContainerFolder[] }>('/api/folders', { method: 'PUT', body: JSON.stringify({ folders }) }),
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
  /** Starts an update with a live log; ids omitted = every container with an update */
  startUpdate: (ids?: string[]) => post<{ id: string; title: string }>('/api/operations/update', { ids }),
  bulk: (action: ContainerAction) => post<BulkSummary>(`/api/containers/bulk/${action}`),
  create: (spec: ContainerSpec) => post<{ id: string }>('/api/containers', spec),
  /** Validates the spec, then installs the container with a live log */
  startCreate: (spec: ContainerSpec) => post<{ id: string; title: string }>('/api/operations/create', spec),
  spec: (id: string) => request<ContainerSpec>(`/api/containers/${id}/spec`),
  refreshIcon: (id: string) => post<{ reset: boolean }>(`/api/containers/${id}/refresh-icon`),
  edit: (id: string, spec: ContainerSpec) =>
    request<{ name: string }>(`/api/containers/${id}`, { method: 'PUT', body: JSON.stringify(spec) }),
  networks: () => request<NetworkInfo[]>('/api/networks'),
  lanStatus: () => request<LanStatus>('/api/lan-network'),
  detectLan: () => post<LanDetection>('/api/lan-network/detect'),
  enableLan: (cfg: { name: string; driver: string; parent: string; subnet: string; gateway: string; ipRange?: string }) =>
    post<LanStatus>('/api/lan-network/enable', cfg),
  checkIp: (network: string, ip: string, container?: string) =>
    post<{ available: boolean; reason: string }>('/api/networks/check-ip', { network, ip, container }),
  checkPorts: (ports: { host: string; protocol: 'tcp' | 'udp' }[], container?: string) =>
    post<{ results: { index: number; inUse: boolean; reason?: string }[] }>('/api/ports/check', { ports, container }),
  checkExtraParams: (extraParams: string) =>
    post<{ summary: string[] }>('/api/extra-params/check', { extraParams }),
  host: () => request<HostInfo>('/api/host'),
  hostUsage: () => request<HostUsage>('/api/host/usage'),
  hostCpus: () => request<CpuLayout>('/api/host/cpus'),

  stack: (name: string) => request<StackFile>(`/api/stacks/${encodeURIComponent(name)}`),
  /** Validates and saves the compose file, then deploys the stack with a live log */
  startStackDeploy: (stack: StackFile & { isNew: boolean }) =>
    post<{ id: string; title: string }>('/api/operations/stack-deploy', stack),
  stackAction: (name: string, action: StackAction) =>
    post<BulkSummary>(`/api/stacks/${encodeURIComponent(name)}/${action}`),
  setStackColor: (name: string, color: string | null) =>
    request<{ stackColors: Record<string, string> }>(`/api/stacks/${encodeURIComponent(name)}/color`, {
      method: 'PUT',
      body: JSON.stringify({ color }),
    }),
  setStackAutostart: (name: string, enabled: boolean) =>
    post<BulkSummary>(`/api/stacks/${encodeURIComponent(name)}/autostart`, { enabled }),
  checkStackUpdates: (name: string) => post<CheckSummary>(`/api/stacks/${encodeURIComponent(name)}/check-updates`),

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

export const adminApi = {
  overview: () => request<AdminOverview>('/api/admin/overview'),
  revokeSession: (id: string) => post<Ok>(`/api/admin/sessions/${id}/revoke`),
  revokeOtherSessions: () => post<{ revoked: number }>('/api/admin/sessions/revoke-others'),

  logs: (limit: number, page: number, filter: { channel?: LogChannel; level?: LogLevel } = {}) => {
    const q = new URLSearchParams({ limit: String(limit), page: String(page) })
    if (filter.channel) q.set('channel', filter.channel)
    if (filter.level) q.set('level', filter.level)
    return request<LogPage>(`/api/admin/logs?${q}`)
  },
  logsStreamUrl: (after: number) => `/api/admin/logs/stream?after=${after}`,

  ipAccess: () => request<IpAccessInfo>('/api/admin/ip-access'),
  unlock: (key: string) => post<Ok>('/api/admin/ip-access/unlock', { key }),
  ban: (ip: string, reason?: string) => post<{ ip: string }>('/api/admin/ip-access/bans', { ip, reason }),
  unban: (ip: string) => post<Ok>('/api/admin/ip-access/bans/remove', { ip }),

  security: () => request<SecurityInfo>('/api/admin/security'),
  saveSecurity: (values: Partial<SecurityValues>) =>
    request<SecurityInfo>('/api/admin/security', { method: 'PUT', body: JSON.stringify(values) }),

  system: () => request<SystemInfo>('/api/admin/system'),

  config: () => request<ServerConfig>('/api/config'),
  saveConfig: (patch: ServerConfigPatch) => request<ServerConfig>('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),
  changeUsername: (username: string, currentPassword: string) =>
    post<{ user: string; config: ServerConfig }>('/api/config/username', { username, currentPassword }),
  changePassword: (newPassword: string, currentPassword: string) =>
    post<ServerConfig>('/api/config/password', { newPassword, currentPassword }),
}
