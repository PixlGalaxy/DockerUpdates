import {
  CircleAlert,
  CircleCheck,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldAlert,
  Trash2,
  Undo2,
  UserRound,
} from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ConfigSource, RegistryCredential, ServerConfig, ServerConfigPatch } from '../adminTypes'
import { adminApi } from '../api'
import { selectCls } from '../schedule'
import Card, { SettingRow } from './Card'
import Modal from './Modal'
import type { ToastTone } from './Toasts'
import { Button, Toggle } from './ui'

interface Props {
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
  /** The username shown in the header changed */
  onUserChange?: (user: string) => void
}

const monoCls = `${selectCls} font-mono text-xs`
const warnText = 'text-amber-700 dark:text-amber-300'

const SOURCE_LABEL: Record<ConfigSource, string> = {
  settings: 'Set here',
  env: 'From .env',
  auto: 'Auto-detected',
  default: 'Default',
  random: 'Random',
}

function SourceBadge({ source }: { source: ConfigSource }) {
  const tone =
    source === 'settings'
      ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : source === 'env'
        ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
        : 'border-line bg-surface-2 text-muted'
  return <span className={`ml-2 inline-flex rounded-md border px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${tone}`}>{SOURCE_LABEL[source]}</span>
}

function Note({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 text-xs ${tone === 'warn' ? warnText : 'text-muted'}`}>
      {tone === 'warn' && <CircleAlert size={13} className="mt-px shrink-0" />}
      <span>{children}</span>
    </p>
  )
}

/** Account, Server & access and Registry credentials cards (Settings page). */
export default function ServerSettings({ toast, onError, onUserChange }: Props) {
  const [config, setConfig] = useState<ServerConfig | null>(null)

  useEffect(() => {
    adminApi.config().then(setConfig, onError)
  }, [onError])

  if (!config) return null
  return (
    <>
      <AccountCard config={config} onConfig={setConfig} toast={toast} onUserChange={onUserChange} />
      {/* Remounted (fresh draft) whenever the server's values change */}
      <ServerAccessCard key={JSON.stringify(draftFrom(config))} config={config} onConfig={setConfig} toast={toast} onError={onError} />
      <RegistryCard key={JSON.stringify(config.registryAuth.value)} config={config} onConfig={setConfig} toast={toast} onError={onError} />
    </>
  )
}

interface CardProps {
  config: ServerConfig
  onConfig: (c: ServerConfig) => void
  toast: Props['toast']
}

// ---------- Account ----------

type Pending = { kind: 'username'; value: string } | { kind: 'password'; value: string } | null

function AccountCard({ config, onConfig, toast, onUserChange }: CardProps & Pick<Props, 'onUserChange'>) {
  const { account } = config
  const [username, setUsername] = useState(account.user)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState<Pending>(null)

  const userChanged = username.trim() !== '' && username.trim() !== account.user
  const tooShort = password.length > 0 && password.length < account.minPassword
  const matches = password.length > 0 && password === confirm
  const canChangePassword = matches && !tooShort

  async function confirmChange(currentPassword: string) {
    if (!pending) return
    if (pending.kind === 'username') {
      const r = await adminApi.changeUsername(pending.value, currentPassword)
      onConfig(r.config)
      setUsername(r.user)
      onUserChange?.(r.user)
      toast('success', `Username changed to "${r.user}". Other sessions were signed out.`)
    } else {
      onConfig(await adminApi.changePassword(pending.value, currentPassword))
      setPassword('')
      setConfirm('')
      toast('success', 'Password changed. Other sessions were signed out.')
    }
    setPending(null)
  }

  return (
    <Card title="Account" description="The username and password used to sign in to DockerUpdates." icon={<UserRound size={18} />}>
      {account.resetLoginConfig && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>RESET_LOGIN_CONFIG=true</b> is set in the .env file: the login from .env is in use, and any change made here is reset on the
            next restart. Set it to <code>false</code> (or remove it) once you can sign in again.
          </span>
        </div>
      )}

      <SettingRow
        label={
          <>
            Username
            <SourceBadge source={account.source.user} />
          </>
        }
        description="Applying asks for your current password."
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (userChanged) setPending({ kind: 'username', value: username.trim() })
          }}
        >
          <input className={`${selectCls} w-full sm:w-52`} value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
          <Button type="submit" variant="primary" size="md" disabled={!userChanged}>
            Apply
          </Button>
        </form>
      </SettingRow>

      <div>
        <div className="text-sm font-medium">
          Password
          <SourceBadge source={account.source.password} />
        </div>
        <p className="text-xs text-muted">
          At least {account.minPassword} characters, 12 or more recommended. Changing it signs out every other session.
          {account.passwordLength !== null && account.passwordLength < 12 && (
            <span className={warnText}> The current password (from .env) has only {account.passwordLength} characters.</span>
          )}
        </p>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e) => {
            e.preventDefault()
            if (canChangePassword) setPending({ kind: 'password', value: password })
          }}
        >
          <input type="password" className={selectCls} placeholder="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input type="password" className={selectCls} placeholder="Repeat the new password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button type="submit" variant="primary" size="md" icon={<KeyRound size={14} />} disabled={!canChangePassword}>
            Change password
          </Button>
        </form>
        {(password || confirm) && (
          <p
            className={`mt-1.5 flex items-center gap-1.5 text-xs ${
              tooShort || (confirm && !matches) ? 'text-red-600 dark:text-red-400' : matches ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted'
            }`}
          >
            {tooShort ? (
              <>
                <CircleAlert size={13} /> Too short: at least {account.minPassword} characters
              </>
            ) : !confirm ? (
              'Repeat the new password'
            ) : matches ? (
              <>
                <CircleCheck size={13} /> The passwords match
              </>
            ) : (
              <>
                <CircleAlert size={13} /> The passwords do not match
              </>
            )}
          </p>
        )}
      </div>

      {pending && (
        <CurrentPasswordModal
          title={pending.kind === 'username' ? `Change the username to "${pending.value}"` : 'Change the password'}
          onClose={() => setPending(null)}
          onConfirm={confirmChange}
        />
      )}
    </Card>
  )
}

function CurrentPasswordModal({ title, onClose, onConfirm }: { title: string; onClose: () => void; onConfirm: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onConfirm(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <Modal title={title} subtitle="Confirm with your current password" icon={<Lock size={18} />} size="md" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          className={selectCls}
          placeholder="Current password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && (
          <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
            <CircleAlert size={14} /> {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button size="md" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="md" loading={busy} disabled={!password}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// ---------- Server & access ----------

interface AccessDraft {
  hostIp: string
  hostName: string
  trustEnabled: boolean
  trustValue: string
  cookieSecure: boolean
  origins: string
  /** Seconds, as typed */
  keepalive: string
  /** '' = keep the current secret */
  secret: string
}

function draftFrom(c: ServerConfig): AccessDraft {
  return {
    // Automatic values are shown filled in: typing over them saves an override
    hostIp: c.host.ip,
    hostName: c.hostName.value || c.host.autoName,
    trustEnabled: c.trustProxy.enabled,
    trustValue: c.trustProxy.value,
    cookieSecure: c.cookieSecure.value,
    origins: c.allowedOrigins.value.join(', '),
    keepalive: String(c.consoleKeepalive.value),
    secret: '',
  }
}

function randomSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function ServerAccessCard({ config, onConfig, toast, onError }: CardProps & Pick<Props, 'onError'>) {
  const initial = draftFrom(config)
  const [draft, setDraft] = useState<AccessDraft>(initial)
  const [editingSecret, setEditingSecret] = useState(false)
  const [saving, setSaving] = useState(false)

  const set = (p: Partial<AccessDraft>) => setDraft((d) => ({ ...d, ...p }))
  const patch: ServerConfigPatch = {}
  if (draft.hostIp.trim() !== initial.hostIp) patch.hostIp = draft.hostIp.trim()
  if (draft.hostName.trim() !== initial.hostName) patch.hostName = draft.hostName.trim()
  if (draft.trustEnabled !== initial.trustEnabled || draft.trustValue.trim() !== initial.trustValue) {
    patch.trustProxy = { enabled: draft.trustEnabled, value: draft.trustValue }
  }
  if (draft.cookieSecure !== initial.cookieSecure) patch.cookieSecure = draft.cookieSecure
  if (draft.origins.trim() !== initial.origins) {
    patch.allowedOrigins = draft.origins.split(',').map((o) => o.trim()).filter(Boolean)
  }
  if (draft.keepalive.trim() !== initial.keepalive) patch.consoleKeepalive = Number(draft.keepalive)
  if (editingSecret && draft.secret) patch.sessionSecret = draft.secret
  const dirty = Object.keys(patch).length > 0

  async function save(p: ServerConfigPatch, message: string) {
    setSaving(true)
    try {
      onConfig(await adminApi.saveConfig(p))
      toast('success', message)
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  const { host } = config
  // A Host IP set in .env that is not an address of the server is ignored (the detected one is used)
  const envIpIgnored = config.hostIp.source === 'env' && config.hostIp.value && config.hostIp.value !== host.ip
  const ipWrong = host.ipIsLocal === false && draft.hostIp.trim() === host.ip
  const secretTooShort = editingSecret && draft.secret.length > 0 && draft.secret.length < 32
  const ka = config.consoleKeepalive
  const kaValue = Number(draft.keepalive)
  const keepaliveInvalid = draft.keepalive.trim() === '' || !Number.isInteger(kaValue) || (kaValue !== 0 && (kaValue < ka.min || kaValue > ka.max))
  const trustOn = draft.trustEnabled

  return (
    <Card
      title="Server & access"
      description="Values from the .env file are shown here and can be overridden: what you save here takes precedence over .env."
      icon={<Server size={18} />}
      actions={
        dirty && (
          <>
            <Button size="xs" icon={<Undo2 size={12} />} disabled={saving} onClick={() => (setDraft(initial), setEditingSecret(false))}>
              Discard
            </Button>
            <Button
              size="xs"
              variant="primary"
              icon={<Save size={12} />}
              loading={saving}
              disabled={secretTooShort || keepaliveInvalid}
              onClick={() => void save(patch, 'Server settings saved')}
            >
              Save
            </Button>
          </>
        )
      }
    >
      {/* Host IP */}
      <div>
        <SettingRow
          label={
            <>
              Host IP
              <SourceBadge source={config.hostIp.source === 'env' && envIpIgnored ? 'auto' : config.hostIp.source} />
            </>
          }
          description="Shown in the header and used for the LAN IP:Port links. Detected automatically; type another address to override it."
        >
          <div className="flex items-center gap-2">
            <input
              className={`${monoCls} w-full sm:w-44 ${ipWrong ? '!border-amber-500 !bg-amber-500/5' : ''}`}
              value={draft.hostIp}
              inputMode="decimal"
              onChange={(e) => set({ hostIp: e.target.value })}
            />
            {config.hostIp.source === 'settings' && (
              <Button size="md" icon={<RotateCcw size={13} />} title="Go back to the automatic IP" disabled={saving} onClick={() => void save({ hostIp: '' }, 'Host IP is automatic again')}>
                Auto
              </Button>
            )}
          </div>
        </SettingRow>
        {ipWrong && (
          <Note tone="warn">
            This IP is not correct: it is not an address of this server
            {host.detectedIp ? ` (detected: ${host.detectedIp})` : ''}. LAN links will not work with it.
          </Note>
        )}
        {envIpIgnored && (
          <Note tone="warn">
            HOST_IP={config.hostIp.value} in the .env file is not correct (not an address of this server), so the detected IP is used. Remove
            it from .env or save the right one here.
          </Note>
        )}
        {host.ipIsLocal === null && <Note>The IP could not be checked against the server's addresses.</Note>}
      </div>

      {/* Host name */}
      <SettingRow
        label={
          <>
            Server name
            <SourceBadge source={config.hostName.source} />
          </>
        }
        description={`Shown in the header. Detected from Docker: ${host.autoName}.`}
      >
        <div className="flex items-center gap-2">
          <input className={`${selectCls} w-full sm:w-44`} value={draft.hostName} onChange={(e) => set({ hostName: e.target.value })} />
          {config.hostName.source === 'settings' && (
            <Button size="md" icon={<RotateCcw size={13} />} title="Use the name detected from Docker" disabled={saving} onClick={() => void save({ hostName: '' }, 'Server name is automatic again')}>
              Auto
            </Button>
          )}
        </div>
      </SettingRow>

      {/* Reverse proxy */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium">
              Trust a reverse proxy (TRUST_PROXY)
              <SourceBadge source={config.trustProxy.source} />
            </div>
            <p className="mt-0.5 text-xs text-muted">
              When you open DockerUpdates through a reverse proxy (e.g. Nginx Proxy Manager), the proxy tells it the visitor's real IP and
              whether the connection is HTTPS, using X-Forwarded-* headers. Turn this on and enter the proxy's IP so only it is trusted: the
              login lockout then works per visitor, and nobody else on your network can fake their IP.
            </p>
          </div>
          <Toggle label="Trust a reverse proxy" checked={trustOn} onChange={(v) => set({ trustEnabled: v })} />
        </div>
        <div className={`mt-3 transition-opacity ${trustOn ? '' : 'pointer-events-none opacity-45'}`}>
          <input
            className={monoCls}
            disabled={!trustOn}
            placeholder="Proxy IP, e.g. 192.168.1.10 (several: comma separated, ranges like 172.18.0.0/16)"
            value={draft.trustValue}
            onChange={(e) => set({ trustValue: e.target.value })}
          />
        </div>
        {!trustOn && <Note tone="warn">Off: any device on a private network may send X-Forwarded-For.</Note>}
      </div>

      {/* Cookie */}
      <div>
        <SettingRow
          label={
            <>
              HTTPS-only session cookie (COOKIE_SECURE)
              <SourceBadge source={config.cookieSecure.source} />
            </>
          }
          description="The browser only sends the login cookie over HTTPS. Turn it on when you always open DockerUpdates through https://."
        >
          <Toggle label="HTTPS-only session cookie" checked={draft.cookieSecure} onChange={(v) => set({ cookieSecure: v })} />
        </SettingRow>
        {draft.cookieSecure && !config.connectionSecure && (
          <Note tone="warn">You are using plain HTTP right now: with this on, signing in over http:// will no longer work.</Note>
        )}
      </div>

      {/* Allowed origins */}
      <SettingRow
        label={
          <>
            Extra allowed origins (ALLOWED_ORIGINS)
            <SourceBadge source={config.allowedOrigins.source} />
          </>
        }
        description="Other addresses allowed to call the API. Normally empty: only needed if your proxy changes the Host header."
      >
        <input className={`${monoCls} w-full sm:w-72`} placeholder="https://docker.example.com" value={draft.origins} onChange={(e) => set({ origins: e.target.value })} />
      </SettingRow>

      {/* Console keep-alive */}
      <div>
        <SettingRow
          label={
            <>
              Console keep-alive (CONSOLE_WS_KEEPALIVE)
              <SourceBadge source={ka.source} />
            </>
          }
          description="Reverse proxies close a console left idle (Nginx Proxy Manager after 60 s). A ping every this many seconds keeps it open. 0 = off; 25 works for Nginx Proxy Manager."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={ka.max}
              className={`${selectCls} w-24 ${keepaliveInvalid ? '!border-amber-500' : ''}`}
              value={draft.keepalive}
              onChange={(e) => set({ keepalive: e.target.value })}
            />
            <span className="w-16 text-xs text-muted">seconds</span>
          </div>
        </SettingRow>
        {keepaliveInvalid && <Note tone="warn">Use 0 (off) or {ka.min} to {ka.max} seconds.</Note>}
        {!keepaliveInvalid && kaValue === 0 && <Note>Off: an idle console may be closed by your reverse proxy. Applies to consoles opened after saving.</Note>}
        {!keepaliveInvalid && kaValue > 0 && <Note>Applies to consoles opened after saving.</Note>}
      </div>

      {/* Session secret */}
      <div>
        <SettingRow
          label={
            <>
              Session secret (SESSION_SECRET)
              <SourceBadge source={config.sessionSecret.source} />
            </>
          }
          description="Signs the login cookies. Changing it signs out every other session."
        >
          {!editingSecret ? (
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 text-sm ${config.sessionSecret.set ? 'text-emerald-600 dark:text-emerald-400' : warnText}`}>
                {config.sessionSecret.set ? <CircleCheck size={14} /> : <CircleAlert size={14} />}
                {config.sessionSecret.set ? 'Configured' : 'Not set'}
              </span>
              <Button size="md" onClick={() => (setEditingSecret(true), set({ secret: randomSecret() }))}>
                Change
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input className={`${monoCls} w-full sm:w-72`} value={draft.secret} onChange={(e) => set({ secret: e.target.value })} />
              <Button size="md" icon={<RefreshCw size={13} />} title="Generate a new random secret" onClick={() => set({ secret: randomSecret() })}>
                New
              </Button>
            </div>
          )}
        </SettingRow>
        {!config.sessionSecret.set && !editingSecret && <Note tone="warn">A random secret is used: everyone is signed out on every restart.</Note>}
        {editingSecret && (
          <Note tone={secretTooShort ? 'warn' : 'info'}>
            {secretTooShort ? 'At least 32 characters.' : 'A random secret was generated. It is only shown now: after saving it appears as "Configured".'}
          </Note>
        )}
      </div>

      {/* Environment only */}
      <div className="rounded-xl border border-line bg-surface-2/40 p-4 text-sm">
        <p className="mb-2 text-xs font-medium text-muted">Only in the .env file (recreate the container to change them)</p>
        <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">PORT</dt>
          <dd className="font-mono text-xs">{config.readOnly.port}</dd>
          <dt className="text-muted">Docker connection</dt>
          <dd className="font-mono text-xs break-all">{config.readOnly.docker}</dd>
        </dl>
      </div>
    </Card>
  )
}

