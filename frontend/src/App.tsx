import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, UnauthorizedError } from './api'
import ContainerFormModal from './components/ContainerFormModal'
import ContainerTable from './components/ContainerTable'
import Footer from './components/Footer'
import Header from './components/Header'
import Login from './components/Login'
import StatsCards, { type Filter } from './components/StatsCards'
import Toasts, { type Toast, type ToastTone } from './components/Toasts'
import Toolbar from './components/Toolbar'
import { useStoredState, useTheme } from './hooks'
import type {
  BulkSummary,
  CheckResult,
  CheckSummary,
  ContainerAction,
  ContainerInfo,
  ContainerSpec,
  UpdateAllSummary,
  UpdateResult,
} from './types'

const POLL_MS = 10_000
/** CPU / RAM refresh rate */
const STATS_TICK_MS = 1000

const ACTION_DONE: Record<ContainerAction, string> = {
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  pause: 'paused',
  unpause: 'resumed',
}

export default function App() {
  // undefined = checking session, null = signed out
  const [user, setUser] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    api.me().then(
      (r) => setUser(r.user),
      () => setUser(null),
    )
  }, [])

  if (user === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }
  if (user === null) {
    return (
      <div className="flex min-h-screen flex-col">
        <Login onLogin={setUser} />
        <Footer />
      </div>
    )
  }
  return <Dashboard user={user} onSignedOut={() => setUser(null)} />
}

