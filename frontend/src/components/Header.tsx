import { LogOut, Moon, Plus, RefreshCw, Server, Sun } from 'lucide-react'
import type { Theme } from '../hooks'
import Logo from './Logo'
import { Button, IconButton } from './ui'

interface Props {
  hostIp: string
  hostName: string
  user: string
  lastUpdated: Date | null
  refreshing: boolean
  theme: Theme
  onRefresh: () => void
  onToggleTheme: () => void
  onAdd: () => void
  onLogout: () => void
}

export default function Header({
  hostIp,
  hostName,
  user,
  lastUpdated,
  refreshing,
  theme,
  onRefresh,
  onToggleTheme,
  onAdd,
  onLogout,
}: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1800px] items-center gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Logo size={38} />
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight">DockerUpdates</h1>
            {(hostIp || hostName) && (
              <p className="flex items-center gap-1.5 text-xs text-muted" title="Docker host">
                <Server size={11} className="shrink-0" />
                {hostIp && <span className="font-mono">{hostIp}</span>}
                {hostIp && hostName && <span aria-hidden className="text-muted/50">|</span>}
                {hostName && <span className="max-w-[40vw] truncate font-medium text-fg/80">{hostName}</span>}
              </p>
            )}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          {lastUpdated && (
            <span className="mr-1 hidden text-xs text-muted md:inline">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <IconButton label="Refresh" onClick={onRefresh}>
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </IconButton>
          <IconButton
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
          <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={onAdd} className="ml-1">
            <span className="hidden sm:inline">Add container</span>
          </Button>
          <div className="ml-1 hidden h-6 w-px bg-line sm:block" />
          <span className="hidden text-sm font-medium sm:inline">{user}</span>
          <IconButton label="Sign out" tone="danger" onClick={onLogout}>
            <LogOut size={16} />
          </IconButton>
        </div>
      </div>
    </header>
  )
}
