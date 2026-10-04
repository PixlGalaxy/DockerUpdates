import { LayoutDashboard, ScrollText, ShieldBan, Wrench, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import type { ToastTone } from '../../components/Toasts'
import DashboardSection from './DashboardSection'
import IpAccessSection from './IpAccessSection'
import LogsSection from './LogsSection'
import SystemSection from './SystemSection'

type Section = 'dashboard' | 'logs' | 'ip-access' | 'system'

const SECTIONS: { key: Section; label: string; icon: LucideIcon }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'logs', label: 'Server logs', icon: ScrollText },
  { key: 'ip-access', label: 'IP access', icon: ShieldBan },
  { key: 'system', label: 'System', icon: Wrench },
]

const isSection = (v: string | null): v is Section => SECTIONS.some((s) => s.key === v)

interface Props {
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
}

export default function AdminPage({ toast, onError }: Props) {
  // The section lives in ?section= so a reload or a shared link opens the same view
  const [active, setActive] = useState<Section>(() => {
    const requested = new URLSearchParams(location.search).get('section')
    return isSection(requested) ? requested : 'dashboard'
  })

  const select = (key: Section) => {
    setActive(key)
    const url = key === 'dashboard' ? location.pathname : `${location.pathname}?section=${key}`
    history.replaceState(null, '', url)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Admin Panel</h1>
        <p className="text-sm text-muted">Sessions, server logs, IP access and system information.</p>
      </div>

      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        <nav className="grid shrink-0 grid-cols-2 gap-1 sm:grid-cols-3 md:sticky md:top-20 md:flex md:w-60 md:flex-col">
          {SECTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => select(key)}
              aria-current={active === key ? 'page' : undefined}
              className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                active === key
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-muted hover:bg-surface hover:text-fg'
              }`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'dashboard' && <DashboardSection toast={toast} onError={onError} onOpen={select} />}
          {active === 'logs' && <LogsSection toast={toast} onError={onError} />}
          {active === 'ip-access' && <IpAccessSection toast={toast} onError={onError} />}
          {active === 'system' && <SystemSection toast={toast} onError={onError} />}
        </div>
      </div>
    </div>
  )
}

export type { Section }
