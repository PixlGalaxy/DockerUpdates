import { CircleAlert, Folder, ImageIcon, Layers } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import Modal from './Modal'
import { Button } from './ui'

interface Props {
  kind: 'stack' | 'folder'
  name: string
  /** Icon URL set now ('' = none) */
  initial: string
  /** Downloads and saves the icon ('' removes it); a URL that is not an image throws */
  onSave: (url: string) => Promise<void>
  onClose: () => void
}

/** Icon URL of a stack or folder, like the Icon URL of a container. */
export default function GroupIconModal({ kind, name, initial, onSave, onClose }: Props) {
  const [url, setUrl] = useState(initial)
  const [broken, setBroken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const value = url.trim()

  async function save(next: string) {
    setSaving(true)
    setError(null)
    try {
      await onSave(next)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setSaving(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void save(value)
  }

  return (
    <Modal title={`Icon of ${name}`} subtitle={`Shown on the ${kind} row instead of its symbol`} icon={<ImageIcon size={18} />} size="md" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-1 text-muted shadow-sm">
            {value && !broken ? (
              <img src={value} alt="" className="size-full object-contain" onError={() => setBroken(true)} />
            ) : kind === 'stack' ? (
              <Layers size={22} />
            ) : (
              <Folder size={22} />
            )}
          </span>
          <label className="block min-w-0 flex-1">
            <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium">
              Icon URL
              <span className="font-normal text-muted">png, jpg, webp, gif, svg or ico</span>
            </span>
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setBroken(false)
              }}
              autoFocus
              type="url"
              placeholder="https://example.com/logo.png"
              className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
            />
          </label>
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            <CircleAlert size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          {initial && (
            <Button variant="danger" className="mr-auto" disabled={saving} onClick={() => void save('')}>
              Remove icon
            </Button>
          )}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!value || value === initial}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
