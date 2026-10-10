import { ChevronDown, CircleAlert, FileCode2, Info, Layers, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { StackFile } from '../types'
import { Button } from './ui'

interface Props {
  mode: 'add' | 'edit'
  initial?: StackFile
  onClose: () => void
  /** Saves and deploys; a rejected file throws and stays in the editor */
  onSubmit: (stack: StackFile) => Promise<void>
}

const inputCls =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none'

const EXAMPLE = `services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
    depends_on:
      - cache
    restart: unless-stopped

  cache:
    image: redis:alpine
    volumes:
      - ./redis:/data
    restart: unless-stopped
`

/** Editor of a compose stack: compose.yaml and an optional .env, deployed with docker compose. */
export default function StackFormModal({ mode, initial, onClose, onSubmit }: Props) {
  const editing = mode === 'edit'
  const [name, setName] = useState(initial?.name ?? '')
  const [yaml, setYaml] = useState(initial?.yaml ?? '')
  const [env, setEnv] = useState(initial?.env ?? '')
  const [showEnv, setShowEnv] = useState(Boolean(initial?.env))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), yaml, env })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSaving(false)
    }
  }

  // Tab indents (two spaces, YAML does not allow tabs) instead of leaving the editor
  function indent(e: KeyboardEvent<HTMLTextAreaElement>, value: string, set: (v: string) => void) {
    if (e.key !== 'Tab' || e.shiftKey) return
    e.preventDefault()
    const el = e.currentTarget
    const { selectionStart: a, selectionEnd: b } = el
    set(value.slice(0, a) + '  ' + value.slice(b))
    requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-2 backdrop-blur-sm animate-[fade-in_.15s_ease-out] sm:p-8">
      <div className="absolute inset-0" onClick={() => !saving && onClose()} />
      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-3xl rounded-2xl border border-line bg-surface shadow-2xl animate-[pop-in_.18s_ease-out]"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
            <Layers size={20} />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold">{editing ? `Edit stack ${initial?.name}` : 'Add compose stack'}</h2>
            <p className="text-xs text-muted">
              {editing ? 'Saved and redeployed with docker compose up -d' : 'Paste a docker-compose file: every service is created together'}
            </p>
          </div>
        </div>

        <div className="space-y-4 px-4 py-5 sm:px-6">
          <label className="block">
            <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium">
              Stack name
              <span className="font-normal text-muted">compose project name: lowercase, digits, - and _</span>
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              disabled={editing}
              required
              pattern="[a-z0-9][a-z0-9_\-]*"
              placeholder="nextcloud"
              autoFocus={!editing}
              className={`${inputCls} h-9 disabled:opacity-60`}
            />
          </label>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium">
              <span className="inline-flex items-center gap-1.5">
                <FileCode2 size={13} /> compose.yaml
              </span>
              {!yaml.trim() && (
                <button type="button" onClick={() => setYaml(EXAMPLE)} className="font-medium text-sky-600 hover:underline dark:text-sky-400">
                  Insert example
                </button>
              )}
            </div>
            <textarea
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              onKeyDown={(e) => indent(e, yaml, setYaml)}
              required
              rows={18}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={'services:\n  app:\n    image: …'}
              className={`${inputCls} py-2 font-mono text-xs leading-relaxed`}
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowEnv((s) => !s)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
            >
              <ChevronDown size={13} className={`transition-transform ${showEnv ? '' : '-rotate-90'}`} />
              .env file (optional)
            </button>
            {showEnv && (
              <textarea
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                rows={5}
                spellCheck={false}
                placeholder={'MYSQL_PASSWORD=…\nTZ=America/Lima'}
                className={`${inputCls} mt-1.5 py-2 font-mono text-xs leading-relaxed`}
              />
            )}
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 px-3 py-2 text-xs text-muted">
            <Info size={14} className="mt-0.5 shrink-0 text-sky-500" />
            <span>
              The file is saved in DockerUpdates' stacks folder (relative paths like <code className="font-mono">./data</code> are
              created there, see <code className="font-mono">STACKS_DIR</code>). Updates of this stack run{' '}
              <code className="font-mono">docker compose pull</code> +{' '}
              <code className="font-mono">up -d</code>, so the file is always the source of truth.
            </span>
          </p>

          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span className="font-mono text-xs whitespace-pre-wrap">{error}</span>
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2/50 px-4 py-4 sm:px-6">
          {editing && (
            <span className="mr-auto hidden items-center gap-1.5 text-xs text-amber-600 sm:flex dark:text-amber-400">
              <TriangleAlert size={13} /> Changed services will be recreated
            </span>
          )}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving}>
            {saving ? 'Checking…' : editing ? 'Save & redeploy' : 'Deploy stack'}
          </Button>
        </div>
      </form>
    </div>
  )
}
