import { Activity, Bell, Brush, Globe2, LoaderCircle, Save, Send, Trash2, Undo2 } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api'
import Card, { SettingRow } from '../components/Card'
import LanNetworkCard from '../components/LanNetworkCard'
import ScheduleEditor from '../components/ScheduleEditor'
import { selectCls } from '../schedule'
import type { ToastTone } from '../components/Toasts'
import { Button, Toggle } from '../components/ui'
import type { CleanupPreview, Settings } from '../types'
import { formatBytes } from '../utils'

interface Props {
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
}

type Channel = 'discord' | 'telegram' | 'ntfy' | 'webhook'
type N = Settings['notifications']

const EVENT_LABELS: { key: keyof N['events']; label: string; description: string }[] = [
  { key: 'updateAvailable', label: 'Update available', description: 'A scheduled check found a new image (sent once per new version).' },
  { key: 'updated', label: 'Container updated', description: 'A container was updated to a new image.' },
  { key: 'updateFailed', label: 'Update failed', description: 'An update or check failed (e.g. registry login required).' },
  { key: 'cleanup', label: 'Image cleanup', description: 'Old images were removed and disk space was freed.' },
  { key: 'health', label: 'Health alerts', description: 'A container becomes unhealthy, recovers, crashes or keeps restarting.' },
]

const inputCls = `${selectCls} font-mono text-xs`

