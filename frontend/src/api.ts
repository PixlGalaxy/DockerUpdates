import type {
  ContainerAction,
  ContainersResponse,
  NewContainer,
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
    throw new Error(body?.error ?? `Request failed (${res.status})`)
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
  action: (id: string, action: ContainerAction) =>
    post<Ok>(`/api/containers/${id}/${action}`),
  remove: (id: string) =>
    request<Ok>(`/api/containers/${id}`, { method: 'DELETE' }),
  setAutostart: (id: string, enabled: boolean) =>
    post<Ok>(`/api/containers/${id}/autostart`, { enabled }),
  checkUpdate: (id: string) => post<Ok>(`/api/containers/${id}/check-update`),
  checkAllUpdates: () => post<Ok>('/api/containers/check-updates'),
  update: (id: string) => post<Ok>(`/api/containers/${id}/update`),
  updateAll: () => post<Ok>('/api/containers/update-all'),
  bulk: (action: ContainerAction) => post<Ok>(`/api/containers/bulk/${action}`),
  create: (data: NewContainer) => post<{ id: string }>('/api/containers', data),
}
