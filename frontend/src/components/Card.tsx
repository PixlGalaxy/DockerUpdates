import type { ReactNode } from 'react'

/** Settings-style section card. */
export default function Card({
  title,
  description,
  icon,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">{icon}</div>}
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  )
}

/** Label + description on the left, control on the right. */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
