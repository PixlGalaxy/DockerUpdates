import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Network,
  FileDown,
  FileUp,
  ImageIcon,
  LayoutTemplate,
  LoaderCircle,
  MemoryStick,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import type { ContainerSpec, NetworkInfo, TemplateSummary } from '../types'
import { formatBytes } from '../utils'
import Logo from './Logo'
import { Button, IconButton, Toggle } from './ui'

interface Props {
  mode: 'add' | 'edit'
  /** Current settings when editing */
  initial?: ContainerSpec
  onClose: () => void
  onSubmit: (spec: ContainerSpec) => Promise<void>
  /** Host RAM in bytes (max of the memory slider) */
  hostMemTotal?: number
}

const MiB = 1024 ** 2
const GiB = 1024 ** 3

/** Accepts a template / exported file and keeps only known fields. */
function toSpec(data: unknown): ContainerSpec {
  if (!data || typeof data !== 'object') throw new Error('Invalid template file')
  const d = data as Partial<ContainerSpec>
  if (typeof d.image !== 'string' || !d.image) throw new Error('The template has no image')
  const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : [])
  return {
    ...EMPTY,
    name: typeof d.name === 'string' ? d.name : '',
    image: d.image,
    network: typeof d.network === 'string' ? d.network : 'bridge',
    restart: d.restart ?? 'unless-stopped',
    ports: arr(d.ports),
    volumes: arr<ContainerSpec['volumes'][number]>(d.volumes).map((v) => ({ ...v, mode: v.mode === 'ro' ? 'ro' : 'rw' })),
    env: arr(d.env),
    extraParams: typeof d.extraParams === 'string' ? d.extraParams : '',
    iconUrl: typeof d.iconUrl === 'string' ? d.iconUrl : '',
    memory: Number(d.memory) > 0 ? Number(d.memory) : 0,
    ip: typeof d.ip === 'string' ? d.ip : '',
  }
}

const EMPTY: ContainerSpec = {
  name: '',
  image: '',
  network: 'bridge',
  restart: 'unless-stopped',
  ports: [],
  volumes: [],
  env: [],
  extraParams: '',
  iconUrl: '',
  memory: 0,
  ip: '',
}

const inputCls =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none'

type ExtraCheck = { state: 'idle' | 'checking' } | { state: 'ok'; summary: string[] } | { state: 'error'; message: string }

