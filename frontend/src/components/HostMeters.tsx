import { Cpu, MemoryStick } from 'lucide-react'
import type { HostUsage } from '../types'

/** 0% -> green, 50% -> yellow, 100% -> red */
const loadColor = (pct: number) => `hsl(${Math.round(120 * (1 - Math.min(Math.max(pct, 0), 100) / 100))} 75% 42%)`

/** MB below 1 GB, GB above (keeps the header short) */
function fmt(bytes: number) {
  const mb = bytes / 1024 ** 2
  return mb < 1024 ? `${Math.round(mb)}MB` : `${(mb / 1024).toFixed(1)}GB`
}

function Meter({ icon, label, value, pct, title }: { icon: React.ReactNode; label: string; value: string; pct: number; title: string }) {
  const color = loadColor(pct)
  return (
    <div title={title} className="flex flex-col gap-1 rounded-lg border border-line bg-surface-2/50 px-2.5 py-1">
      <div className="flex items-center gap-1.5 text-[11px] leading-none">
        <span className="text-muted">{icon}</span>
        <span className="font-medium text-muted">{label}</span>
        <span className="font-mono font-semibold tabular-nums" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-line/70">
        <div className="h-full rounded-full transition-[width,background-color] duration-700" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export default function HostMeters({ usage }: { usage: HostUsage | null }) {
  if (!usage) return null
  const memPct = usage.memTotal ? (usage.memUsed / usage.memTotal) * 100 : 0
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Meter icon={<Cpu size={11} />} label="CPU" value={`${Math.round(usage.cpu)}%`} pct={usage.cpu} title={`Host CPU usage: ${usage.cpu.toFixed(1)}%`} />
      <Meter
        icon={<MemoryStick size={11} />}
        label="RAM"
        value={`${fmt(usage.memUsed)}/${fmt(usage.memTotal)}`}
        pct={memPct}
        title={`Host memory: ${fmt(usage.memUsed)} of ${fmt(usage.memTotal)} used (${memPct.toFixed(0)}%)`}
      />
    </div>
  )
}
