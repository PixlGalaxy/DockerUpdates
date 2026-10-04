import { ArrowDownToLine, Clock, Download, Eraser, ScrollText, Search, WrapText } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ContainerInfo } from '../types'
import Modal from './Modal'

interface Line {
  s: 'out' | 'err'
  t: string
}

const MAX_LINES = 10_000
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/** "2026-10-04T05:12:01.123456789Z message" -> [time, message] */
function splitTimestamp(line: string): [string, string] {
  const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s(.*)$/s)
  if (!m) return ['', line]
  return [new Date(m[1]).toLocaleString(), m[2]]
}

export default function LogsModal({ container, onClose }: { container: ContainerInfo; onClose: () => void }) {
  const [lines, setLines] = useState<Line[]>([])
  const [status, setStatus] = useState<'connecting' | 'live' | 'ended' | 'error'>('connecting')
  const [error, setError] = useState('')
  const [tail, setTail] = useState(500)
  const [follow, setFollow] = useState(true)
  const [showTime, setShowTime] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const es = new EventSource(`/api/containers/${container.id}/logs/stream?tail=${tail}`)
    es.addEventListener('open', () => setStatus('live'))
    es.addEventListener('lines', (e) => {
      const batch: Line[] = JSON.parse((e as MessageEvent).data)
      setLines((prev) => {
        const next = prev.concat(batch.map((l) => ({ s: l.s, t: l.t.replace(ANSI, '') })))
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
      })
    })
    es.addEventListener('end', () => {
      setStatus('ended')
      es.close()
    })
    es.addEventListener('failure', (e) => {
      setStatus('error')
      setError(JSON.parse((e as MessageEvent).data).message)
      es.close()
    })
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setStatus((s) => (s === 'ended' ? s : 'error'))
    }
    return () => {
      es.close()
      setLines([])
      setStatus('connecting')
    }
  }, [container.id, tail])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? lines.filter((l) => l.t.toLowerCase().includes(q)) : lines
  }, [lines, query])

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [visible, follow])

  function download() {
    const blob = new Blob([lines.map((l) => l.t).join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${container.name}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const statusDot = {
    connecting: 'bg-amber-500',
    live: 'bg-emerald-500 animate-pulse',
    ended: 'bg-zinc-400',
    error: 'bg-red-500',
  }[status]

  const toggleCls = (on: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
      on ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'border-line bg-surface text-muted hover:bg-surface-2'
    }`

  return (
    <Modal
      title={`Logs · ${container.name}`}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${statusDot}`} />
          {status === 'live' ? 'Live' : status === 'ended' ? 'Stream ended (container stopped)' : status === 'error' ? error || 'Disconnected' : 'Connecting…'}
          {' · '}
          {visible.length.toLocaleString()} lines
        </span>
      }
      icon={<ScrollText size={18} />}
      size="full"
      flush
      onClose={onClose}
    >
      <div className="flex h-[78vh] flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <div className="relative min-w-48 flex-1">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter lines…"
              className="h-8 w-full rounded-lg border border-line bg-surface pr-3 pl-8 text-sm focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
            />
          </div>
          <select
            value={tail}
            onChange={(e) => setTail(Number(e.target.value))}
            title="Lines loaded from history"
            className="h-8 rounded-lg border border-line bg-surface px-2 text-xs"
          >
            {[100, 500, 1000, 5000].map((n) => (
              <option key={n} value={n}>
                Last {n.toLocaleString()}
              </option>
            ))}
          </select>
          <button type="button" className={toggleCls(follow)} onClick={() => setFollow((f) => !f)}>
            <ArrowDownToLine size={13} /> Follow
          </button>
          <button type="button" className={toggleCls(showTime)} onClick={() => setShowTime((v) => !v)}>
            <Clock size={13} /> Time
          </button>
          <button type="button" className={toggleCls(wrap)} onClick={() => setWrap((v) => !v)}>
            <WrapText size={13} /> Wrap
          </button>
          <button type="button" className={toggleCls(false)} onClick={() => setLines([])}>
            <Eraser size={13} /> Clear
          </button>
          <button type="button" className={toggleCls(false)} onClick={download}>
            <Download size={13} /> Download
          </button>
        </div>

        <div
          ref={box}
          onScroll={(e) => {
            const el = e.currentTarget
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
            if (follow !== atBottom) setFollow(atBottom)
          }}
          className="min-h-0 flex-1 overflow-auto bg-[#0b0e14] px-4 py-3 font-mono text-[12px] leading-[1.55] text-zinc-200"
        >
          {visible.length === 0 && (
            <p className="text-zinc-500">{status === 'connecting' ? 'Loading logs…' : 'No log lines.'}</p>
          )}
          {visible.map((l, i) => {
            const [time, text] = splitTimestamp(l.t)
            return (
              <div key={i} className={`${wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'} ${l.s === 'err' ? 'text-red-300' : ''}`}>
                {showTime && time && <span className="mr-3 text-zinc-500 select-none">{time}</span>}
                {text || ' '}
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
