import { useEffect, useState } from 'react'

/** useState persisted in localStorage (falls back to memory if storage is unavailable). */
export function useStoredState<T>(key: string, initial: T | (() => T)) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw !== null) return JSON.parse(raw) as T
    } catch {
      // storage blocked or invalid JSON
    }
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore
    }
  }, [key, value])

  return [value, setValue] as const
}

export type Theme = 'light' | 'dark'

export function useTheme() {
  const [theme, setTheme] = useStoredState<Theme>('du:theme', () =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return [theme, setTheme] as const
}

// ---------- Minimal router (History API; the backend serves index.html for any path) ----------

export type Page = 'home' | 'auto-update' | 'settings'

const PATHS: Record<Page, string> = { home: '/', 'auto-update': '/auto-update', settings: '/settings' }

function pageFromPath(): Page {
  const entry = Object.entries(PATHS).find(([, path]) => path !== '/' && location.pathname.startsWith(path))
  return (entry?.[0] as Page) ?? 'home'
}

export function usePage() {
  const [page, setPage] = useState<Page>(pageFromPath)

  useEffect(() => {
    const onPop = () => setPage(pageFromPath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = (next: Page) => {
    if (next === page) return
    history.pushState(null, '', PATHS[next])
    setPage(next)
    window.scrollTo({ top: 0 })
  }

  return [page, navigate] as const
}
