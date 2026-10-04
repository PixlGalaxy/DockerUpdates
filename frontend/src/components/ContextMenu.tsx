import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  hidden?: boolean
  disabled?: boolean
  separatorBefore?: boolean
}

interface Props {
  x: number
  y: number
  title?: ReactNode
  items: MenuItem[]
  onClose: () => void
}

/** Menu opened at the cursor (right-click) or below an element; flips to stay on screen. */
export default function ContextMenu({ x, y, title, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: y + height + margin > window.innerHeight ? Math.max(margin, y - height) : y,
    })
  }, [x, y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const visible = items.filter((i) => !i.hidden)

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault()
          onClose()
        }}
      />
      <div
        ref={ref}
        role="menu"
        style={pos}
        className="fixed z-50 min-w-56 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-2xl shadow-black/20 animate-[pop-in_.12s_ease-out]"
      >
        {title && <div className="truncate px-2.5 pt-1.5 pb-1 text-xs font-semibold text-muted">{title}</div>}
        {visible.map((item, i) => (
          <div key={item.label}>
            {item.separatorBefore && i > 0 && <div className="my-1 h-px bg-line" />}
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm max-md:py-2 transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40 ${
                item.danger ? 'text-red-600 dark:text-red-400' : ''
              }`}
            >
              <span className={`flex w-4 justify-center ${item.danger ? '' : 'text-muted'}`}>{item.icon}</span>
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
