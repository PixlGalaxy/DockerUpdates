import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, UnauthorizedError } from './api'
import AddContainerModal from './components/AddContainerModal'
import ContainerTable from './components/ContainerTable'
import Footer from './components/Footer'
import Header from './components/Header'
import Login from './components/Login'
import StatsCards, { type Filter } from './components/StatsCards'
import Toasts, { type Toast, type ToastTone } from './components/Toasts'
import Toolbar from './components/Toolbar'
import { useStoredState, useTheme } from './hooks'
import type { ContainerAction, ContainerInfo } from './types'

const POLL_MS = 10_000

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
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [toasts, setToasts] = useState<Toast[]>([])
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

  async function withBusy(id: string, fn: () => Promise<unknown>, success?: string) {
    setBusyIds((s) => new Set(s).add(id))
    try {
      await fn()
      if (success) toast('success', success)
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

  async function withGlobal(key: string, fn: () => Promise<unknown>, success: string) {
    setGlobalBusy(key)
    try {
      await fn()
      toast('success', success)
    } catch (err) {
      handleError(err)
    } finally {
      setGlobalBusy(null)
      await refresh()
    }
  }

  const nameOf = (id: string) => containers.find((c) => c.id === id)?.name ?? 'Container'

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
          onBulk={(a) => withGlobal(a, () => api.bulk(a), `All containers ${ACTION_DONE[a]}`)}
          onCheckUpdates={() => withGlobal('check', api.checkAllUpdates, 'Update check finished')}
          onUpdateAll={() => withGlobal('update', api.updateAll, 'All containers updated')}
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
          onCheckUpdate={(id) => withBusy(id, () => api.checkUpdate(id))}
          onUpdate={(id) => withBusy(id, () => api.update(id), `${nameOf(id)} updated`)}
          onCopy={copy}
        />
      </main>

      <Footer />

      {showAdd && (
        <AddContainerModal
          onClose={() => setShowAdd(false)}
          onSubmit={async (data) => {
            try {
              await api.create(data)
            } catch (err) {
              if (err instanceof UnauthorizedError) onSignedOut()
              throw err
            }
            toast('success', `${data.name} created`)
            await refresh()
          }}
        />
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
