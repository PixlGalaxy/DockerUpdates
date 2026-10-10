import { Check, Palette, Shuffle } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { STACK_COLORS, stackColor } from '../stackColors'

interface Props {
  x: number
  y: number
  stack: string
  /** Color chosen for the stack (undefined = automatic, from its name) */
  chosen?: string
  /** null = back to the automatic color */
  onPick: (color: string | null) => void
  onClose: () => void
}

/** Popover with the stack colors, opened from the stack menu at the same place. */
export default function StackColorPicker({ x, y, stack, chosen, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  const current = stackColor(stack, chosen)

  // Stays on screen, like the context menu
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

  const pick = (color: string | null) => {
    onClose()
    onPick(color)
  }

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
        role="dialog"
        aria-label={`Color of the stack ${stack}`}
        style={pos}
        className="fixed z-50 w-64 overflow-hidden rounded-xl border border-line bg-surface p-3 shadow-2xl shadow-black/20 animate-[pop-in_.12s_ease-out]"
      >
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted">
          <Palette size={14} />
          <span className="truncate">Color of {stack}</span>
        </div>
        <div className="grid grid-cols-5 gap-2.5">
          {STACK_COLORS.map((c) => {
            const selected = c.id === current.id
            return (
              <button
                key={c.id}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={selected}
                onClick={() => pick(c.id)}
                className={`flex aspect-square items-center justify-center rounded-full text-white shadow-sm transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 ${c.swatch} ${
                  selected ? 'ring-2 ring-fg/70 ring-offset-2 ring-offset-surface' : ''
                }`}
              >
                {selected && <Check size={15} strokeWidth={3} />}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs">
          <span className="text-muted">{chosen ? current.label : `${current.label} · automatic`}</span>
          {chosen && (
            <button
              type="button"
              onClick={() => pick(null)}
              className="inline-flex items-center gap-1 font-medium text-sky-600 hover:underline dark:text-sky-400"
            >
              <Shuffle size={12} /> Automatic
            </button>
          )}
        </div>
      </div>
    </>
  )
}