// ---------- Registry credentials ----------

function RegistryCard({ config, onConfig, toast, onError }: CardProps & Pick<Props, 'onError'>) {
  const initial = config.registryAuth.value
  const [rows, setRows] = useState<RegistryCredential[]>(initial)
  const [saving, setSaving] = useState(false)

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial)
  const update = (i: number, p: Partial<RegistryCredential>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...p } : row)))

  async function save() {
    setSaving(true)
    try {
      onConfig(await adminApi.saveConfig({ registryAuth: rows }))
      toast('success', 'Registry credentials saved')
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title="Registry credentials"
      description="Logins for private registries, used to check and pull updates (REGISTRY_AUTH). Use a read-only token."
      icon={<KeyRound size={18} />}
      actions={
        dirty && (
          <>
            <Button size="xs" icon={<Undo2 size={12} />} disabled={saving} onClick={() => setRows(initial)}>
              Discard
            </Button>
            <Button size="xs" variant="primary" icon={<Save size={12} />} loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </>
        )
      }
    >
      {config.registryAuth.source === 'env' && <Note>These come from REGISTRY_AUTH in the .env file. Saving here replaces that list.</Note>}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line py-6 text-center text-sm text-muted">
          No registry credentials. Public images do not need any.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <input className={monoCls} placeholder="Registry, e.g. ghcr.io" value={r.registry} onChange={(e) => update(i, { registry: e.target.value })} />
              <input className={selectCls} placeholder="Username" autoComplete="off" value={r.username} onChange={(e) => update(i, { username: e.target.value })} />
              <input
                type="password"
                className={monoCls}
                placeholder="Token"
                autoComplete="new-password"
                value={r.password}
                // Typing replaces the stored token (shown as a mask)
                onFocus={(e) => e.target.select()}
                onChange={(e) => update(i, { password: e.target.value })}
              />
              <Button size="md" variant="ghost" icon={<Trash2 size={14} />} aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
      <Button size="sm" icon={<Plus size={14} />} onClick={() => setRows((r) => [...r, { registry: '', username: '', password: '' }])}>
        Add registry
      </Button>
    </Card>
  )
}
