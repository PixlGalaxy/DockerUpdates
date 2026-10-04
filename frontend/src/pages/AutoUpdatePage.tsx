import {
  BellRing,
  CalendarClock,
  CircleCheck,
  CloudDownload,
  HardDrive,
  LoaderCircle,
  Play,
  Save,
  ShieldCheck,
  Timer,
  Undo2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import Card, { SettingRow } from '../components/Card'
import ScheduleEditor from '../components/ScheduleEditor'
import { describeSchedule, selectCls } from '../schedule'
import type { ToastTone } from '../components/Toasts'
import { Button, Toggle } from '../components/ui'
import type { AutoAction, AutoUpdateStatus, ContainerAutoUpdate, Settings } from '../types'
import { gradientFor, timeAgo } from '../utils'

interface Props {
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
}

type AutoUpdate = Settings['autoUpdate']

const ACTIONS: { value: AutoAction; label: string; icon: typeof CloudDownload }[] = [
  { value: 'update', label: 'Check & update', icon: CloudDownload },
  { value: 'notify', label: 'Check & notify only', icon: BellRing },
]

export default function AutoUpdatePage({ toast, onError }: Props) {
  const [saved, setSaved] = useState<AutoUpdate | null>(null)
  const [draft, setDraft] = useState<AutoUpdate | null>(null)
  const [status, setStatus] = useState<AutoUpdateStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const loadStatus = useCallback(() => api.autoUpdateStatus().then(setStatus, onError), [onError])

  useEffect(() => {
    api.settings().then((s) => {
      setSaved(s.autoUpdate)
      setDraft(structuredClone(s.autoUpdate))
    }, onError)
    void loadStatus()
    const t = setInterval(() => void loadStatus(), 10_000)
    return () => clearInterval(t)
  }, [loadStatus, onError])

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft])

  if (!draft || !saved) {
    return (
      <div className="flex justify-center py-20 text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  const set = (p: Partial<AutoUpdate>) => setDraft({ ...draft, ...p })

  function containerConfig(name: string): ContainerAutoUpdate {
    return draft!.containers[name] ?? { mode: draft!.applyToAll ? 'global' : 'off' }
  }

  function setContainer(name: string, value: ContainerAutoUpdate) {
    set({ containers: { ...draft!.containers, [name]: value } })
  }

  async function save() {
    setSaving(true)
    try {
      const s = await api.saveSettings({ autoUpdate: draft! })
      setSaved(s.autoUpdate)
      setDraft(structuredClone(s.autoUpdate))
      toast('success', 'Auto-update settings saved')
      await loadStatus()
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  async function runNow() {
    setRunning(true)
    try {
      const r = await api.runAutoUpdate()
      toast('success', `Run finished: ${r.checked} checked, ${r.available} with updates, ${r.updated} updated${r.failed ? `, ${r.failed} failed` : ''}`)
      await loadStatus()
    } catch (err) {
      onError(err)
    } finally {
      setRunning(false)
    }
  }

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, { timeZone: status?.timezone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : '—'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Auto-Update</h1>
          <p className="text-sm text-muted">Check for new images on a schedule and update containers automatically.</p>
        </div>
        <div className="flex gap-2">
          <Button icon={<Undo2 size={14} />} disabled={!dirty || saving} onClick={() => setDraft(structuredClone(saved))}>
            Discard
          </Button>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={save}>
            Apply
          </Button>
        </div>
      </div>

      {/* Status strip */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatusTile
          label="Status"
          value={
            status?.running ? (
              <span className="inline-flex items-center gap-1.5 text-sky-600 dark:text-sky-400">
                <LoaderCircle size={14} className="animate-spin" /> Running…
              </span>
            ) : saved.enabled ? (
              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CircleCheck size={14} /> Enabled
              </span>
            ) : (
              <span className="text-muted">Disabled</span>
            )
          }
        />
        <StatusTile label="Next global run" value={fmt(status?.nextRun ?? null)} />
        <StatusTile
          label="Last run"
          value={
            status?.lastRun
              ? `${timeAgo(status.lastRun.at)} ago · ${status.lastRun.updated} updated${status.lastRun.failed ? `, ${status.lastRun.failed} failed` : ''}`
              : 'Never'
          }
          action={
            <Button size="xs" icon={<Play size={12} />} loading={running} disabled={!!status?.running} onClick={runNow}>
              Run now
            </Button>
          }
        />
      </div>

      <Card
        title="Global schedule"
        description="Applies to every container set to “Global”."
        icon={<CalendarClock size={18} />}
        actions={<Toggle label="Enable automatic updates" checked={draft.enabled} onChange={(enabled) => set({ enabled })} />}
      >
        <div className={draft.enabled ? '' : 'pointer-events-none opacity-50'}>
          <div className="space-y-5">
            <SettingRow label="Action" description="Update containers automatically, or only send a notification when an update is found.">
              <Segmented value={draft.action} onChange={(action) => set({ action })} />
            </SettingRow>
            <ScheduleEditor value={draft.schedule} onChange={(schedule) => set({ schedule })} />
            <SettingRow label="Apply to all containers" description="New containers follow the global schedule unless you change them below.">
              <Toggle label="Apply to all containers" checked={draft.applyToAll} onChange={(applyToAll) => set({ applyToAll })} />
            </SettingRow>
            <SettingRow label="Graceful stop timeout" description="Seconds to wait for a container to stop before it is killed during an update.">
              <div className="flex items-center gap-2">
                <Timer size={14} className="text-muted" />
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={draft.stopTimeout}
                  onChange={(e) => set({ stopTimeout: Number(e.target.value) })}
                  className={`${selectCls} w-24`}
                />
                <span className="text-xs text-muted">s</span>
              </div>
            </SettingRow>
          </div>
        </div>
      </Card>

      <Card title="Per-container" description="Use the global schedule, set a custom time for a container, or exclude it." icon={<ShieldCheck size={18} />}>
        <div className="-mx-5 -my-5 divide-y divide-line">
          {(status?.containers ?? []).map((c) => {
            const cfg = containerConfig(c.name)
            const open = expanded === c.name && cfg.mode === 'custom'
            return (
              <div key={c.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  {c.icon ? (
                    <img src={c.icon} alt="" className="size-8 rounded-lg border border-line bg-white object-contain p-0.5" />
                  ) : (
                    <div className={`flex size-8 items-center justify-center rounded-lg bg-gradient-to-br text-[11px] font-semibold text-white uppercase ${gradientFor(c.name)}`}>
                      {c.name.slice(0, 2)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {c.name}
                      {c.isSelf && <span className="ml-2 text-[10px] font-semibold text-sky-600 uppercase dark:text-sky-400">this app</span>}
                    </div>
                    <div className="truncate text-xs text-muted">
                      {c.local ? (
                        <span className="inline-flex items-center gap-1">
                          <HardDrive size={11} /> Local image, cannot be updated
                        </span>
                      ) : cfg.mode === 'off' ? (
                        'Excluded from automatic updates'
                      ) : cfg.mode === 'custom' && cfg.schedule ? (
                        `${describeSchedule(cfg.schedule)} · ${cfg.action === 'notify' ? 'notify only' : 'auto-update'}`
                      ) : (
                        `Global · ${describeSchedule(draft.schedule)}`
                      )}
                      {!dirty && c.nextRun && <span> · next {fmt(c.nextRun)}</span>}
                    </div>
                  </div>
                  <select
                    disabled={c.local}
                    className={`${selectCls} w-36`}
                    value={c.local ? 'off' : cfg.mode}
                    onChange={(e) => {
                      const mode = e.target.value as ContainerAutoUpdate['mode']
                      setContainer(c.name, mode === 'custom' ? { mode, action: cfg.action ?? draft.action, schedule: cfg.schedule ?? structuredClone(draft.schedule) } : { mode })
                      if (mode === 'custom') setExpanded(c.name)
                    }}
                  >
                    <option value="global">Global</option>
                    <option value="custom">Custom</option>
                    <option value="off">Off</option>
                  </select>
                  {cfg.mode === 'custom' && !c.local && (
                    <Button size="xs" onClick={() => setExpanded(open ? null : c.name)}>
                      {open ? 'Close' : 'Configure'}
                    </Button>
                  )}
                </div>
                {open && cfg.schedule && (
                  <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface-2/40 p-4">
                    <SettingRow label="Action">
                      <Segmented value={cfg.action ?? 'update'} onChange={(action) => setContainer(c.name, { ...cfg, action })} />
                    </SettingRow>
                    <ScheduleEditor compact value={cfg.schedule} onChange={(schedule) => setContainer(c.name, { ...cfg, schedule })} />
                  </div>
                )}
              </div>
            )
          })}
          {!status && (
            <div className="flex justify-center py-8 text-muted">
              <LoaderCircle className="animate-spin" />
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
            <Button size="sm" variant="primary" loading={saving} onClick={save}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function Segmented({ value, onChange }: { value: AutoAction; onChange: (v: AutoAction) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-surface-2/60 p-0.5">
      {ACTIONS.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === v ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
          }`}
        >
          <Icon size={13} /> {label}
        </button>
      ))}
    </div>
  )
}

function StatusTile({ label, value, action }: { label: string; value: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-sm">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate text-sm font-semibold">{value}</div>
      </div>
      {action}
    </div>
  )
}