export default function SettingsPage({ toast, onError }: Props) {
  const [saved, setSaved] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [timezones, setTimezones] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState<Channel | null>(null)
  const [preview, setPreview] = useState<CleanupPreview | null>(null)
  const [cleaning, setCleaning] = useState(false)

  useEffect(() => {
    api.settings().then((s) => {
      setSaved(s)
      setDraft(structuredClone(s))
    }, onError)
    api.timezones().then(setTimezones, () => setTimezones([]))
  }, [onError])

  const cleanupMode = draft?.cleanup.mode
  useEffect(() => {
    if (!cleanupMode) return
    api.cleanupPreview(cleanupMode).then(setPreview, () => setPreview(null))
  }, [cleanupMode])

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])

  if (!draft || !saved) {
    return (
      <div className="flex justify-center py-20 text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  const n = draft.notifications
  const setN = (p: Partial<N>) => setDraft({ ...draft, notifications: { ...n, ...p } })
  const setChannel = <C extends Channel>(c: C, p: Partial<N[C]>) => setN({ [c]: { ...n[c], ...p } } as Partial<N>)
  const setCleanup = (p: Partial<Settings['cleanup']>) => setDraft({ ...draft, cleanup: { ...draft.cleanup, ...p } })

  async function save(): Promise<boolean> {
    setSaving(true)
    try {
      const { autoUpdate: _ignored, ...rest } = draft!
      void _ignored
      const s = await api.saveSettings(rest)
      setSaved(s)
      setDraft(structuredClone(s))
      toast('success', 'Settings saved')
      return true
    } catch (err) {
      onError(err)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function test(channel: Channel) {
    setTesting(channel)
    try {
      if (dirty && !(await save())) return
      await api.testNotification(channel)
      toast('success', `Test message sent to ${channel}`)
    } catch (err) {
      onError(err)
    } finally {
      setTesting(null)
    }
  }

  async function cleanNow() {
    if (!preview?.images.length) return
    if (!confirm(`Remove ${preview.images.length} image(s) and free ${formatBytes(preview.size)}?`)) return
    setCleaning(true)
    try {
      if (dirty && !(await save())) return
      const r = await api.runCleanup()
      toast(r.failed.length ? 'info' : 'success', `Removed ${r.count} image(s), freed ${formatBytes(r.freed)}${r.failed.length ? `, ${r.failed.length} skipped (in use)` : ''}`)
      setPreview(await api.cleanupPreview(draft!.cleanup.mode))
    } catch (err) {
      onError(err)
    } finally {
      setCleaning(false)
    }
  }

  const testBtn = (c: Channel) => (
    <Button size="xs" icon={<Send size={12} />} loading={testing === c} disabled={!n[c].enabled} onClick={() => void test(c)}>
      Test
    </Button>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted">Notifications, image cleanup and general options.</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Undo2 size={14} />} disabled={!dirty || saving} onClick={() => setDraft(structuredClone(saved))}>
            Discard
          </Button>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>

      <Card title="General" icon={<Globe2 size={18} />}>
        <SettingRow label="Time zone" description="Used for every schedule (auto-update and cleanup).">
          <input
            list="timezones"
            className={`${selectCls} w-64`}
            value={draft.timezone}
            onChange={(e) => setDraft({ ...draft, timezone: e.target.value })}
          />
          <datalist id="timezones">
            {timezones.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </SettingRow>
      </Card>

      <Card title="Notifications" description="Get notified about updates on Discord, Telegram, ntfy or any webhook." icon={<Bell size={18} />}>
        <div className="grid gap-3 sm:grid-cols-2">
          {EVENT_LABELS.map((e) => (
            <label key={e.key} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3 hover:bg-surface-2/50">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-sky-600"
                checked={n.events[e.key]}
                onChange={(ev) => setN({ events: { ...n.events, [e.key]: ev.target.checked } })}
              />
              <span>
                <span className="block text-sm font-medium">{e.label}</span>
                <span className="block text-xs text-muted">{e.description}</span>
              </span>
            </label>
          ))}
        </div>
        <SettingRow label="Include manual actions" description="Also notify when you update containers from the UI, not only automatic runs.">
          <Toggle label="Include manual actions" checked={n.includeManual} onChange={(includeManual) => setN({ includeManual })} />
        </SettingRow>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChannelCard
            name="Discord"
            color="bg-[#5865F2]"
            logo="D"
            enabled={n.discord.enabled}
            onEnabled={(enabled) => setChannel('discord', { enabled })}
            test={testBtn('discord')}
            help="Server settings → Integrations → Webhooks → New webhook → Copy URL. Messages use rich embeds."
          >
            <Input label="Webhook URL" type="password" value={n.discord.webhookUrl} placeholder="https://discord.com/api/webhooks/…" onChange={(webhookUrl) => setChannel('discord', { webhookUrl })} />
            <Input label="Mention (optional)" value={n.discord.mention} placeholder="<@&roleId> or @here" onChange={(mention) => setChannel('discord', { mention })} />
          </ChannelCard>

          <ChannelCard
            name="Telegram"
            color="bg-[#229ED9]"
            logo="T"
            enabled={n.telegram.enabled}
            onEnabled={(enabled) => setChannel('telegram', { enabled })}
            test={testBtn('telegram')}
            help="Create a bot with @BotFather, send it a message, then get your chat ID (e.g. from @userinfobot)."
          >
            <Input label="Bot token" type="password" value={n.telegram.botToken} placeholder="123456789:AA…" onChange={(botToken) => setChannel('telegram', { botToken })} />
            <Input label="Chat ID" value={n.telegram.chatId} placeholder="123456789 or -100… or @channel" onChange={(chatId) => setChannel('telegram', { chatId })} />
          </ChannelCard>

          <ChannelCard
            name="ntfy"
            color="bg-[#317f6f]"
            logo="n"
            enabled={n.ntfy.enabled}
            onEnabled={(enabled) => setChannel('ntfy', { enabled })}
            test={testBtn('ntfy')}
            help="Push notifications to your phone with the ntfy app (ntfy.sh or self-hosted)."
          >
            <Input label="Topic URL" value={n.ntfy.url} placeholder="https://ntfy.sh/my-docker-updates" onChange={(url) => setChannel('ntfy', { url })} />
            <Input label="Access token (optional)" type="password" value={n.ntfy.token} placeholder="tk_…" onChange={(token) => setChannel('ntfy', { token })} />
          </ChannelCard>

          <ChannelCard
            name="Webhook"
            color="bg-zinc-600"
            logo="{}"
            enabled={n.webhook.enabled}
            onEnabled={(enabled) => setChannel('webhook', { enabled })}
            test={testBtn('webhook')}
            help="POSTs a JSON payload. With a secret, the X-DockerUpdates-Signature header carries an HMAC-SHA256 of the body."
          >
            <Input label="URL" type="password" value={n.webhook.url} placeholder="https://example.com/hooks/docker" onChange={(url) => setChannel('webhook', { url })} />
            <Input label="Secret (optional)" type="password" value={n.webhook.secret} placeholder="shared secret" onChange={(secret) => setChannel('webhook', { secret })} />
          </ChannelCard>
        </div>
      </Card>

      <LanNetworkCard toast={toast} onError={onError} />

      <Card title="Health" description="Protect the server from containers stuck in a crash loop." icon={<Activity size={18} />}>
        <SettingRow
          label="Stop containers in a restart loop"
          description="If a container crashes within a minute of starting and Docker restarts it this many times in a row, it is stopped and you get a notification."
        >
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={2}
              max={50}
              disabled={!draft.health.stopRestartLoops}
              value={draft.health.maxRestarts}
              onChange={(e) => setDraft({ ...draft, health: { ...draft.health, maxRestarts: Number(e.target.value) } })}
              className={`${selectCls} w-20 disabled:opacity-40`}
            />
            <span className="text-xs text-muted">restarts</span>
            <Toggle
              label="Stop containers in a restart loop"
              checked={draft.health.stopRestartLoops}
              onChange={(stopRestartLoops) => setDraft({ ...draft, health: { ...draft.health, stopRestartLoops } })}
            />
          </div>
        </SettingRow>
      </Card>

      <Card title="Image cleanup" description="Free disk space by removing images that no container uses anymore." icon={<Brush size={18} />}>
        <SettingRow label="Remove old image after an update" description="Deletes the previous image right after a container is updated, if nothing else uses it.">
          <Toggle label="Remove old image after update" checked={draft.cleanup.removeOldImageAfterUpdate} onChange={(removeOldImageAfterUpdate) => setCleanup({ removeOldImageAfterUpdate })} />
        </SettingRow>
        <SettingRow label="What to remove" description="Unused images include tagged images you may want to keep (e.g. pulled but not running).">
          <select className={`${selectCls} w-64`} value={draft.cleanup.mode} onChange={(e) => setCleanup({ mode: e.target.value as 'dangling' | 'unused' })}>
            <option value="dangling">Dangling images only (recommended)</option>
            <option value="unused">All images not used by a container</option>
          </select>
        </SettingRow>
        <SettingRow label="Scheduled cleanup" description="Run the cleanup automatically on a schedule.">
          <Toggle label="Scheduled cleanup" checked={draft.cleanup.scheduled} onChange={(scheduled) => setCleanup({ scheduled })} />
        </SettingRow>
        {draft.cleanup.scheduled && <ScheduleEditor value={draft.cleanup.schedule} onChange={(schedule) => setCleanup({ schedule })} />}

        <div className="rounded-xl border border-line bg-surface-2/40 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              {preview ? (
                <>
                  <span className="font-semibold">{preview.images.length}</span> image{preview.images.length === 1 ? '' : 's'} can be removed ·{' '}
                  <span className="font-semibold">{formatBytes(preview.size)}</span> reclaimable
                </>
              ) : (
                <span className="text-muted">Calculating…</span>
              )}
            </div>
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} loading={cleaning} disabled={!preview?.images.length} onClick={() => void cleanNow()}>
              Clean up now
            </Button>
          </div>
          {preview && preview.images.length > 0 && (
            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-line bg-surface">
              <table className="w-full text-left text-xs">
                <tbody>
                  {preview.images.map((img) => (
                    <tr key={img.id} className="border-t border-line first:border-t-0">
                      <td className="px-3 py-1.5 font-mono">{img.id}</td>
                      <td className="px-3 py-1.5 text-muted">{img.tags.join(', ') || '<none>'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{formatBytes(img.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {dirty && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-2xl border border-sky-500/30 bg-surface/95 px-4 py-3 shadow-xl backdrop-blur">
          <span className="text-sm font-medium">You have unsaved changes</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setDraft(structuredClone(saved))}>
              Discard
            </Button>
            <Button size="sm" variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function ChannelCard({
  name,
  color,
  logo,
  enabled,
  onEnabled,
  test,
  help,
  children,
}: {
  name: string
  color: string
  logo: string
  enabled: boolean
  onEnabled: (v: boolean) => void
  test: ReactNode
  help: string
  children: ReactNode
}) {
  return (
    <div className={`rounded-xl border p-4 transition-colors ${enabled ? 'border-sky-500/30 bg-sky-500/[0.03]' : 'border-line'}`}>
      <div className="flex items-center gap-3">
        <div className={`flex size-8 items-center justify-center rounded-lg text-sm font-bold text-white ${color}`}>{logo}</div>
        <span className="font-medium">{name}</span>
        <div className="ml-auto flex items-center gap-2">
          {test}
          <Toggle label={`Enable ${name}`} checked={enabled} onChange={onEnabled} />
        </div>
      </div>
      <div className={`mt-3 space-y-2.5 ${enabled ? '' : 'opacity-60'}`}>
        {children}
        <p className="text-[11px] text-muted">{help}</p>
      </div>
    </div>
  )
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: 'text' | 'password'
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        autoComplete="off"
        spellCheck={false}
        className={inputCls}
        value={value}
        placeholder={placeholder}
        onFocus={(e) => value === '********' && e.target.select()}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
