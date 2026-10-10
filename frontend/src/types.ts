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
  /** When an update is available: current -> new (version, commit SHA or image ID) */
  updateFrom?: string
  updateTo?: string
  updateKind?: 'version' | 'revision' | 'image'
  /** Source / project page from the image labels */
  projectUrl?: string
  /** Build date of the available update */
  updatePublished?: string
  /** Docker HEALTHCHECK status (null when the image has no health check) */
  health: 'healthy' | 'unhealthy' | 'starting' | null
  /** Output of the last health check */
  healthLog?: string
  exitCode?: number
  restartCount: number
  /** This is DockerUpdates' own container */
  isSelf: boolean
  /** Memory limit set on the container (0 = no limit) */
  memLimitConfigured: number
  /** CPU limit in cores (0 = no limit) */
  cpuLimit: number
  /** Cores the container is pinned to (--cpuset-cpus), 0 = all */
  cpusetCount: number
  /** URL of the cached icon, if any */
  icon?: string
  /** Compose stack it belongs to; `managed`: its compose file lives in DockerUpdates */
  stack?: StackRef
}

export interface StackRef {
  project: string
  service: string
  managed: boolean
}

/** Compose file of a managed stack */
export interface StackFile {
  name: string
  yaml: string
  env: string
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

/** Result of a container installed from the Add container form */
export interface InstallResult {
  name: string
  id: string
}

/** A long-running operation followed live (update log / install log) */
export type OperationKind = 'update' | 'install'
export type OperationResult = UpdateAllSummary | InstallResult

export interface LiveOperation {
  id: string
  title: string
  kind: OperationKind
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
  /** Hostname of the Docker host */
  hostName: string
  containers: ContainerInfo[]
  /** Managed compose stacks (also the ones with no container right now) */
  stacks: string[]
  /** Color chosen for each stack (project -> color id); the others get one from their name */
  stackColors: Record<string, string>
  /** Custom order of the list (container names and "stack:<name>", first shown first); others go after, A-Z */
  order: string[]
}

export type StackAction = 'start' | 'stop' | 'restart' | 'down'

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
  /** Memory limit in bytes (0 = no limit) */
  memory: number
  /** CPU pinning, --cpuset-cpus format ("0-3,8"; '' = every CPU) */
  cpuset: string
  /** Fixed IPv4 on a user-defined network ('' = automatic) */
  ip: string
}

export interface LanDetection {
  name: string
  driver: 'macvlan' | 'ipvlan'
  parent: string
  hostIp: string
  subnet: string
  gateway: string
  wifi: boolean
}

export interface LanStatus {
  enabled: boolean
  missing: boolean
  dockerDesktop: boolean
  network: {
    name: string
    driver: string
    parent: string | null
    subnet: string | null
    gateway: string | null
    ipRange: string | null
    containers: number
  } | null
}

export interface NetworkInfo {
  name: string
  driver: string
  subnet: string | null
  gateway: string | null
  /** User-defined network: a fixed IP can be set */
  fixedIp: boolean
}

/** CPUs of the Docker host for the CPU pinning picker */
export interface CpuLayout {
  /** CPUs Docker can use */
  cpus: number
  /** Physical cores, each with its CPU ids: first = the core, next ones = its hyper-threads */
  cores: number[][]
  sockets: number
  threadsPerCore: number
  /** 'topology': real core / thread pairs; 'count': only the number of CPUs is known */
  source: 'topology' | 'count'
  model: string
  /** Docker runs in a virtual machine: these are vCPUs */
  virtual: boolean
}

export interface HostInfo {
  name: string
  ip: string
  memTotal: number
  cpus: number
  os: string
  dockerVersion: string
}

// ---------- Auto-update / settings ----------

export type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'
export type AutoAction = 'update' | 'notify'

export interface Schedule {
  frequency: Frequency
  minute: number
  hour: number
  dayOfWeek: number
  dayOfMonth: number
  cron: string
}

export interface ContainerAutoUpdate {
  mode: 'global' | 'custom' | 'off'
  action?: AutoAction
  schedule?: Schedule
  /** Overrides the global cooldown (custom mode) */
  cooldownDays?: number
}

export interface Settings {
  timezone: string
  autoUpdate: {
    enabled: boolean
    action: AutoAction
    schedule: Schedule
    applyToAll: boolean
    stopTimeout: number
    cooldownDays: number
    containers: Record<string, ContainerAutoUpdate>
  }
  notifications: {
    events: { updateAvailable: boolean; updated: boolean; updateFailed: boolean; cleanup: boolean; health: boolean }
    includeManual: boolean
    discord: { enabled: boolean; webhookUrl: string; mention: string }
    telegram: { enabled: boolean; botToken: string; chatId: string }
    ntfy: { enabled: boolean; url: string; token: string }
    webhook: { enabled: boolean; url: string; secret: string }
  }
  /** Background checks that only refresh the "update available" status */
  updateCheck: {
    onStartup: boolean
    startupDelayMinutes: number
    /** 0 = no periodic check */
    intervalMinutes: number
  }
  network: {
    /** macvlan / ipvlan network enabled in Settings ('' = not enabled) */
    lanNetwork: string
  }
  health: {
    stopRestartLoops: boolean
    maxRestarts: number
  }
  cleanup: {
    removeOldImageAfterUpdate: boolean
    scheduled: boolean
    schedule: Schedule
    mode: 'dangling' | 'unused'
  }
}

export interface RunResult {
  at: string
  trigger: 'auto' | 'manual'
  checked: number
  available: number
  updated: number
  failed: number
  deferred?: number
}

export interface HostUsage {
  cpu: number
  memUsed: number
  memTotal: number
}

export interface AutoUpdateStatus {
  timezone: string
  running: { label: string; since: string } | null
  queued: number
  lastRun: RunResult | null
  lastCleanup: { at: string; count: number; freed: number } | null
  lastCheck: { at: string; trigger: 'startup' | 'interval'; upToDate: number; available: number; authRequired: number; failed: number; local: number } | null
  nextCheck: string | null
  nextRun: string | null
  nextCleanup: string | null
  containers: {
    id: string
    name: string
    image: string
    icon?: string
    isSelf: boolean
    local: boolean
    mode: 'global' | 'custom' | 'off'
    action: AutoAction | null
    cooldownDays: number
    health: ContainerInfo['health']
    nextRun: string | null
  }[]
}

export interface SchedulePreview {
  cron: string
  timezone: string
  next: string[]
}

export interface CleanupPreview {
  mode: 'dangling' | 'unused'
  images: { id: string; tags: string[]; size: number; created: string }[]
  size: number
}

export interface CleanupResult {
  count: number
  freed: number
  failed: { id: string; error: string }[]
}

export interface HistoryEntry {
  id: string
  at: string
  type: 'update' | 'edit'
  container: string
  image: string
  from?: string
  to?: string
  kind?: 'version' | 'revision' | 'image' | 'reinstall'
  trigger: 'manual' | 'auto'
  result: 'success' | 'failed' | 'scheduled'
  error?: string
  durationMs?: number
}

export interface TemplateSummary {
  name: string
  image: string
  savedAt: string
}
