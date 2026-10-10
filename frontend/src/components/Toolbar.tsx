import {
  CloudDownload,
  Layers,
  LoaderCircle,
  Lock,
  LockOpen,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  SearchCheck,
  Square,
  StepForward,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { IconButton, Toggle } from './ui'

// ---------- Top bar: search, view options, refresh ----------

interface TopBarProps {
  search: string
  onSearch: (value: string) => void
  advanced: boolean
  onAdvanced: (value: boolean) => void
  lastUpdated: Date | null
  refreshing: boolean
  onRefresh: () => void
  /** The order of the list can be changed (lock open) */
  orderUnlocked: boolean
  orderSaving: boolean
  onToggleOrder: () => void
}

export function TopBar({
  search,
  onSearch,
  advanced,
  onAdvanced,
  lastUpdated,
  refreshing,
  onRefresh,
  orderUnlocked,
  orderSaving,
  onToggleOrder,
}: TopBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full sm:max-w-xs">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, image, IP…"
          disabled={orderUnlocked}
          className="h-9 w-full rounded-lg border border-line bg-surface pr-8 pl-9 text-sm shadow-xs placeholder:text-muted focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none disabled:opacity-50"
        />
        {search && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onSearch('')}
            className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted hover:text-fg"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 text-sm text-muted select-none">
        <Toggle label="Advanced view" checked={advanced} onChange={onAdvanced} />
        Advanced view
      </label>

      <div className="ml-auto flex items-center gap-1 text-xs text-muted">
        {orderUnlocked ? (
          <span className="font-medium text-rose-600 dark:text-rose-400">Hold and drag a container to move it, then lock to save</span>
        ) : (
          <span className="hidden sm:inline">Right-click a container for more actions</span>
        )}
        <button
          type="button"
          onClick={onToggleOrder}
          disabled={orderSaving}
          aria-pressed={orderUnlocked}
          aria-label={orderUnlocked ? 'Lock and save the container order' : 'Unlock to reorder the containers'}
          title={orderUnlocked ? 'Lock and save the order' : 'Unlock to reorder the containers'}
          className={`ml-1 inline-flex size-8 items-center justify-center rounded-lg border-b-2 transition-colors focus-visible:outline-2 focus-visible:outline-sky-500 disabled:opacity-60 ${
            orderUnlocked
              ? 'border-rose-500 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 dark:text-rose-400'
              : 'border-transparent text-emerald-600 hover:bg-surface-2 dark:text-emerald-400'
          }`}
        >
          {orderSaving ? <LoaderCircle size={15} className="animate-spin" /> : orderUnlocked ? <LockOpen size={15} /> : <Lock size={15} />}
        </button>
        <span className="mx-2 hidden h-4 w-px bg-line sm:inline-block" />
        {lastUpdated && <span>Updated {lastUpdated.toLocaleTimeString()}</span>}
        <IconButton label="Refresh" onClick={onRefresh}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </IconButton>
      </div>
    </div>
  )
}

// ---------- Bottom bar: colored bulk actions (Unraid style) ----------

type Tone = 'sky' | 'fuchsia' | 'emerald' | 'rose' | 'amber' | 'cyan' | 'indigo' | 'violet'

const TONES: Record<Tone, string> = {
  sky: 'border-sky-500/40 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300',
  fuchsia: 'border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-700 hover:bg-fuchsia-500/20 dark:text-fuchsia-300',
  emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300',
  rose: 'border-rose-500/40 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300',
  cyan: 'border-cyan-400/60 bg-cyan-400/15 text-cyan-700 hover:bg-cyan-400/25 dark:text-cyan-300',
  indigo: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300',
  violet: 'border-violet-600 bg-violet-600 text-white shadow-sm shadow-violet-600/30 hover:bg-violet-500',
}

function BarButton({
  tone,
  icon,
  children,
  title,
  loading,
  disabled,
  className = '',
  onClick,
}: {
  tone: Tone
  icon: ReactNode
  children: ReactNode
  title?: string
  loading?: boolean
  disabled?: boolean
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3.5 text-xs font-semibold tracking-wide uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-45 max-sm:justify-center max-sm:px-2 max-sm:tracking-normal whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {loading ? <LoaderCircle size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

interface ActionBarProps {
  busy: string | null
  updates: number
  onAdd: () => void
  onAddCompose: () => void
  onBulk: (action: 'start' | 'stop' | 'pause' | 'unpause') => void
  onCheckUpdates: () => void
  onUpdateAll: () => void
}

export function ActionBar({ busy, updates, onAdd, onAddCompose, onBulk, onCheckUpdates, onUpdateAll }: ActionBarProps) {
  const locked = busy !== null
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <BarButton tone="sky" icon={<Plus size={14} />} onClick={onAdd}>
        Add container
      </BarButton>
      <BarButton tone="fuchsia" icon={<Layers size={14} />} title="Create a stack from a docker-compose file" onClick={onAddCompose}>
        Add compose
      </BarButton>
      <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
      <BarButton tone="emerald" icon={<Play size={14} />} loading={busy === 'start'} disabled={locked} onClick={() => onBulk('start')}>
        Start all
      </BarButton>
      <BarButton
        tone="rose"
        icon={<Square size={14} />}
        loading={busy === 'stop'}
        disabled={locked}
        title="Stop all (except DockerUpdates)"
        onClick={() => onBulk('stop')}
      >
        Stop all
      </BarButton>
      <BarButton
        tone="amber"
        icon={<Pause size={14} />}
        loading={busy === 'pause'}
        disabled={locked}
        title="Pause all (except DockerUpdates)"
        onClick={() => onBulk('pause')}
      >
        Pause all
      </BarButton>
      <BarButton tone="cyan" icon={<StepForward size={14} />} loading={busy === 'unpause'} disabled={locked} onClick={() => onBulk('unpause')}>
        Resume all
      </BarButton>
      <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
      <BarButton tone="indigo" icon={<SearchCheck size={14} />} loading={busy === 'check'} disabled={locked} onClick={onCheckUpdates}>
        Check for updates
      </BarButton>
      <BarButton
        tone="violet"
        icon={<CloudDownload size={14} />}
        loading={busy === 'update'}
        disabled={locked || updates === 0}
        className="max-sm:col-span-2"
        onClick={onUpdateAll}
      >
        Update all
        {updates > 0 && <span className="rounded-full bg-white/25 px-1.5 text-[11px] tabular-nums">{updates}</span>}
      </BarButton>
    </div>
  )
}