export default function ContainerFormModal({ mode, initial, onClose, onSubmit, hostMemTotal = 0 }: Props) {
  const [form, setForm] = useState<ContainerSpec>({ ...EMPTY, ...initial })
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const [networks, setNetworks] = useState<NetworkInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraCheck, setExtraCheck] = useState<ExtraCheck>({ state: 'idle' })
  const [iconBroken, setIconBroken] = useState(false)
  const checkSeq = useRef(0)
  const editing = mode === 'edit'

  useEffect(() => {
    api.networks().then(setNetworks, () => setNetworks([]))
    if (mode === 'add') api.templates().then(setTemplates, () => setTemplates([]))
  }, [mode])

  async function loadTemplate(name: string) {
    if (!name) return
    try {
      setForm(toSpec(await api.template(name)))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load template')
    }
  }

  async function removeTemplate(name: string) {
    if (!confirm(`Delete template "${name}"?`)) return
    await api.deleteTemplate(name).catch(() => undefined)
    setTemplates((t) => t.filter((x) => x.name !== name))
  }

  function exportTemplate() {
    const blob = new Blob([JSON.stringify({ ...form, exportedBy: 'DockerUpdates' }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${form.name || 'container'}.dockerupdates.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function importTemplate(file: File) {
    try {
      if (file.size > 512 * 1024) throw new Error('File too large')
      const spec = toSpec(JSON.parse(await file.text()))
      setForm(mode === 'edit' ? { ...spec, name: form.name } : spec)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  // Validate Extra parameters on the server while typing (debounced)
  useEffect(() => {
    const seq = ++checkSeq.current
    const value = form.extraParams.trim()
    const timer = setTimeout(
      () => {
        if (!value) return setExtraCheck({ state: 'idle' })
        setExtraCheck({ state: 'checking' })
        api.checkExtraParams(value).then(
          (r) => seq === checkSeq.current && setExtraCheck({ state: 'ok', summary: r.summary }),
          (err) => seq === checkSeq.current && setExtraCheck({ state: 'error', message: err instanceof Error ? err.message : 'Invalid' }),
        )
      },
      value ? 400 : 0,
    )
    return () => clearTimeout(timer)
  }, [form.extraParams])

  const patch = (p: Partial<ContainerSpec>) => setForm((f) => ({ ...f, ...p }))

  function updateAt<K extends 'ports' | 'volumes' | 'env'>(
    key: K,
    index: number,
    value: Partial<ContainerSpec[K][number]>,
  ) {
    patch({
      [key]: form[key].map((item, i) => (i === index ? { ...item, ...value } : item)),
    } as Partial<ContainerSpec>)
  }

  function removeAt(key: 'ports' | 'volumes' | 'env', index: number) {
    patch({ [key]: form[key].filter((_, i) => i !== index) } as Partial<ContainerSpec>)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (extraCheck.state === 'error') return setError(`Extra parameters: ${extraCheck.message}`)
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        ...form,
        ports: form.ports.filter((p) => p.container),
        volumes: form.volumes.filter((v) => v.host && v.container),
        env: form.env.filter((v) => v.key),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSaving(false)
    }
  }

  const networkOptions = [...new Set(['bridge', 'host', 'none', ...networks.map((n) => n.name), form.network])].filter(Boolean)
  const selectedNetwork = networks.find((n) => n.name === form.network)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-[fade-in_.15s_ease-out] sm:p-8">
      <div className="absolute inset-0" onClick={() => !saving && onClose()} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-3xl rounded-2xl border border-line bg-surface shadow-2xl animate-[pop-in_.18s_ease-out]"
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl bg-sky-500/10">
            {form.iconUrl && !iconBroken ? (
              <img src={form.iconUrl} alt="" className="size-8 object-contain" onError={() => setIconBroken(true)} />
            ) : (
              <Logo size={26} />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{editing ? `Edit ${initial?.name}` : 'Add container'}</h2>
            <p className="text-xs text-muted">
              {editing
                ? 'Applying recreates the container with the new settings (it will restart).'
                : 'The image is pulled and the container started automatically.'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importTemplate(f)
                e.target.value = ''
              }}
            />
            <IconButton label="Import template (.json)" onClick={() => fileInput.current?.click()}>
              <FileUp size={16} />
            </IconButton>
            <IconButton label="Export template (.json)" onClick={exportTemplate} disabled={!form.image}>
              <FileDown size={16} />
            </IconButton>
            <IconButton label="Close" onClick={onClose} disabled={saving}>
              <X size={18} />
            </IconButton>
          </div>
        </div>

        {mode === 'add' && templates.length > 0 && (
          <div className="border-b border-line bg-surface-2/40 px-6 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
              <LayoutTemplate size={13} /> Templates
            </div>
            <div className="flex flex-wrap gap-1.5">
              {templates.map((t) => (
                <span key={t.name} className="group/tpl inline-flex items-center overflow-hidden rounded-lg border border-line bg-surface text-xs shadow-xs">
                  <button
                    type="button"
                    onClick={() => void loadTemplate(t.name)}
                    title={`${t.image} · saved ${new Date(t.savedAt).toLocaleString()}`}
                    className="px-2.5 py-1.5 font-medium hover:bg-sky-500/10 hover:text-sky-700 dark:hover:text-sky-300"
                  >
                    {t.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete template ${t.name}`}
                    onClick={() => void removeTemplate(t.name)}
                    className="border-l border-line px-1.5 py-1.5 text-muted hover:bg-red-500/10 hover:text-red-500"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6 px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input
                required
                autoFocus={!editing}
                className={inputCls}
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="my-app"
                pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]*"
              />
            </Field>
            <Field label="Repository" hint="e.g. n8nio/n8n:latest">
              <input
                required
                className={`${inputCls} font-mono`}
                value={form.image}
                onChange={(e) => patch({ image: e.target.value })}
                placeholder="owner/image:tag"
              />
            </Field>
            <Field label="Network">
              <select className={inputCls} value={form.network} onChange={(e) => patch({ network: e.target.value })}>
                {networkOptions.map((n) => {
                  const info = networks.find((x) => x.name === n)
                  return (
                    <option key={n} value={n}>
                      {n}
                      {info && info.driver !== n ? ` (${info.driver}${info.subnet ? ` ${info.subnet}` : ''})` : ''}
                    </option>
                  )
                })}
              </select>
            </Field>
            <FixedIpField
              network={form.network}
              info={selectedNetwork}
              lanNetwork={networks.find((n) => n.driver === 'macvlan' || n.driver === 'ipvlan')?.name}
              value={form.ip}
              container={mode === 'edit' ? initial?.name : undefined}
              onChange={(ip) => patch({ ip })}
            />
            <div className="block">
              <span className="mb-1.5 block text-xs font-medium">Restart</span>
              <label className="flex h-9 items-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-sm shadow-xs">
                <Toggle
                  label="Restart automatically"
                  checked={form.restart !== 'no'}
                  onChange={(on) => patch({ restart: on ? (form.restart === 'no' ? 'unless-stopped' : form.restart) : 'no' })}
                />
                <span>
                  Restart automatically <span className="font-mono text-xs text-muted">({form.restart === 'no' ? 'off' : form.restart})</span>
                </span>
              </label>
            </div>
            <MemoryField value={form.memory} max={hostMemTotal} onChange={(memory) => patch({ memory })} />
            <Field label="Icon URL" hint="png, jpg, webp, gif, svg or ico — empty = website favicon" className="sm:col-span-2">
              <div className="relative">
                <ImageIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <input
                  type="url"
                  className={`${inputCls} pl-9`}
                  value={form.iconUrl}
                  onChange={(e) => {
                    setIconBroken(false)
                    patch({ iconUrl: e.target.value })
                  }}
                  placeholder="https://example.com/icon.png"
                />
              </div>
              <p className="mt-1 text-[11px] text-muted">
                Shared by every container of this repository. Clear it to go back to the automatic favicon.
              </p>
            </Field>
          </div>

          <Section
            title="Port mappings"
            empty="No ports mapped."
            count={form.ports.length}
            onAdd={() => patch({ ports: [...form.ports, { host: '', container: '', protocol: 'tcp' }] })}
          >
            <ColumnHeads labels={['Host port (on the server)', 'Container port (inside the app)']} extra="w-24" />
            {form.ports.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input className={inputCls} placeholder="Host port (8080 or 127.0.0.1:8080)" value={p.host} onChange={(e) => updateAt('ports', i, { host: e.target.value })} />
                <input className={inputCls} placeholder="Container port" inputMode="numeric" value={p.container} onChange={(e) => updateAt('ports', i, { container: e.target.value })} />
                <select className={`${inputCls} !w-24`} value={p.protocol} onChange={(e) => updateAt('ports', i, { protocol: e.target.value as 'tcp' | 'udp' })}>
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
                <RemoveBtn onClick={() => removeAt('ports', i)} />
              </div>
            ))}
          </Section>

          <Section
            title="Volume mappings"
            empty="No volumes mapped."
            count={form.volumes.length}
            onAdd={() => patch({ volumes: [...form.volumes, { host: '', container: '', mode: 'rw' }] })}
          >
            <ColumnHeads labels={['Host path (on the server)', 'Container path (inside the app)']} extra="w-20" />
            {form.volumes.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${inputCls} font-mono`} placeholder="/mnt/user/appdata/app or volume name" aria-label="Host path" value={v.host} onChange={(e) => updateAt('volumes', i, { host: e.target.value })} />
                <input className={`${inputCls} font-mono`} placeholder="/data" aria-label="Container path" value={v.container} onChange={(e) => updateAt('volumes', i, { container: e.target.value })} />
                <select className={`${inputCls} !w-20`} value={v.mode} onChange={(e) => updateAt('volumes', i, { mode: e.target.value as 'rw' | 'ro' })}>
                  <option value="rw">RW</option>
                  <option value="ro">RO</option>
                </select>
                <RemoveBtn onClick={() => removeAt('volumes', i)} />
              </div>
            ))}
          </Section>

          <Section
            title="Environment variables"
            empty="No variables defined."
            count={form.env.length}
            onAdd={() => patch({ env: [...form.env, { key: '', value: '' }] })}
          >
            {form.env.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${inputCls} font-mono`} placeholder="KEY" value={v.key} onChange={(e) => updateAt('env', i, { key: e.target.value })} />
                <input className={`${inputCls} font-mono`} placeholder="value" value={v.value} onChange={(e) => updateAt('env', i, { value: e.target.value })} />
                <RemoveBtn onClick={() => removeAt('env', i)} />
              </div>
            ))}
          </Section>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Extra parameters</h3>
            <textarea
              rows={3}
              spellCheck={false}
              className={`${inputCls} h-auto py-2 font-mono text-xs leading-relaxed ${extraCheck.state === 'error' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : ''}`}
              value={form.extraParams}
              onChange={(e) => patch({ extraParams: e.target.value })}
              placeholder="--cpus=1.5 --hostname=myapp --log-opt max-size=10m"
            />
            <ExtraFeedback check={extraCheck} />
            <p className="mt-1 text-[11px] text-muted">
              docker run flags: --memory, --memory-swap, --cpus, --cpu-shares, --cpuset-cpus, --restart, --hostname, --label,
              --env, --add-host, --cap-add, --device, --privileged, --gpus, --shm-size, --log-opt, --user, --ulimit…
            </p>
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2/50 px-6 py-4">
          {editing && (
            <span className="mr-auto hidden items-center gap-1.5 text-xs text-amber-600 sm:flex dark:text-amber-400">
              <TriangleAlert size={13} /> The container will be recreated
            </span>
          )}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={extraCheck.state === 'error'}>
            {saving ? (editing ? 'Applying…' : 'Creating…') : editing ? 'Apply' : 'Create container'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ExtraFeedback({ check }: { check: ExtraCheck }) {
  if (check.state === 'checking') {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
        <LoaderCircle size={12} className="animate-spin" /> Validating…
      </p>
    )
  }
  if (check.state === 'error') {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
        <CircleAlert size={12} /> {check.message}
      </p>
    )
  }
  if (check.state === 'ok') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <CircleCheck size={12} className="text-emerald-500" />
        {check.summary.length === 0 ? (
          <span className="text-xs text-muted">Valid</span>
        ) : (
          check.summary.map((s) => (
            <span key={s} className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              {s}
            </span>
          ))
        )}
      </div>
    )
  }
  return null
}

function FixedIpField({
  network,
  info,
  lanNetwork,
  value,
  container,
  onChange,
}: {
  network: string
  info?: NetworkInfo
  /** macvlan / ipvlan network available on the server, if any */
  lanNetwork?: string
  value: string
  container?: string
  onChange: (ip: string) => void
}) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const supported = info?.fixedIp ?? false
  const reason = lanNetwork
    ? `Select the "${lanNetwork}" network to set a dedicated IP`
    : 'Enable macvlan in Settings to give this container a dedicated IP'

  async function check() {
    setChecking(true)
    setResult(null)
    try {
      const r = await api.checkIp(network, value.trim(), container)
      setResult({ ok: r.available, text: r.available ? 'IP available' : r.reason })
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : 'Check failed' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="sm:col-span-2">
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium">
        <span className="inline-flex items-center gap-1.5">
          <Network size={13} className="text-muted" /> Fixed IP
        </span>
        <span className="truncate font-normal text-muted">
          {supported ? `Empty = automatic${info?.subnet ? ` · subnet ${info.subnet}` : ''}` : reason}
        </span>
      </span>
      <div className="flex gap-2">
        <input
          className={`${inputCls} font-mono`}
          disabled={!supported}
          value={supported ? value : ''}
          onChange={(e) => {
            setResult(null)
            onChange(e.target.value)
          }}
          placeholder={supported ? (info?.gateway ? `e.g. ${info.gateway.replace(/\.\d+$/, '.50')}` : '192.168.0.50') : 'Automatic'}
          inputMode="decimal"
        />
        <Button
          size="md"
          icon={checking ? undefined : <Network size={14} />}
          loading={checking}
          disabled={!supported || !value.trim()}
          onClick={() => void check()}
        >
          Check
        </Button>
      </div>
      {result && (
        <p
          className={`mt-1.5 flex items-center gap-1.5 text-xs font-medium ${
            result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}
        >
          {result.ok ? <CircleCheck size={13} /> : <CircleX size={13} />}
          {result.text}
        </p>
      )}
    </div>
  )
}

/** Column titles above the rows of a mapping section (Ports / Volumes). */
function ColumnHeads({ labels, extra }: { labels: string[]; extra: string }) {
  return (
    <div className="flex gap-2 px-0.5 text-[10px] font-semibold tracking-wider text-muted uppercase">
      {labels.map((l) => (
        // Same colors as the table: container = sky, host = amber
        <span key={l} className={`flex-1 ${l.startsWith('Container') ? 'text-sky-600 dark:text-sky-400' : 'text-amber-600 dark:text-amber-400'}`}>
          {l}
        </span>
      ))}
      <span className={`shrink-0 ${extra}`} />
      <span className="w-9 shrink-0" />
    </div>
  )
}

function MemoryField({ value, max, onChange }: { value: number; max: number; onChange: (bytes: number) => void }) {
  const step = 64 * MiB
  const limit = max > 0 ? Math.floor(max / step) * step : 64 * GiB
  const pct = limit ? Math.min(100, (value / limit) * 100) : 0
  const presets = [512 * MiB, GiB, 2 * GiB, 4 * GiB, 8 * GiB].filter((p) => p < limit)
  return (
    <div className="sm:col-span-2">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium">
        <span className="inline-flex items-center gap-1.5">
          <MemoryStick size={13} className="text-muted" /> Memory limit
        </span>
        <span className="font-normal text-muted">{max > 0 ? `Host RAM: ${formatBytes(max)}` : ''}</span>
      </span>
      <div className="rounded-lg border border-line bg-surface px-3 py-2.5 shadow-xs">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={limit}
            step={step}
            value={Math.min(value, limit)}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Memory limit"
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-sky-600"
            style={{ background: `linear-gradient(to right, rgb(2 132 199) ${pct}%, var(--line) ${pct}%)` }}
          />
          <span className={`w-24 text-right font-mono text-sm font-semibold tabular-nums ${value ? '' : 'text-muted'}`}>
            {value ? formatBytes(value) : 'No limit'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          <button type="button" onClick={() => onChange(0)} className={presetCls(value === 0)}>
            No limit
          </button>
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => onChange(p)} className={presetCls(value === p)}>
              {formatBytes(p)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

const presetCls = (on: boolean) =>
  `rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
    on ? 'border-sky-500/50 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-line text-muted hover:bg-surface-2'
  }`

function Field({ label, hint, className = '', children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium">
        {label}
        {hint && <span className="truncate font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Section({
  title,
  empty,
  count,
  onAdd,
  children,
}: {
  title: string
  empty: string
  count: number
  onAdd: () => void
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">{title}</h3>
        <Button variant="ghost" size="xs" icon={<Plus size={13} />} onClick={onAdd}>
          Add
        </Button>
      </div>
      {count === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-xs text-muted">{empty}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <IconButton label="Remove" tone="danger" className="size-9 shrink-0" onClick={onClick}>
      <X size={16} />
    </IconButton>
  )
}
