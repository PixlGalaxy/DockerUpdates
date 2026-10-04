import { ChevronLeft, ChevronRight, Download, Pause, Play, RefreshCw, ScrollText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { LogChannel, LogEntry, LogLevel, LogPage } from '../../adminTypes'
import { adminApi } from '../../api'
import { Button } from '../../components/ui'
import { selectCls } from '../../schedule'
import { Loading, Panel, type SectionProps } from './shared'

const PAGE_SIZES = [100, 250, 1000]

const CHANNEL_STYLE: Record<LogChannel, string> = {
  AUDIT: 'bg-violet-500/20 text-violet-300',
  APP: 'bg-sky-500/20 text-sky-300',
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  INFO: 'text-zinc-200',
  WARN: 'text-amber-300',
  ERROR: 'text-red-300',
}

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))

export default function LogsSection({ onError }: SectionProps) {
  const [limit, setLimit] = useState(PAGE_SIZES[0])
  const [page, setPage] = useState(1)
  const [channel, setChannel] = useState<LogChannel | ''>('')
  const [level, setLevel] = useState<LogLevel | ''>('')
  const [paused, setPaused] = useState(false)
  const [data, setData] = useState<LogPage | null>(null)
  const newestId = useRef(0)

  // Only page 1 has a "newest" edge to follow; older pages would shift under the reader
  const live = !paused && page === 1

  // Bumped by Refresh / Resume to fetch the current page again
  const [reload, setReload] = useState(0)
  const load = () => setReload((n) => n + 1)

  useEffect(() => {
    let cancelled = false
    adminApi.logs(limit, page, { channel: channel || undefined, level: level || undefined }).then((next) => {
      if (cancelled) return
      newestId.current = Math.max(newestId.current, next.entries[0]?.id ?? 0)
      setData(next)
    }, onError)
    return () => {
      cancelled = true
    }
  }, [limit, page, channel, level, onError, reload])

  useEffect(() => {
    if (!live) return
    const source = new EventSource(adminApi.logsStreamUrl(newestId.current))
    source.onmessage = (event) => {
      // A reconnect replays from the original position: skip what is already shown
      const all = (JSON.parse(event.data) as LogEntry[]).filter((e) => e.id > newestId.current)
      if (!all.length) return
      newestId.current = all[all.length - 1].id
      const fresh = all.filter((e) => (!channel || e.channel === channel) && (!level || e.level === level))
      if (!fresh.length) return
      setData((current) => {
        if (!current) return current
        const total = Math.min(current.total + fresh.length, current.capacity)
        return {
          ...current,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
          entries: [...fresh.reverse(), ...current.entries].slice(0, limit),
        }
      })
    }
    return () => source.close()
  }, [live, limit, channel, level])

  function download() {
    if (!data) return
    const text = [...data.entries].reverse().map((e) => `${e.time} [${e.channel}] ${e.level.padEnd(5)} ${e.message}`).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `dockerupdates-server-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  const pages = data?.pages ?? 1
  const from = data && data.total > 0 ? (page - 1) * limit + 1 : 0
  const to = data ? Math.min(page * limit, data.total) : 0

  return (
    <Panel
      flush
      title="Server logs"
      icon={<ScrollText size={18} />}
      description={`DockerUpdates' own output, newest first. The last ${(data?.capacity ?? 5000).toLocaleString()} lines are kept in memory since the last restart.`}
      actions={
        <>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              live ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
            }`}
          >
            {live && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
            {live ? 'Live' : page !== 1 ? 'History' : 'Paused'}
          </span>
          {live ? (
            <Button size="xs" icon={<Pause size={12} />} onClick={() => setPaused(true)}>
              Pause
            </Button>
          ) : (
            <Button
              size="xs"
              variant="primary"
              icon={<Play size={12} />}
              onClick={() => {
                setPaused(false)
                if (page !== 1) setPage(1)
                else load()
              }}
            >
              Resume
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <select className={`${selectCls} h-8 w-36 text-xs`} value={channel} onChange={(e) => { setChannel(e.target.value as LogChannel | ''); setPage(1) }}>
          <option value="">All sources</option>
          <option value="AUDIT">Audit (logins, changes)</option>
          <option value="APP">App</option>
        </select>
        <select className={`${selectCls} h-8 w-32 text-xs`} value={level} onChange={(e) => { setLevel(e.target.value as LogLevel | ''); setPage(1) }}>
          <option value="">All levels</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warnings</option>
          <option value="ERROR">Errors</option>
        </select>
        <select className={`${selectCls} h-8 w-32 text-xs`} value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1) }} title="Lines per page">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n.toLocaleString()} per page
            </option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="xs" icon={<RefreshCw size={12} />} onClick={load}>
            Refresh
          </Button>
          <Button size="xs" icon={<Download size={12} />} onClick={download} disabled={!data?.entries.length}>
            Download
          </Button>
        </div>
      </div>

      <div className="max-h-[65vh] min-h-64 overflow-auto bg-[#0b0e14] py-2 font-mono text-[12px] leading-[1.55]">
        {!data ? (
          <Loading />
        ) : data.entries.length === 0 ? (
          <p className="px-4 py-6 text-zinc-500">No log lines{channel || level ? ' match these filters' : ''}.</p>
        ) : (
          data.entries.map((e) => (
            <div key={e.id} className="flex gap-3 px-4 py-0.5 hover:bg-white/[0.03]">
              <span className="shrink-0 text-zinc-500 select-none" title={e.time}>
                {formatTime(e.time)}
              </span>
              <span className={`h-fit w-12 shrink-0 rounded px-1 text-center text-[10px] font-semibold ${CHANNEL_STYLE[e.channel]}`}>{e.channel}</span>
              <span className={`w-10 shrink-0 font-semibold ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
              <span className={`min-w-0 flex-1 break-all whitespace-pre-wrap ${LEVEL_STYLE[e.level]}`}>{e.message}</span>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-sm text-muted">
        <span>
          {from.toLocaleString()} to {to.toLocaleString()} of {(data?.total ?? 0).toLocaleString()}
        </span>
        <div className="flex items-center gap-2">
          <Button size="xs" icon={<ChevronLeft size={12} />} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Newer
          </Button>
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <Button size="xs" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Older <ChevronRight size={12} />
          </Button>
        </div>
      </div>
    </Panel>
  )
}
