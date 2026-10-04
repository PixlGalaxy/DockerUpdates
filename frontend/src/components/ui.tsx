import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'warning' | 'update' | 'ghost' | 'danger'
type Size = 'xs' | 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-sky-600 text-white shadow-sm shadow-sky-600/25 hover:bg-sky-500 focus-visible:outline-sky-500',
  secondary:
    'border border-line bg-surface text-fg shadow-xs hover:bg-surface-2 focus-visible:outline-sky-500',
  update:
    'bg-violet-600 text-white shadow-sm shadow-violet-600/25 hover:bg-violet-500 focus-visible:outline-violet-500',
  warning:
    'bg-amber-500 text-white shadow-sm shadow-amber-500/25 hover:bg-amber-400 focus-visible:outline-amber-500',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline-sky-500',
  danger:
    'border border-red-500/30 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400 focus-visible:outline-red-500',
}

const SIZES: Record<Size, string> = {
  xs: 'h-7 gap-1.5 px-2.5 text-xs',
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-9 gap-2 px-4 text-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  icon,
  loading,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading ? <LoaderCircle size={14} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

interface IconButtonProps extends ComponentProps<'button'> {
  label: string
  tone?: 'default' | 'danger' | 'success' | 'warning'
}

const ICON_TONES = {
  default: 'hover:text-fg',
  danger: 'hover:text-red-500',
  success: 'hover:text-emerald-500',
  warning: 'hover:text-amber-500',
}

export function IconButton({ label, tone = 'default', className = '', children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:pointer-events-none disabled:opacity-40 ${ICON_TONES[tone]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:opacity-50 ${checked ? 'bg-sky-600' : 'bg-line'}`}
    >
      <span
        className={`size-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
      />
    </button>
  )
}

export function Meter({ value, tone }: { value: number; tone: 'cpu' | 'mem' }) {
  const pct = Math.min(100, Math.max(0, value))
  const color =
    pct > 85
      ? 'bg-red-500'
      : pct > 60
        ? 'bg-amber-500'
        : tone === 'cpu'
          ? 'bg-emerald-500'
          : 'bg-sky-500'
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line/60 ring-inset">
      <div
        className={`h-full rounded-full transition-[width] duration-700 ease-out ${color}`}
        style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
      />
    </div>
  )
}

export function Chip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted ${className}`}
    >
      {children}
    </span>
  )
}
