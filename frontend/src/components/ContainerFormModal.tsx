import { CircleAlert, CircleCheck, ImageIcon, LoaderCircle, Plus, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import type { ContainerSpec, RestartPolicy } from '../types'
import Logo from './Logo'
import { Button, IconButton } from './ui'

interface Props {
  mode: 'add' | 'edit'
  /** Current settings when editing */
  initial?: ContainerSpec
  onClose: () => void
  onSubmit: (spec: ContainerSpec) => Promise<void>
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
}

const inputCls =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none'

type ExtraCheck = { state: 'idle' | 'checking' } | { state: 'ok'; summary: string[] } | { state: 'error'; message: string }

export default function ContainerFormModal({ mode, initial, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<ContainerSpec>(initial ?? EMPTY)
  const [networks, setNetworks] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extraCheck, setExtraCheck] = useState<ExtraCheck>({ state: 'idle' })
  const [iconBroken, setIconBroken] = useState(false)
  const checkSeq = useRef(0)
  const editing = mode === 'edit'

  useEffect(() => {
    api.networks().then(setNetworks, () => setNetworks([]))
  }, [])

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

  const networkOptions = [...new Set(['bridge', 'host', 'none', ...networks, form.network])].filter(Boolean)

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
          <IconButton label="Close" className="ml-auto" onClick={onClose} disabled={saving}>
            <X size={18} />
          </IconButton>
        </div>

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
                {networkOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Restart policy">
              <select
                className={inputCls}
                value={form.restart}
                onChange={(e) => patch({ restart: e.target.value as RestartPolicy })}
              >
                <option value="no">no</option>
                <option value="always">always</option>
                <option value="unless-stopped">unless-stopped</option>
                <option value="on-failure">on-failure</option>
              </select>
            </Field>
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
            {form.volumes.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${inputCls} font-mono`} placeholder="/data" value={v.container} onChange={(e) => updateAt('volumes', i, { container: e.target.value })} />
                <input className={`${inputCls} font-mono`} placeholder="/mnt/user/appdata/app or volume name" value={v.host} onChange={(e) => updateAt('volumes', i, { host: e.target.value })} />
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
              placeholder="--memory=2g --cpus=1.5 --restart=unless-stopped"
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
