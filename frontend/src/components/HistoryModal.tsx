import { CircleCheck, CircleX, Clock, History, LoaderCircle, Timer, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ContainerInfo, HistoryEntry } from '../types'
import { timeAgo } from '../utils'
import Modal from './Modal'
import { Chip } from './ui'

const KIND = { version: 'version', revision: 'commit', image: 'image', reinstall: 'reinstalled' }

export default function HistoryModal({ container, onClose }: { container: ContainerInfo; onClose: () => void }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.history(container.name).then(setEntries, (e) => setError(e instanceof Error ? e.message : 'Could not load history'))
  }, [container.name])

  return (
    <Modal title={`Update history · ${container.name}`} subtitle={container.image} icon={<History size={18} />} size="md" onClose={onClose}>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!entries && !error && (
        <div className="flex justify-center py-10 text-muted">
          <LoaderCircle className="animate-spin" />
        </div>
      )}
      {entries?.length === 0 && (
        <div className="py-10 text-center">
          <History size={28} className="mx-auto text-muted/60" />
          <p className="mt-2 text-sm font-medium">No updates recorded yet</p>
          <p className="text-xs text-muted">Updates made from DockerUpdates (manual or automatic) appear here.</p>
        </div>
      )}
      {entries && entries.length > 0 && (
        <ol className="relative space-y-4 border-l border-line pl-6">
          {entries.map((e) => {
            const ok = e.result === 'success' || e.result === 'scheduled'
            return (
              <li key={e.id} className="relative">
                <span
                  className={`absolute top-0.5 -left-[33px] flex size-5 items-center justify-center rounded-full ring-4 ring-surface ${
                    ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
                  }`}
                >
                  {ok ? <CircleCheck size={12} /> : <CircleX size={12} />}
                </span>
                <div className="rounded-xl border border-line bg-surface-2/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">
                      {e.result === 'failed' ? 'Update failed' : e.result === 'scheduled' ? 'Self-update started' : e.kind === 'reinstall' ? 'Reinstalled' : 'Updated'}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        e.trigger === 'auto' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      }`}
                    >
                      {e.trigger === 'auto' && <Zap size={10} />}
                      {e.trigger}
                    </span>
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted" title={new Date(e.at).toLocaleString()}>
                      <Clock size={11} /> {timeAgo(e.at)} ago
                    </span>
                  </div>
                  {e.from && e.to && e.kind !== 'reinstall' && (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <span className="text-muted">{KIND[e.kind ?? 'image']}</span>
                      <Chip>{e.from}</Chip>
                      <span className="text-muted">→</span>
                      <Chip className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{e.to}</Chip>
                    </div>
                  )}
                  {e.error && <pre className="mt-2 overflow-x-auto rounded-lg bg-red-500/10 p-2 text-xs whitespace-pre-wrap text-red-600 dark:text-red-400">{e.error}</pre>}
                  <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
                    <span>{new Date(e.at).toLocaleString()}</span>
                    {e.durationMs != null && (
                      <span className="inline-flex items-center gap-1">
                        <Timer size={11} /> {(e.durationMs / 1000).toFixed(1)} s
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </Modal>
  )
}
