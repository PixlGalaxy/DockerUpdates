import { LoaderCircle } from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { api, UnauthorizedError } from './api'
import Footer from './components/Footer'
import Header from './components/Header'
import Login from './components/Login'
import Toasts, { type Toast, type ToastTone } from './components/Toasts'
import { usePage, useTheme } from './hooks'
import HomePage from './pages/HomePage'
import type { HostInfo, HostUsage } from './types'

const AutoUpdatePage = lazy(() => import('./pages/AutoUpdatePage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

const pageFallback = (
  <div className="flex justify-center py-20 text-muted">
    <LoaderCircle className="animate-spin" />
  </div>
)

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
  const [page, navigate] = usePage()
  const [host, setHost] = useState<HostInfo | null>(null)
  const [hostIp, setHostIp] = useState('')
  const [hostName, setHostName] = useState('')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [selfUpdating, setSelfUpdating] = useState(false)
  const [usage, setUsage] = useState<HostUsage | null>(null)
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

  const onHost = useCallback((ip: string, name: string) => {
    setHostIp(ip)
    setHostName(name)
  }, [])

  useEffect(() => {
    api.host().then(
      (h) => {
        setHost(h)
        setHostIp(h.ip)
        setHostName(h.name)
      },
      () => setHost(null),
    )
  }, [])

  // Host CPU / RAM in the header, every 2 s while the tab is visible
  useEffect(() => {
    let inFlight = false
    const tick = async () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        setUsage(await api.hostUsage())
      } catch {
        // keep the last value
      } finally {
        inFlight = false
      }
    }
    void tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [])

  /** DockerUpdates is being recreated by its helper container: wait for it to come back, then reload. */
  const waitForSelfUpdate = useCallback(async () => {
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
  }, [toast])

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
        page={page}
        theme={theme}
        usage={usage}
        onNavigate={navigate}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onLogout={logout}
      />

      <main className="mx-auto w-full max-w-[1800px] flex-1 space-y-5 px-4 py-6 sm:px-6">
        {page === 'home' && (
          <HomePage
            host={host}
            toast={toast}
            onError={handleError}
            onSignedOut={onSignedOut}
            onSelfUpdate={() => void waitForSelfUpdate()}
            onHost={onHost}
          />
        )}
        <Suspense fallback={pageFallback}>
          {page === 'auto-update' && <AutoUpdatePage toast={toast} onError={handleError} />}
          {page === 'settings' && <SettingsPage toast={toast} onError={handleError} />}
        </Suspense>
      </main>

      <Footer />

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
