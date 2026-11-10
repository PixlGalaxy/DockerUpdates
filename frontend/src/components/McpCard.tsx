import { Bot, Check, Copy, KeyRound, Plug, TriangleAlert, Unplug } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { selectCls } from '../schedule'
import { MCP_LEVELS } from '../mcpLevels'
import type { McpAccess, McpLevel, Settings } from '../types'
import { timeAgo } from '../utils'
import Card, { SettingRow } from './Card'
import type { ToastTone } from './Toasts'
import { Button, Toggle } from './ui'

type Mcp = Settings['mcp']

interface Props {
  value: Mcp
  onChange: (value: Mcp) => void
  /** Saved state: the endpoint only answers once the toggle is saved */
  savedEnabled: boolean
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
}

/** Copy that also works over plain http on the LAN (navigator.clipboard needs HTTPS). */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // fall back below
  }
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}

/** Address only reachable from this network (claude.ai / ChatGPT connect from the internet). */
function isLocalAddress(): boolean {
  const { protocol, hostname } = window.location
  if (protocol !== 'https:') return true
  return (
    hostname === 'localhost' ||
    !hostname.includes('.') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.lan') ||
    /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(hostname)
  )
}

function CopyField({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-mono text-xs">{text}</code>
      <Button
        size="xs"
        icon={copied ? <Check size={12} /> : <Copy size={12} />}
        onClick={() => {
          void copyText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }}
        title={`Copy ${label}`}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export default function McpCard({ value, onChange, savedEnabled, toast, onError }: Props) {
  const [access, setAccess] = useState<McpAccess | null>(null)
  const [tokenName, setTokenName] = useState('')
  const [creating, setCreating] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const url = `${window.location.origin}/mcp`
  const local = isLocalAddress()

  const load = useCallback(() => api.mcp().then(setAccess, onError), [onError])
  useEffect(() => {
    void load()
  }, [load])

  async function createToken() {
    setCreating(true)
    try {
      const t = await api.createMcpToken(tokenName.trim())
      setNewToken(t.token)
      setTokenName('')
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setCreating(false)
    }
  }

  async function revoke(kind: 'token' | 'connection', id: string, name: string) {
    if (!confirm(kind === 'token' ? `Revoke the token "${name}"? Apps using it stop working.` : `Disconnect "${name}"? It has to be approved again to reconnect.`)) return
    try {
      await (kind === 'token' ? api.revokeMcpToken(id) : api.revokeMcpConnection(id))
      toast('success', kind === 'token' ? 'Token revoked' : `${name} disconnected`)
      await load()
    } catch (err) {
      onError(err)
    }
  }

  const level = MCP_LEVELS.find((l) => l.value === value.level) ?? MCP_LEVELS[0]

  return (
    <Card
      title="AI assistants (MCP)"
      description="Let Claude, ChatGPT and other AI apps see and manage your containers through the Model Context Protocol."
      icon={<Bot size={18} />}
      actions={<Toggle label="Allow AI assistants" checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} />}
    >
      <div className={`space-y-5 ${value.enabled ? '' : 'pointer-events-none opacity-50'}`}>
        <SettingRow label="Access level" description={level.description}>
          <select className={`${selectCls} w-56`} value={value.level} onChange={(e) => onChange({ ...value, level: e.target.value as McpLevel })}>
            {MCP_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </SettingRow>

        <SettingRow
          label="Data folder"
          description={
            <>
              Containers and stacks created by the AI keep their data in <span className="font-mono">{value.dataPath || access?.detectedDataPath || '<folder>'}/&lt;name&gt;/…</span>. Docker volumes are always refused.{' '}
              {access?.detectedDataPath
                ? `Empty = detected from your containers (${access.detectedDataPath}).`
                : 'Nothing could be detected from your containers: set it, or the AI will ask you.'}
            </>
          }
        >
          <input
            className={`${selectCls} w-64 font-mono`}
            value={value.dataPath}
            placeholder={access?.detectedDataPath ?? '/opt/appdata'}
            onChange={(e) => onChange({ ...value, dataPath: e.target.value })}
          />
        </SettingRow>

        <div className="space-y-2">
          <div className="text-sm font-medium">Server URL</div>
          <CopyField text={url} label="the MCP URL" />
          {value.enabled && !savedEnabled && <p className="text-xs text-amber-600 dark:text-amber-400">Save the settings to turn the endpoint on.</p>}
          {local && (
            <p className="flex gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <TriangleAlert size={14} className="mt-px shrink-0" />
              <span>
                claude.ai and ChatGPT connect from the internet and need an HTTPS domain (e.g. through Nginx Proxy Manager). Open DockerUpdates through that domain to get its URL. This address only works for apps running on this network, such as Claude Code.
              </span>
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
            <li>
              <b className="text-fg">Claude</b>: Settings → Connectors → Add custom connector, paste the URL, then Connect. DockerUpdates opens: sign in and approve.
            </li>
            <li>
              <b className="text-fg">ChatGPT</b>: Settings → Apps &amp; Connectors → Create (developer mode), paste the URL and choose OAuth. Approve it here the same way.
            </li>
            <li>
              <b className="text-fg">Claude Code</b>: <span className="font-mono">claude mcp add --transport http dockerupdates {url}</span>, then sign in with <span className="font-mono">/mcp</span>, or use an access token below.
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Plug size={14} /> Connected apps
          </div>
          {access?.connections.length ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {access.connections.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="text-xs text-muted">
                      Approved {timeAgo(c.created)} ago · last used {timeAgo(c.lastUsed)} ago{c.ip ? ` · ${c.ip}` : ''}
                    </div>
                  </div>
                  <Button size="xs" variant="danger" icon={<Unplug size={12} />} onClick={() => void revoke('connection', c.id, c.name)}>
                    Disconnect
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">No app connected yet. Changing your password disconnects every app.</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <KeyRound size={14} /> Access tokens
          </div>
          <p className="text-xs text-muted">For apps you configure by hand: send it as the header <span className="font-mono">Authorization: Bearer &lt;token&gt;</span>.</p>
          <div className="flex gap-2">
            <input
              className={`${selectCls} w-56`}
              value={tokenName}
              maxLength={60}
              placeholder="Name, e.g. Claude Code laptop"
              onChange={(e) => setTokenName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && tokenName.trim() && void createToken()}
            />
            <Button size="sm" loading={creating} disabled={!tokenName.trim()} onClick={() => void createToken()}>
              Create token
            </Button>
          </div>
          {newToken && (
            <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Copy it now: it is not shown again.</p>
              <CopyField text={newToken} label="the token" />
              <p className="text-xs text-muted">Claude Code:</p>
              <CopyField text={`claude mcp add --transport http dockerupdates ${url} --header "Authorization: Bearer ${newToken}"`} label="the command" />
              <Button size="xs" variant="ghost" onClick={() => setNewToken(null)}>
                Done
              </Button>
            </div>
          )}
          {!!access?.tokens.length && (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {access.tokens.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-xs text-muted">
                      Created {timeAgo(t.created)} ago · {t.lastUsed ? `last used ${timeAgo(t.lastUsed)} ago` : 'never used'}
                    </div>
                  </div>
                  <Button size="xs" variant="danger" onClick={() => void revoke('token', t.id, t.name)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
