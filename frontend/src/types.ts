export type ContainerState =
  | 'running'
  | 'paused'
  | 'exited'
  | 'created'
  | 'restarting'
  | 'dead'

export type UpdateStatus =
  | 'up-to-date'
  | 'update-available'
  | 'unknown'
  | 'auth-required'
  | 'local'
  | 'error'

export interface PortMapping {
  containerPort: number
  protocol: 'tcp' | 'udp'
  hostPort?: number
}

export interface VolumeMapping {
  container: string
  host: string
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: ContainerState
  status: string
  network: string
  ip?: string
  mac?: string
  ports: PortMapping[]
  volumes: VolumeMapping[]
  cpuPercent: number
  memUsage: number
  memLimit: number
  autostart: boolean
  startedAt?: string
  createdAt: string
  updateStatus: UpdateStatus
  /** Explanation for auth-required / error / local */
  updateMessage?: string
  /** This is DockerUpdates' own container */
  isSelf: boolean
  /** Memory limit set on the container (0 = no limit) */
  memLimitConfigured: number
  /** CPU limit in cores (0 = no limit) */
  cpuLimit: number
  /** URL of the cached icon, if any */
  icon?: string
}

export interface CheckResult {
  name: string
  status: UpdateStatus
  message?: string
}

export interface CheckSummary {
  upToDate: number
  available: number
  authRequired: number
  failed: number
  local: number
}

export interface UpdateResult {
  name: string
  selfUpdate: boolean
}

export interface UpdateAllSummary {
  updated: number
  failed: { name: string; error: string }[]
  selfUpdate: boolean
}

export interface BulkSummary {
  affected: number
  failed: number
}

export interface ContainerStats {
  cpuPercent: number
  memUsage: number
  memLimit: number
}

export interface ContainersResponse {
  hostIp: string
  containers: ContainerInfo[]
}

export type ContainerAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'pause'
  | 'unpause'

export type RestartPolicy = 'no' | 'always' | 'unless-stopped' | 'on-failure'

/** Editable container definition (Add / Edit form). */
export interface ContainerSpec {
  name: string
  image: string
  network: string
  restart: RestartPolicy
  /** host may be "8080" or "127.0.0.1:8080" */
  ports: { host: string; container: string; protocol: 'tcp' | 'udp' }[]
  volumes: { host: string; container: string; mode: 'rw' | 'ro' }[]
  env: { key: string; value: string }[]
  /** docker run flags, e.g. "--memory=2g --cpus=1.5" */
  extraParams: string
  /** Custom icon for the image repository ('' = automatic favicon) */
  iconUrl: string
}
