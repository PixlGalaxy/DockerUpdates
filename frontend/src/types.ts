export type ContainerState =
  | 'running'
  | 'paused'
  | 'exited'
  | 'created'
  | 'restarting'
  | 'dead'

export type UpdateStatus = 'up-to-date' | 'update-available' | 'unknown'

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

export interface NewContainer {
  name: string
  image: string
  network: string
  restart: 'no' | 'always' | 'unless-stopped' | 'on-failure'
  ports: { host: string; container: string; protocol: 'tcp' | 'udp' }[]
  volumes: { host: string; container: string }[]
  env: { key: string; value: string }[]
}
