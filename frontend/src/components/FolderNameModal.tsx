import { Folder } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import Modal from './Modal'
import { Button } from './ui'

interface Props {
  /** Current name (selected, ready to type over) */
  initial: string
  /** The folder was just made: the title says so */
  created?: boolean
  onSave: (name: string) => void
  onClose: () => void
}

/** Name of a folder of containers: asked right after making it, and from "Rename folder". */
export default function FolderNameModal({ initial, created, onSave, onClose }: Props) {
  const [name, setName] = useState(initial)
  const trimmed = name.trim()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!trimmed) return
    onSave(trimmed)
    onClose()
  }

  return (
    <Modal title={created ? 'New folder' : 'Rename folder'} icon={<Folder size={18} />} size="md" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          autoFocus
          maxLength={40}
          aria-label="Folder name"
          placeholder="Media, Databases…"
          className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
        />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>{created ? 'Keep "New folder"' : 'Cancel'}</Button>
          <Button type="submit" variant="primary" disabled={!trimmed}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  )
}
