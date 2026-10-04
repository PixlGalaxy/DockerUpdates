import { Boxes, CirclePause, CirclePlay, CloudDownload } from 'lucide-react'
import type { ReactNode } from 'react'

export type Filter = 'all' | 'running' | 'stopped' | 'updates'

interface Props {
  total: number
  running: number
  stopped: number
  updates: number
  filter: Filter
  onFilter: (f: Filter) => void
}

export default function StatsCards({ total, running, stopped, updates, filter, onFilter }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Card id="all" label="Total containers" value={total} icon={<Boxes size={18} />} tone="text-sky-500 bg-sky-500/10" active={filter} onClick={onFilter} />
      <Card id="running" label="Running" value={running} icon={<CirclePlay size={18} />} tone="text-emerald-500 bg-emerald-500/10" active={filter} onClick={onFilter} />
      <Card id="stopped" label="Stopped / paused" value={stopped} icon={<CirclePause size={18} />} tone="text-zinc-500 bg-zinc-500/10" active={filter} onClick={onFilter} />
      <Card
        id="updates"
        label="Updates available"
        value={updates}
        icon={<CloudDownload size={18} />}
        tone="text-amber-500 bg-amber-500/10"
        active={filter}
        onClick={onFilter}
        highlight={updates > 0}
      />
    </div>
  )
}

function Card({
  id,
  label,
  value,
  icon,
  tone,
  active,
  onClick,
  highlight,
}: {
  id: Filter
  label: string
  value: number
  icon: ReactNode
  tone: string
  active: Filter
  onClick: (f: Filter) => void
  highlight?: boolean
}) {
  const selected = active === id
  return (
    <button
      type="button"
      onClick={() => onClick(selected ? 'all' : id)}
      aria-pressed={selected}
      className={`flex items-center gap-3 rounded-2xl border bg-surface p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-sky-500 ${
        selected ? 'border-sky-500 ring-2 ring-sky-500/20' : highlight ? 'border-amber-500/40' : 'border-line'
      }`}
    >
      <span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span>
        <span className="block text-2xl leading-none font-semibold tabular-nums">{value}</span>
        <span className="mt-1 block text-xs text-muted">{label}</span>
      </span>
    </button>
  )
}
