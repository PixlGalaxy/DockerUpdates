import { CalendarClock, House, LogOut, Moon, Server, Settings, Sun } from 'lucide-react'
import type { Page, Theme } from '../hooks'
import Logo from './Logo'
import { IconButton } from './ui'

interface Props {
  hostIp: string
  hostName: string
  user: string
  page: Page
  theme: Theme
  onNavigate: (page: Page) => void
  onToggleTheme: () => void
  onLogout: () => void
}

const NAV: { page: Page; label: string; icon: typeof House }[] = [
  { page: 'home', label: 'Home', icon: House },
  { page: 'auto-update', label: 'Auto-Update', icon: CalendarClock },
  { page: 'settings', label: 'Settings', icon: Settings },
]

export default function Header({ hostIp, hostName, user, page, theme, onNavigate, onToggleTheme, onLogout }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1800px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <button type="button" onClick={() => onNavigate('home')} className="flex shrink-0 items-center gap-3 text-left">
          <Logo size={38} />
          <div className="hidden leading-tight sm:block">
            <h1 className="text-base font-semibold tracking-tight">DockerUpdates</h1>
            {(hostIp || hostName) && (
              <p className="flex items-center gap-1.5 text-xs text-muted" title="Docker host">
                <Server size={11} className="shrink-0" />
                {hostIp && <span className="font-mono">{hostIp}</span>}
                {hostIp && hostName && <span aria-hidden className="text-muted/50">|</span>}
                {hostName && <span className="max-w-[22vw] truncate font-medium text-fg/80">{hostName}</span>}
              </p>
            )}
          </div>
        </button>

        <nav className="flex h-full items-stretch gap-1">
          {NAV.map(({ page: p, label, icon: Icon }) => {
            const active = p === page
            return (
              <button
                key={p}
                type="button"
                onClick={() => onNavigate(p)}
                aria-current={active ? 'page' : undefined}
                className={`relative inline-flex items-center gap-2 px-2.5 text-sm font-medium transition-colors sm:px-3 ${
                  active ? 'text-sky-600 dark:text-sky-400' : 'text-muted hover:text-fg'
                }`}
              >
                <Icon size={16} />
                <span className="hidden md:inline">{label}</span>
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-sky-500" />}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <IconButton
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <div className="hidden h-6 w-px bg-line sm:block" />
          <span className="hidden text-sm font-medium sm:inline">{user}</span>
          <IconButton label="Sign out" tone="danger" onClick={onLogout}>
            <LogOut size={16} />
          </IconButton>
        </div>
      </div>
    </header>
  )
}