function Dashboard({ user, onSignedOut }: { user: string; onSignedOut: () => void }) {
  const [theme, setTheme] = useTheme()
  const [advanced, setAdvanced] = useStoredState('du:advanced', true)
  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [hostIp, setHostIp] = useState('')
  const [hostName, setHostName] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [selfUpdating, setSelfUpdating] = useState(false)
  const [editing, setEditing] = useState<{ id: string; spec: ContainerSpec } | null>(null)
  const toastId = useRef(0)

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (tone: ToastTone, message: string) => {
      const id = ++toastId.current
      setToasts((t) => [...t.slice(-3), { id, tone, message }])
      setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 4000)
    },
    [dismissToast],
  )

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof UnauthorizedError) return onSignedOut()
      toast('error', err instanceof Error ? err.message : 'Something went wrong')
    },
    [onSignedOut, toast],
  )

  const load = useCallback(async () => {
    try {
      const data = await api.list()
      setContainers(data.containers)
      setHostIp(data.hostIp)
      setHostName(data.hostName)
      setLastUpdated(new Date())
    } catch (err) {
      handleError(err)
    } finally {
      setLoaded(true)
      setRefreshing(false)
    }
  }, [handleError])

  const refresh = useCallback(() => {
    setRefreshing(true)
    return load()
  }, [load])

  useEffect(() => {
    // State is only set after the fetch resolves, not synchronously.
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  /** `report` is a success message, or a callback that turns the result into toasts. */
  // Live CPU / RAM: lightweight endpoint served from cached docker stats streams
  useEffect(() => {
    let inFlight = false
    const tick = async () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const live = await api.stats()
        setContainers((cs) =>
          cs.map((c) => {
            const s = live[c.id]
            if (s) return { ...c, ...s }
            // Not running anymore: zero the meters until the next full refresh
            return c.state === 'running' ? c : { ...c, cpuPercent: 0, memUsage: 0 }
          }),
        )
      } catch (err) {
        if (err instanceof UnauthorizedError) onSignedOut()
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(tick, STATS_TICK_MS)
    return () => clearInterval(timer)
  }, [onSignedOut])

  async function withBusy<T>(id: string, fn: () => Promise<T>, report?: string | ((r: T) => void)) {
    setBusyIds((s) => new Set(s).add(id))
    try {
      const result = await fn()
      if (typeof report === 'function') report(result)
      else if (report) toast('success', report)
    } catch (err) {
      handleError(err)
    } finally {
      setBusyIds((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      await refresh()
    }
  }

  async function withGlobal<T>(key: string, fn: () => Promise<T>, report: (r: T) => void) {
    setGlobalBusy(key)
    try {
      report(await fn())
    } catch (err) {
      handleError(err)
    } finally {
      setGlobalBusy(null)
      await refresh()
    }
  }

  const nameOf = (id: string) => containers.find((c) => c.id === id)?.name ?? 'Container'

  /** DockerUpdates is being recreated by its helper container: wait for it to come back, then reload. */
  async function waitForSelfUpdate() {
    setSelfUpdating(true)
    const before = await api.version().then((r) => r.version).catch(() => null)
    const deadline = Date.now() + 3 * 60_000
    let wentDown = false
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000))
      try {
        const { version } = await api.version()
        if (wentDown || (before && version !== before)) {
          window.location.reload()
          return
        }
      } catch {
        wentDown = true
      }
    }
    setSelfUpdating(false)
    toast('error', 'DockerUpdates did not come back after updating. Check "docker ps -a" on the host.')
  }

  async function openEditor(id: string) {
    await withBusy(id, async () => setEditing({ id, spec: await api.spec(id) }))
  }

  function reportCheck(r: CheckResult) {
    if (r.status === 'up-to-date') toast('success', `${r.name} is up to date`)
    else if (r.status === 'update-available') toast('info', `Update available for ${r.name}`)
    else toast('error', r.message ?? `Could not check ${r.name}`)
  }

  function reportCheckAll(s: CheckSummary) {
    const parts = [`${s.available} update${s.available === 1 ? '' : 's'} available`, `${s.upToDate} up to date`]
    if (s.authRequired) parts.push(`${s.authRequired} need registry login`)
    if (s.local) parts.push(`${s.local} local`)
    if (s.failed) parts.push(`${s.failed} failed`)
    toast(s.authRequired || s.failed ? 'info' : 'success', `Check finished: ${parts.join(', ')}`)
  }

  function reportUpdate(r: UpdateResult) {
    if (r.selfUpdate) void waitForSelfUpdate()
    else toast('success', `${r.name} updated`)
  }

  function reportUpdateAll(s: UpdateAllSummary) {
    if (s.updated) toast('success', `${s.updated} container${s.updated === 1 ? '' : 's'} updated`)
    for (const f of s.failed) toast('error', `${f.name}: ${f.error}`)
    if (!s.updated && !s.failed.length && !s.selfUpdate) toast('info', 'Nothing to update')
    if (s.selfUpdate) void waitForSelfUpdate()
  }

  function reportBulk(action: ContainerAction, s: BulkSummary) {
    const n = `${s.affected} container${s.affected === 1 ? '' : 's'}`
    toast(s.failed ? 'error' : 'success', `${n} ${ACTION_DONE[action]}${s.failed ? `, ${s.failed} failed` : ''}`)
  }

  const stats = useMemo(() => {
    const running = containers.filter((c) => c.state === 'running').length
    return {
      total: containers.length,
      running,
      stopped: containers.length - running,
      updates: containers.filter((c) => c.updateStatus === 'update-available').length,
    }
  }, [containers])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return containers
      .filter((c) => {
        if (filter === 'running') return c.state === 'running'
        if (filter === 'stopped') return c.state !== 'running'
        if (filter === 'updates') return c.updateStatus === 'update-available'
        return true
      })
      .filter((c) => !q || [c.name, c.image, c.ip ?? '', c.network].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [containers, filter, search])

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast('info', 'Copied to clipboard')
    } catch {
      toast('error', 'Clipboard not available')
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined)
    onSignedOut()
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        hostIp={hostIp}
        hostName={hostName}
        user={user}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        theme={theme}
        onRefresh={refresh}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onAdd={() => setShowAdd(true)}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-[1800px] flex-1 space-y-5 px-4 py-6 sm:px-6">
        <StatsCards {...stats} filter={filter} onFilter={setFilter} />

        <Toolbar
          search={search}
          onSearch={setSearch}
          advanced={advanced}
          onAdvanced={setAdvanced}
          busy={globalBusy}
          updates={stats.updates}
          onBulk={(a) => withGlobal(a, () => api.bulk(a), (s) => reportBulk(a, s))}
          onCheckUpdates={() => withGlobal('check', api.checkAllUpdates, reportCheckAll)}
          onUpdateAll={() => withGlobal('update', api.updateAll, reportUpdateAll)}
        />

        <ContainerTable
          containers={visible}
          hostIp={hostIp}
          advanced={advanced}
          loading={!loaded}
          busyIds={busyIds}
          emptyMessage={search || filter !== 'all' ? 'No containers match your filters.' : 'No containers found.'}
          onAction={(id, a) => withBusy(id, () => api.action(id, a), `${nameOf(id)} ${ACTION_DONE[a]}`)}
          onRemove={(id) => withBusy(id, () => api.remove(id), `${nameOf(id)} removed`)}
          onAutostart={(id, enabled) =>
            withBusy(id, () => api.setAutostart(id, enabled), `Autostart ${enabled ? 'enabled' : 'disabled'} for ${nameOf(id)}`)
          }
          onCheckUpdate={(id) => withBusy(id, () => api.checkUpdate(id), reportCheck)}
          onUpdate={(id) => withBusy(id, () => api.update(id), reportUpdate)}
          onCopy={copy}
          onEdit={openEditor}
        />
      </main>

      <Footer />

      {showAdd && (
        <ContainerFormModal
          mode="add"
          onClose={() => setShowAdd(false)}
          onSubmit={async (spec) => {
            try {
              await api.create(spec)
            } catch (err) {
              if (err instanceof UnauthorizedError) onSignedOut()
              throw err
            }
            toast('success', `${spec.name} created`)
            await refresh()
          }}
        />
      )}

      {editing && (
        <ContainerFormModal
          mode="edit"
          initial={editing.spec}
          onClose={() => setEditing(null)}
          onSubmit={async (spec) => {
            const { id } = editing
            setBusyIds((s) => new Set(s).add(id))
            try {
              const r = await api.edit(id, spec)
              toast('success', `${r.name} updated with the new settings`)
            } catch (err) {
              if (err instanceof UnauthorizedError) onSignedOut()
              throw err
            } finally {
              setBusyIds((s) => {
                const next = new Set(s)
                next.delete(id)
                return next
              })
              await refresh()
            }
          }}
        />
      )}

      {selfUpdating && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-[fade-in_.15s_ease-out]">
          <div className="flex max-w-sm flex-col items-center rounded-2xl border border-line bg-surface p-8 text-center shadow-2xl">
            <LoaderCircle size={32} className="animate-spin text-sky-500" />
            <h2 className="mt-4 font-semibold">Updating DockerUpdates…</h2>
            <p className="mt-1 text-sm text-muted">The app is restarting with the new image. This page will reload automatically.</p>
          </div>
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
