import { EllipsisVertical } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconButton } from './ui'

export interface MenuItem {
  label: string
  icon: ReactNode
  onSelect: () => void
  danger?: boolean
  hidden?: boolean
  separatorBefore?: boolean
}

const MENU_HEIGHT_ESTIMATE = 260

/** Dropdown positioned with `fixed` so it is never clipped by the scrollable table. */
export default function RowMenu({ items }: { items: MenuItem[] }) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [pos])

  function toggle() {
    if (pos || !btn.current) return setPos(null)
    const r = btn.current.getBoundingClientRect()
    const right = window.innerWidth - r.right
    setPos(
      r.bottom + MENU_HEIGHT_ESTIMATE > window.innerHeight
        ? { bottom: window.innerHeight - r.top + 4, right }
        : { top: r.bottom + 4, right },
    )
  }

  return (
    <>
      <IconButton ref={btn} label="More actions" onClick={toggle}>
        <EllipsisVertical size={16} />
      </IconButton>
      {pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPos(null)} />
          <ul
            role="menu"
            style={pos}
            className="fixed z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-xl shadow-black/15 animate-[pop-in_.12s_ease-out]"
          >
            {items
              .filter((i) => !i.hidden)
              .map((item) => (
                <li key={item.label}>
                  {item.separatorBefore && <div className="my-1 h-px bg-line" />}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPos(null)
                      item.onSelect()
                    }}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surface-2 ${item.danger ? 'text-red-600 dark:text-red-400' : ''}`}
                  >
                    <span className={item.danger ? '' : 'text-muted'}>{item.icon}</span>
                    {item.label}
                  </button>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  )
}
