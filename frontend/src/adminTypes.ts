// Types of the Admin panel API (/api/admin/*)

export interface AdminSession {
  id: string
  user: string
  ip: string | null
  lastIp: string | null
  agent: string
  created: string
  lastSeen: string
  expires: string
  current: boolean
}

export interface FailedLogin {
  at: string
  ip: string
  peer: string | null
  username: string
}

export interface AdminOverview {
  sessions: AdminSession[]
  yourIp: string
  lockoutMinutes: number
  failedLogins: number
  globalLocked: number
  lockedCount: number
  bannedCount: number
  recentFailures: FailedLogin[]
  logLevels: Record<LogLevel, number>
  startedAt: string
}

export type LogChannel = 'AUDIT' | 'APP'
export type LogLevel = 'INFO' | 'WARN' | 'ERROR'

export interface LogEntry {
  id: number
  time: string
  channel: LogChannel
  level: LogLevel
  message: string
}

export interface LogPage {
  entries: LogEntry[]
  total: number
  pages: number
  capacity: number
  limit: number
}

export interface LockoutRow {
  key: string
  ip: string
  viaConnection: boolean
  recentFailures: number
  totalFailures: number
  retryAfterSeconds: number
}

export interface IpBan {
  ip: string
  reason: string | null
  createdAt: string
  createdBy: string | null
}

export interface SecurityValues {
  sessionHours: number
  idleMinutes: number
  ipMaxFailures: number
  globalMaxFailures: number
  lockoutMinutes: number
}

export interface IpAccessInfo {
  locked: LockoutRow[]
  watching: LockoutRow[]
  global: { recentFailures: number; retryAfterSeconds: number }
  recentFailures: FailedLogin[]
  proxyPinned: boolean
  banned: IpBan[]
  yourIp: string
  limits: SecurityValues
}

export interface SecurityInfo {
  values: SecurityValues
  defaults: SecurityValues
  limits: Record<keyof SecurityValues, { min: number; max: number }>
  status: {
    trustProxy: string
    cookieSecureForced: boolean
    connectionSecure: boolean
    allowedOrigins: string[]
    sessionSecretSet: boolean
    /** null: the password was changed in Settings (only its hash is stored) */
    passwordLength: number | null
    yourIp: string
    peerIp: string
  }
}

export interface SystemInfo {
  app: {
    version: string
    node: string
    platform: string
    arch: string
    startedAt: string
    uptimeSeconds: number
    containerized: boolean
    rssBytes: number
    heapUsedBytes: number
    osRelease: string
  }
  self: {
    container: string
    id: string
    image: string
    imageId: string
    created: string
    restartPolicy: string
    noNewPrivileges: boolean
  } | null
  docker: {
    name: string
    serverVersion: string
    apiVersion: string | null
    os: string
    kernel: string
    arch: string
    cpus: number
    memTotal: number
    storageDriver: string
    loggingDriver: string
    rootDir: string
    containers: { total: number; running: number; paused: number; stopped: number }
    images: number
  } | null
  data: {
    path: string
    disk: { totalBytes: number; usedBytes: number } | null
    parts: { name: string; bytes: number; files: number }[]
  }
}

// ---------- Settings → Account / Server & access (/api/config) ----------

/** Where a value comes from: saved in Settings, the .env file, detected or a built-in default */
export type ConfigSource = 'settings' | 'env' | 'auto' | 'default' | 'random'

export interface RegistryCredential {
  registry: string
  username: string
  /** "********" for a stored token */
  password: string
}

export interface ServerConfig {
  hostIp: { value: string; source: ConfigSource }
  hostName: { value: string; source: ConfigSource }
  trustProxy: { enabled: boolean; value: string; source: ConfigSource }
  cookieSecure: { value: boolean; source: ConfigSource }
  allowedOrigins: { value: string[]; source: ConfigSource }
  sessionSecret: { set: boolean; source: ConfigSource }
  registryAuth: { value: RegistryCredential[]; source: ConfigSource }
  readOnly: { port: string; docker: string }
  account: {
    user: string
    source: { user: 'settings' | 'env'; password: 'settings' | 'env' }
    resetLoginConfig: boolean
    minPassword: number
    passwordLength: number | null
  }
  host: {
    /** IP in use (header, LAN IP:Port links) */
    ip: string
    detectedIp: string | null
    addresses: string[] | null
    /** null = could not be verified */
    ipIsLocal: boolean | null
    autoName: string
  }
  connectionSecure: boolean
}

export interface ServerConfigPatch {
  hostIp?: string
  hostName?: string
  trustProxy?: { enabled: boolean; value: string }
  cookieSecure?: boolean
  allowedOrigins?: string[]
  sessionSecret?: string
  registryAuth?: RegistryCredential[]
}
