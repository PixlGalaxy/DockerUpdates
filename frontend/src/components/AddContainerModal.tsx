import { Plus, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { NewContainer } from '../types'
import Logo from './Logo'
import { Button, IconButton } from './ui'

interface Props {
  onClose: () => void
  onSubmit: (data: NewContainer) => Promise<void>
}

const EMPTY: NewContainer = {
  name: '',
  image: '',
  network: 'bridge',
  restart: 'unless-stopped',
  ports: [],
  volumes: [],
  env: [],
}

const inputCls =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none'

export default function AddContainerModal({ onClose, onSubmit }: Props) {
  const [form, setForm] = useState<NewContainer>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const patch = (p: Partial<NewContainer>) => setForm((f) => ({ ...f, ...p }))

  function updateAt<K extends 'ports' | 'volumes' | 'env'>(
    key: K,
    index: number,
    value: Partial<NewContainer[K][number]>,
  ) {
    patch({
      [key]: form[key].map((item, i) => (i === index ? { ...item, ...value } : item)),
    } as Partial<NewContainer>)
  }

  function removeAt(key: 'ports' | 'volumes' | 'env', index: number) {
    patch({ [key]: form[key].filter((_, i) => i !== index) } as Partial<NewContainer>)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
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

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm animate-[fade-in_.15s_ease-out] sm:p-8">
      <div className="absolute inset-0" onClick={() => !saving && onClose()} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-2xl rounded-2xl border border-line bg-surface shadow-2xl animate-[pop-in_.18s_ease-out]"
      >
        <div className="flex items-center gap-3 border-b border-line px-6 py-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-sky-500/10">
            <Logo size={26} />
          </div>
          <div>
            <h2 className="font-semibold">Add container</h2>
            <p className="text-xs text-muted">The image is pulled and the container started automatically.</p>
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
                autoFocus
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
                <option value="bridge">bridge</option>
                <option value="host">host</option>
                <option value="none">none</option>
              </select>
            </Field>
            <Field label="Restart policy">
              <select
                className={inputCls}
                value={form.restart}
                onChange={(e) => patch({ restart: e.target.value as NewContainer['restart'] })}
              >
                <option value="no">no</option>
                <option value="always">always</option>
                <option value="unless-stopped">unless-stopped</option>
                <option value="on-failure">on-failure</option>
              </select>
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
                <input className={inputCls} placeholder="Host port" inputMode="numeric" value={p.host} onChange={(e) => updateAt('ports', i, { host: e.target.value })} />
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
            onAdd={() => patch({ volumes: [...form.volumes, { host: '', container: '' }] })}
          >
            {form.volumes.map((v, i) => (
              <div key={i} className="flex gap-2">
                <input className={`${inputCls} font-mono`} placeholder="/data" value={v.container} onChange={(e) => updateAt('volumes', i, { container: e.target.value })} />
                <input className={`${inputCls} font-mono`} placeholder="/mnt/user/appdata/app" value={v.host} onChange={(e) => updateAt('volumes', i, { host: e.target.value })} />
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

          {error && (
            <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2/50 px-6 py-4">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? 'Creating…' : 'Create container'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium">
        {label}
        {hint && <span className="font-normal text-muted">{hint}</span>}
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
