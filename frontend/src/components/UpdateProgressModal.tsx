import { CircleAlert, CircleCheck, CloudDownload, LoaderCircle, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { OperationKind, OperationResult } from '../types'
import { failedCount } from '../utils'
import Modal from './Modal'
import { Button } from './ui'

interface Section {
  title: string
  lines: { key: string; text: string }[]
}

type Event =
  | { t: 'section'; title: string }
  | { t: 'line'; text: string }
  | { t: 'layer'; id: string; text: string }
  | { t: 'done'; ok: boolean; result?: OperationResult; error?: string }

interface Props {
  opId: string
  title: string
  kind?: OperationKind
  /** `finished`: false when closed while the update is still running */
  onClose: (finished: boolean) => void
  onSelfUpdate: () => void
}

/** Live log of an update or install, styled like Unraid's "Updating the container" window. */
export default function UpdateProgressModal({ opId, title, kind = 'update', onClose, onSelfUpdate }: Props) {
  const work = kind === 'install' ? 'installation' : 'update'
  const [sections, setSections] = useState<Section[]>([])
  const [done, setDone] = useState<Extract<Event, { t: 'done' }> | null>(null)
  const [lost, setLost] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  // Latest callback without re-subscribing: the parent re-renders every second (live stats)
  const selfUpdateRef = useRef(onSelfUpdate)
  useEffect(() => {
    selfUpdateRef.current = onSelfUpdate
  }, [onSelfUpdate])

  useEffect(() => {
    const es = new EventSource(`/api/operations/${opId}/stream`)
    let lineNo = 0
    // The server replays the whole log on every (re)connection: start from scratch each time
    es.addEventListener('title', () => {
      lineNo = 0
      setSections([])
    })
    es.onmessage = (msg) => {
      const e: Event = JSON.parse(msg.data)
      if (e.t === 'done') {
        setDone(e)
        es.close()
        if (e.ok && e.result && 'selfUpdate' in e.result && e.result.selfUpdate) selfUpdateRef.current()
        return
      }
      setSections((prev) => {
        const next = prev.slice()
        if (e.t === 'section') return [...next, { title: e.title, lines: [] }]
        const last = next.length ? { ...next[next.length - 1], lines: next[next.length - 1].lines.slice() } : { title: '', lines: [] }
        if (e.t === 'layer') {
          // Pull progress of a layer: update its line in place
          const i = last.lines.findIndex((l) => l.key === `layer:${e.id}`)
          if (i === -1) last.lines.push({ key: `layer:${e.id}`, text: e.text })
          else last.lines[i] = { key: `layer:${e.id}`, text: e.text }
        } else {
          last.lines.push({ key: `line:${lineNo++}`, text: e.text })
        }
        if (next.length) next[next.length - 1] = last
        else next.push(last)
        return next
      })
    }
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setLost(true)
    }
    return () => es.close()
  }, [opId])

  useEffect(() => {
    if (follow.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [sections, done])

  const failed = done && (!done.ok || failedCount(done.result) > 0)
  const state = !done ? 'In Progress' : failed ? 'Finished with errors' : 'Finished'

  return (
    <Modal
      title={
        <span className="inline-flex items-center gap-2">
          {title} - {state}
          {!done && <RefreshCw size={16} className="animate-spin text-sky-500" />}
        </span>
      }
      subtitle={
        done?.result
          ? summary(done.result)
          : lost && !done
            ? `Connection to the server lost — the ${work} keeps running in the background`
            : `You can close this window: the ${work} keeps running in the background`
      }
      icon={<CloudDownload size={18} />}
      size="xl"
      flush
      onClose={() => onClose(Boolean(done))}
    >
      <div className="flex h-[78dvh] flex-col">
        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          }}
          className="min-h-0 flex-1 space-y-5 overflow-auto bg-surface-2/40 px-5 py-5"
        >
          {sections.length === 0 && !done && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <LoaderCircle size={16} className="animate-spin" /> Starting…
            </div>
          )}
          {sections.map((s, i) => (
            <fieldset key={i} className="rounded-lg border border-line bg-surface px-4 pt-1 pb-3 shadow-xs">
              <legend className="px-1.5 font-mono text-xs font-bold">{s.title}</legend>
              <div className="font-mono text-[12px] leading-[1.7] break-words whitespace-pre-wrap">
                {s.lines.map((l) => (
                  <div
                    key={l.key}
                    className={
                      /^ERROR|^WARNING/.test(l.text)
                        ? 'text-red-600 dark:text-red-400'
                        : l.text === 'The command finished successfully!' || /^Successfully/.test(l.text)
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : ''
                    }
                  >
                    {l.text || ' '}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          {done && !done.ok && (
            <p className="flex items-center gap-2 font-mono text-sm text-red-600 dark:text-red-400">
              <CircleAlert size={16} /> {done.error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-center justify-center gap-2 border-t border-line px-5 py-4">
          {!done ? (
            <span className="flex items-center gap-1.5" aria-label="In progress">
              {[0, 150, 300].map((d) => (
                <span key={d} className="size-2.5 animate-bounce rounded-full bg-emerald-500" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
          ) : (
            <>
              {/* Result above the Done button, so the button stays centered */}
              <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${failed ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {failed ? <CircleAlert size={16} /> : <CircleCheck size={16} />} {failed ? 'Completed with errors' : 'Completed successfully'}
              </span>
              <Button variant="primary" onClick={() => onClose(true)}>
                Done
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function summary(r: OperationResult) {
  if (!('failed' in r)) return `${r.name} installed and started`
  const parts = []
  if (r.updated) parts.push(`${r.updated} updated`)
  if (r.selfUpdate) parts.push('DockerUpdates is restarting')
  if (r.failed.length) parts.push(`${r.failed.length} failed: ${r.failed.map((f) => f.name).join(', ')}`)
  return parts.join(' · ') || 'Nothing to update'
}
