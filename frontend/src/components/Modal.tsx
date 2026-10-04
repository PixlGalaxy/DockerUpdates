import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { IconButton } from './ui'

interface Props {
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  /** Extra controls shown in the header, left of the close button */
  actions?: ReactNode
  size?: 'md' | 'lg' | 'xl' | 'full'
  onClose: () => void
  children: ReactNode
  /** Body without padding (terminals, log viewers) */
  flush?: boolean
}

const SIZES = {
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
  full: 'max-w-[1600px]',
}

export default function Modal({ title, subtitle, icon, actions, size = 'lg', onClose, children, flush }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 backdrop-blur-sm animate-[fade-in_.15s_ease-out] sm:p-6">
      <div className="absolute inset-0" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl animate-[pop-in_.18s_ease-out] ${SIZES[size]}`}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-5 py-3.5">
          {icon && <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">{icon}</div>}
          <div className="min-w-0">
            <h2 className="truncate font-semibold">{title}</h2>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <IconButton label="Close" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
        </div>
        <div className={`min-h-0 flex-1 overflow-auto ${flush ? '' : 'p-5'}`}>{children}</div>
      </div>
    </div>
  )
}
