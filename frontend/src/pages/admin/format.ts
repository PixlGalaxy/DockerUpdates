// Helpers shared by the Admin panel sections (kept apart from the components for fast refresh)
import { useEffect, useRef } from 'react'

/** Calls `fn` now and every `ms` while the tab is visible. */
export function usePolling(fn: () => Promise<void> | void, ms: number) {
  const ref = useRef(fn)
  useEffect(() => {
    ref.current = fn
  }, [fn])
  useEffect(() => {
    let inFlight = false
    const tick = async () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        await ref.current()
      } finally {
        inFlight = false
      }
    }
    void tick()
    const t = setInterval(tick, ms)
    return () => clearInterval(t)
  }, [ms])
}

/** "45s", "3m 12s", "2h 5m" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium', hour12: false }).format(new Date(iso))

const LOCAL_IPS = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1'])
export const formatIp = (ip: string | null | undefined) =>
  !ip ? '—' : LOCAL_IPS.has(ip) ? 'localhost' : ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1')

/** "Chrome on Windows" from a User-Agent string. */
export function describeAgent(agent: string): string {
  if (!agent) return 'Unknown device'
  const browser =
    /Edg\//.test(agent) ? 'Edge'
      : /OPR\/|Opera/.test(agent) ? 'Opera'
        : /Firefox\//.test(agent) ? 'Firefox'
          : /Chrome\//.test(agent) ? 'Chrome'
            : /Safari\//.test(agent) ? 'Safari'
              : /curl|wget|python|node|go-http/i.test(agent) ? 'Script'
                : 'Browser'
  const os =
    /Windows/.test(agent) ? 'Windows'
      : /Android/.test(agent) ? 'Android'
        : /iPhone|iPad|iOS/.test(agent) ? 'iOS'
          : /Mac OS X|Macintosh/.test(agent) ? 'macOS'
            : /Linux/.test(agent) ? 'Linux'
              : ''
  return os ? `${browser} on ${os}` : browser
}

export const thCls = 'py-2 pr-4 text-xs font-medium text-muted'
export const tdCls = 'py-2.5 pr-4 align-middle'
