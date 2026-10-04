import { CloudDownload, Pause, Play, RefreshCw, Search, Square, StepForward, X } from 'lucide-react'
import { Button, Toggle } from './ui'

interface Props {
  search: string
  onSearch: (value: string) => void
  advanced: boolean
  onAdvanced: (value: boolean) => void
  busy: string | null
  updates: number
  onBulk: (action: 'start' | 'stop' | 'pause' | 'unpause') => void
  onCheckUpdates: () => void
  onUpdateAll: () => void
}

export default function Toolbar({
  search,
  onSearch,
  advanced,
  onAdvanced,
  busy,
  updates,
  onBulk,
  onCheckUpdates,
  onUpdateAll,
}: Props) {
  const locked = busy !== null
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative w-full lg:max-w-xs">
        <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search name, image, IP…"
          className="h-9 w-full rounded-lg border border-line bg-surface pr-8 pl-9 text-sm shadow-xs placeholder:text-muted focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none"
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

      <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
        <div className="inline-flex overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
          {(
            [
              ['start', 'Start all', <Play key="i" size={14} />],
              ['stop', 'Stop all', <Square key="i" size={14} />],
              ['pause', 'Pause all', <Pause key="i" size={14} />],
              ['unpause', 'Resume all', <StepForward key="i" size={14} />],
            ] as const
          ).map(([action, label, icon], i) => (
            <button
              key={action}
              type="button"
              disabled={locked}
              title={label}
              onClick={() => onBulk(action)}
              className={`inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium transition-colors hover:bg-surface-2 disabled:opacity-50 ${i > 0 ? 'border-l border-line' : ''}`}
            >
              <span className="text-muted">{icon}</span>
              <span className="hidden xl:inline">{label}</span>
            </button>
          ))}
        </div>

        <Button
          size="sm"
          icon={<RefreshCw size={14} />}
          loading={busy === 'check'}
          disabled={locked}
          onClick={onCheckUpdates}
        >
          Check for updates
        </Button>
        <Button
          variant="warning"
          size="sm"
          icon={<CloudDownload size={14} />}
          loading={busy === 'update'}
          disabled={locked || updates === 0}
          onClick={onUpdateAll}
        >
          Update all
          {updates > 0 && (
            <span className="ml-0.5 rounded-full bg-white/25 px-1.5 text-[11px] tabular-nums">{updates}</span>
          )}
        </Button>
      </div>
    </div>
  )
}
