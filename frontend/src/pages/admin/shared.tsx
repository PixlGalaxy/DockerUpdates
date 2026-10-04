import { LoaderCircle } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ToastTone } from '../../components/Toasts'
import Card from '../../components/Card'
import { Button } from '../../components/ui'

export interface SectionProps {
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
}

/** Section card: the same Card used on the Settings page. `flush` drops the inner padding. */
export function Panel({
  title,
  icon,
  description,
  actions,
  children,
  flush,
}: {
  title: ReactNode
  icon?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
}) {
  if (!flush) {
    return (
      <Card title={title} icon={icon} description={description} actions={actions}>
        {children}
      </Card>
    )
  }
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:px-5">
        {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">{icon}</div>}
        <div className="min-w-40 flex-1">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** Same look as the container counters on the home page. */
export function StatTile({
  icon,
  label,
  value,
  tone,
  hint,
  onClick,
  highlight,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
  tone: string
  hint?: string
  onClick?: () => void
  highlight?: boolean
}) {
  const cls = `flex items-center gap-3 rounded-2xl border bg-surface p-4 text-left shadow-sm transition-all ${
    highlight ? 'border-amber-500/40' : 'border-line'
  } ${onClick ? 'hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-sky-500' : ''}`
  const content = (
    <>
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-2xl leading-none font-semibold tabular-nums">{value}</span>
        <span className="mt-1 block text-xs text-muted">{label}</span>
      </span>
    </>
  )
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} title={hint}>
      {content}
    </button>
  ) : (
    <div className={cls} title={hint}>
      {content}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex justify-center py-16 text-muted">
      <LoaderCircle className="animate-spin" />
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>
}

/** Row action that asks for confirmation inline instead of opening a modal. */
export function ConfirmButton({
  label,
  confirm,
  icon,
  onConfirm,
  variant = 'secondary',
}: {
  label: string
  confirm: string
  icon: ReactNode
  onConfirm: () => Promise<unknown>
  variant?: 'secondary' | 'danger'
}) {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)

  if (asking) {
    return (
      <span className="inline-flex items-center gap-2 text-xs">
        <span className="text-muted">{confirm}</span>
        <Button
          size="xs"
          variant="danger"
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm()
            } finally {
              setBusy(false)
              setAsking(false)
            }
          }}
        >
          Confirm
        </Button>
        <Button size="xs" onClick={() => setAsking(false)} disabled={busy}>
          Cancel
        </Button>
      </span>
    )
  }
  return (
    <Button size="xs" variant={variant} icon={icon} onClick={() => setAsking(true)}>
      {label}
    </Button>
  )
}
