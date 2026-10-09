import { GripVertical } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ContainerInfo } from '../types'
import ContainerRow, { ContainerCard } from './ContainerRow'
import Logo from './Logo'

interface Props {
  containers: ContainerInfo[]
  hostIp: string
  advanced: boolean
  loading: boolean
  busyIds: Set<string>
  checkingIds: Set<string>
  emptyMessage: string
  onMenu: (container: ContainerInfo, x: number, y: number) => void
  onAutostart: (id: string, enabled: boolean) => void
  onCheckUpdate: (id: string) => void
  onUpdate: (id: string) => void
  onCopy: (text: string) => void
  /** Order unlocked: rows get a drag handle; moves `name` to the place of `over` */
  onReorder?: (name: string, over: string) => void
}

/** Pixels from the top / bottom of the window where dragging scrolls the page */
const EDGE = 80
/** Slide of the rows that change place while reordering */
const SLIDE_MS = 200
/** Press-and-hold time before a container lifts (a mouse also lifts it by moving) */
const HOLD_MOUSE_MS = 180
const HOLD_TOUCH_MS = 300
const LIFT_SHADOW = '0 18px 40px -8px rgb(0 0 0 / 0.35)'

export default function ContainerTable({
  containers,
  hostIp,
  advanced,
  loading,
  busyIds,
  checkingIds,
  emptyMessage,
  onReorder,
  ...handlers
}: Props) {
  const [dragName, setDragName] = useState<string | null>(null)
  const draggingRef = useRef(false)
  // Latest callback for the window listeners of a drag in progress
  const reorderRef = useRef(onReorder)
  useEffect(() => {
    reorderRef.current = onReorder
  }, [onReorder])

  // Rows slide to their new place when the order changes (FLIP: compare the page position of
  // each row before and after the render, then animate from the old one)
  const listRef = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, number>())
  const orderKey = containers.map((c) => c.name).join('/')
  const sorting = Boolean(onReorder)
  useLayoutEffect(() => {
    const els = listRef.current?.querySelectorAll<HTMLElement>('[data-order-id]') ?? []
    const before = positions.current
    const after = new Map<string, number>()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    for (const el of els) {
      if (!el.offsetParent) continue // phone cards or desktop rows, whichever is hidden
      const name = el.dataset.orderId!
      const top = el.getBoundingClientRect().top + window.scrollY
      after.set(name, top)
      const old = before.get(name)
      if (!sorting || reduce || old === undefined || Math.abs(old - top) < 1) continue
      el.animate([{ transform: `translateY(${old - top}px)` }, { transform: 'none' }], {
        duration: SLIDE_MS,
        easing: 'cubic-bezier(.2,.8,.2,1)',
      })
    }
    positions.current = after
  }, [orderKey, sorting])

  /**
   * Drag: a floating copy of the row follows the pointer (moved directly in the DOM, no React
   * render per move) while the real row stays in the list as a placeholder that changes place.
   * The pointer is followed on the window: the placeholder moves in the DOM while reordering,
   * which would drop a pointer capture on the handle.
   */
  function startDrag(source: HTMLElement, startX: number, startY: number, nowX = startX, nowY = startY) {
    const name = source.dataset.orderId
    if (!name || draggingRef.current) return
    draggingRef.current = true
    const placeholder = () =>
      [...document.querySelectorAll<HTMLElement>(`[data-order-id="${CSS.escape(name)}"]`)].find((el) => el.offsetParent)
    const start = source.getBoundingClientRect()
    const offsetX = startX - start.left
    const offsetY = startY - start.top
    const ghost = makeGhost(source, start)
    const place = (px: number, py: number) => {
      ghost.style.transform = `translate3d(${px - offsetX}px, ${py - offsetY}px, 0)`
    }
    place(nowX, nowY)
    document.body.append(ghost)
    // Lift: the copy grows a little with a deeper shadow, like an app icon on a phone
    ghost.animate([{ scale: '1', boxShadow: '0 0 0 rgb(0 0 0 / 0)' }, { scale: '1.03', boxShadow: LIFT_SHADOW }], {
      duration: 160,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    })
    navigator.vibrate?.(10)
    document.documentElement.classList.add('cursor-grabbing', 'select-none')
    // Touch: the page must not scroll under the finger while it carries the row
    const noScroll = (e: TouchEvent) => e.preventDefault()
    window.addEventListener('touchmove', noScroll, { passive: false })
    setDragName(name)

    let x = nowX
    let y = nowY
    let active = true
    let waiting = false

    const check = () => {
      if (!active) return
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-order-id]')
      const over = target?.dataset.orderId
      if (!target || !over || over === name) return
      // A row still sliding is not in its real place yet: check again once it settles, so the
      // move happens even if the pointer stopped over it
      const sliding = target.getAnimations()[0]
      if (sliding) {
        if (!waiting) {
          waiting = true
          void sliding.finished.catch(() => {}).then(() => {
            waiting = false
            check()
          })
        }
        return
      }
      // Swap only past the middle of the other row: rows of different heights would flip back and forth
      const own = placeholder()
      const r = target.getBoundingClientRect()
      const mid = r.top + r.height / 2
      const below = own ? r.top > own.getBoundingClientRect().top : true
      if (below ? y > mid : y < mid) reorderRef.current?.(name, over)
    }
    const move = (e: PointerEvent) => {
      x = e.clientX
      y = e.clientY
      place(x, y)
      check()
    }
    // Near the top / bottom edge the page keeps scrolling, even with the pointer held still
    let frame = requestAnimationFrame(function scroll() {
      const step = y < EDGE ? -12 : y > window.innerHeight - EDGE ? 12 : 0
      if (step) {
        const before = window.scrollY
        window.scrollBy(0, step)
        if (window.scrollY !== before) check()
      }
      frame = requestAnimationFrame(scroll)
    })
    const end = () => {
      active = false
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('touchmove', noScroll)
      document.documentElement.classList.remove('cursor-grabbing', 'select-none')
      // The copy lands on the final place of the row, then the row shows again
      const to = placeholder()?.getBoundingClientRect()
      const finish = () => {
        ghost.remove()
        draggingRef.current = false
        setDragName(null)
      }
      if (!to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return finish()
      ghost
        .animate(
          [
            { transform: ghost.style.transform, scale: '1.03', boxShadow: LIFT_SHADOW },
            { transform: `translate3d(${to.left}px, ${to.top}px, 0)`, scale: '1', boxShadow: '0 0 0 rgb(0 0 0 / 0)' },
          ],
          { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
        )
        .finished.catch(() => {})
        .then(finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  /**
   * Unlocked list: press and hold anywhere on a container to lift it (the handle lifts it at
   * once). A mouse also lifts it as soon as it moves; a finger that moves before the hold
   * scrolls the page instead.
   */
  function pressRow(e: ReactPointerEvent) {
    if (!onReorder || e.button !== 0 || draggingRef.current) return
    const target = e.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-order-id]')
    if (!row) return
    const sx = e.clientX
    const sy = e.clientY
    if (target.closest('[data-grip]')) {
      e.preventDefault()
      return startDrag(row, sx, sy)
    }
    const mouse = e.pointerType === 'mouse'
    if (mouse) e.preventDefault()
    const id = e.pointerId
    let lx = sx
    let ly = sy
    const stop = () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    const lift = () => {
      stop()
      startDrag(row, sx, sy, lx, ly)
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      lx = ev.clientX
      ly = ev.clientY
      const moved = Math.hypot(lx - sx, ly - sy)
      if (mouse && moved > 4) lift()
      else if (!mouse && moved > 8) stop()
    }
    const timer = setTimeout(lift, mouse ? HOLD_MOUSE_MS : HOLD_TOUCH_MS)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  /** Handle that moves a row with the mouse, a finger or the arrow keys */
  const grip = (name: string) =>
    onReorder && (
      <button
        type="button"
        aria-label={`Move ${name} (drag, or use the arrow keys)`}
        title="Drag to reorder"
        data-grip
        className="-ml-1 flex h-10 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-rose-500 hover:bg-rose-500/10 focus-visible:outline-2 focus-visible:outline-rose-500 active:cursor-grabbing"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
          e.preventDefault()
          const i = containers.findIndex((c) => c.name === name)
          const next = containers[e.key === 'ArrowUp' ? i - 1 : i + 1]
          if (next) onReorder(name, next.name)
        }}
      >
        <GripVertical size={16} />
      </button>
    )

  const heads = [
    'Application',
    'Version',
    ...(advanced ? ['Network', 'IP / MAC'] : []),
    'Container port',
    'LAN IP:Port',
    ...(advanced ? ['Volume mappings (host → container)'] : []),
    'CPU & Memory',
    'Autostart',
    'Uptime',
  ]

  return (
    <div
      ref={listRef}
      className={onReorder ? 'contents cursor-grab select-none [-webkit-touch-callout:none]' : 'contents'}
      onPointerDown={pressRow}
      // While unlocked the rows only move: their buttons, links and menus do nothing
      onClickCapture={(e) => {
        if (!onReorder) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onContextMenuCapture={(e) => {
        if (!onReorder) return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {/* Phones: one card per container */}
      <div className="space-y-3 md:hidden">
        {loading &&
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex animate-pulse items-center gap-3">
                <div className="size-10 rounded-xl bg-surface-2" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-surface-2" />
                  <div className="h-2.5 w-48 rounded bg-surface-2" />
                </div>
              </div>
            </div>
          ))}

        {!loading &&
          containers.map((c) => (
            <ContainerCard
              key={c.id}
              container={c}
              hostIp={hostIp}
              advanced={advanced}
              busy={busyIds.has(c.id)}
              checking={checkingIds.has(c.id)}
              onMenu={(x, y) => handlers.onMenu(c, x, y)}
              onAutostart={(e) => handlers.onAutostart(c.id, e)}
              onCheckUpdate={() => handlers.onCheckUpdate(c.id)}
              onUpdate={() => handlers.onUpdate(c.id)}
              onCopy={handlers.onCopy}
              grip={grip(c.name)}
              dragging={dragName === c.name}
            />
          ))}

        {!loading && containers.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface px-4 py-16 text-center shadow-sm">
            <Logo size={56} className="mx-auto block w-fit opacity-40 grayscale" />
            <p className="mt-3 text-sm font-medium">{emptyMessage}</p>
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-2/70">
                {heads.map((h, i) => (
                  <th
                    key={h || i}
                    className="px-3 py-2.5 text-[11px] leading-tight font-semibold tracking-wider text-muted uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-t border-line">
                    <td colSpan={heads.length} className="px-4 py-4">
                      <div className="flex animate-pulse items-center gap-3">
                        <div className="size-10 rounded-xl bg-surface-2" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-40 rounded bg-surface-2" />
                          <div className="h-2.5 w-64 rounded bg-surface-2" />
                        </div>
                        <div className="h-3 w-24 rounded bg-surface-2" />
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading &&
                containers.map((c) => (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    hostIp={hostIp}
                    advanced={advanced}
                    busy={busyIds.has(c.id)}
                    checking={checkingIds.has(c.id)}
                    onMenu={(x, y) => handlers.onMenu(c, x, y)}
                    onAutostart={(e) => handlers.onAutostart(c.id, e)}
                    onCheckUpdate={() => handlers.onCheckUpdate(c.id)}
                    onUpdate={() => handlers.onUpdate(c.id)}
                    onCopy={handlers.onCopy}
                    grip={grip(c.name)}
                    dragging={dragName === c.name}
                  />
                ))}

              {!loading && containers.length === 0 && (
                <tr>
                  <td colSpan={heads.length} className="px-4 py-16 text-center">
                    <Logo size={56} className="mx-auto block w-fit opacity-40 grayscale" />
                    <p className="mt-3 text-sm font-medium">{emptyMessage}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/**
 * Floating copy of a row / card for dragging. A table row only keeps its layout inside a
 * table, so it is cloned into a one-row table with the same column widths.
 */
function makeGhost(source: HTMLElement, rect: DOMRect) {
  const ghost = document.createElement('div')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.className =
    'pointer-events-none fixed top-0 left-0 z-[70] origin-center overflow-hidden rounded-xl bg-surface opacity-95 ring-2 ring-rose-500/50'
  ghost.style.width = `${rect.width}px`
  ghost.style.willChange = 'transform'
  const copy = source.cloneNode(true) as HTMLElement
  copy.removeAttribute('data-order-id')
  if (source instanceof HTMLTableRowElement) {
    const table = document.createElement('table')
    table.className = 'w-full border-collapse text-left text-sm'
    table.style.tableLayout = 'fixed'
    const widths = [...source.cells].map((c) => c.getBoundingClientRect().width)
    ;[...(copy as HTMLTableRowElement).cells].forEach((c, i) => (c.style.width = `${widths[i]}px`))
    copy.classList.remove('border-t')
    const body = document.createElement('tbody')
    body.append(copy)
    table.append(body)
    ghost.append(table)
  } else {
    copy.classList.add('!m-0', '!shadow-none')
    ghost.append(copy)
  }
  return ghost
}
