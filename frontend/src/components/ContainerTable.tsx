import { GripVertical } from 'lucide-react'
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { StackColor } from '../stackColors'
import type { ContainerInfo } from '../types'
import ContainerRow, { ContainerCard } from './ContainerRow'
import Logo from './Logo'
import { StackCard, StackHeaderRow, type StackGroup } from './StackRow'

/**
 * One entry of the list: a container, or a group (compose stack or folder, see `stack.kind`)
 * with its containers. `key` is its order id.
 */
export type ListItem =
  | { kind: 'container'; key: string; container: ContainerInfo }
  | { kind: 'stack'; key: string; stack: StackGroup }

interface Props {
  items: ListItem[]
  hostIp: string
  /** Cores of the Docker host (scale of the CPU bars) */
  hostCpus?: number
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
  /**
   * Order unlocked: container `name` was dropped on `into`: held a second over another container,
   * both make a folder; dropped on a folder ("folder:<id>"), it joins it. `onReorder` also moves
   * containers in and out of folders: their containers show (and move) while unlocked
   */
  onMerge?: (name: string, into: string) => void
  /** Groups (StackGroup.id) whose containers are hidden */
  collapsed: Set<string>
  /** Groups (StackGroup.id) with an action running */
  busyStacks: Set<string>
  /** Groups (StackGroup.id) whose update check is running */
  checkingStacks: Set<string>
  onStackCheck: (stack: StackGroup) => void
  onToggleStack: (name: string) => void
  onStackMenu: (stack: StackGroup, x: number, y: number) => void
  onStackUpdate: (stack: StackGroup) => void
  onStackAutostart: (stack: StackGroup, enabled: boolean) => void
}

/** Pixels from the top / bottom of the window where dragging scrolls the page */
const EDGE = 80
/** Slide of the rows that change place while reordering */
const SLIDE_MS = 200
/** Press-and-hold time before a container lifts (a mouse also lifts it by moving) */
const HOLD_MOUSE_MS = 180
const HOLD_TOUCH_MS = 300
const LIFT_SHADOW = '0 18px 40px -8px rgb(0 0 0 / 0.35)'
/** Time a container must be held over another to make a folder (a folder takes it at once) */
const MERGE_HOLD_MS = 1000
/** Part of a row's height, centered, where holding makes a folder instead of moving past it */
const MERGE_ZONE = [0.25, 0.75]

export default function ContainerTable({
  items,
  hostIp,
  hostCpus,
  advanced,
  loading,
  busyIds,
  checkingIds,
  emptyMessage,
  onReorder,
  onMerge,
  collapsed,
  busyStacks,
  checkingStacks,
  onStackCheck,
  onToggleStack,
  onStackMenu,
  onStackUpdate,
  onStackAutostart,
  ...handlers
}: Props) {
  const [dragName, setDragName] = useState<string | null>(null)
  const draggingRef = useRef(false)
  // Latest callback for the window listeners of a drag in progress
  const reorderRef = useRef(onReorder)
  const mergeRef = useRef(onMerge)
  useEffect(() => {
    reorderRef.current = onReorder
    mergeRef.current = onMerge
  }, [onReorder, onMerge])

  // Rows slide to their new place when the order changes (FLIP: compare the page position of
  // each row before and after the render, then animate from the old one)
  const listRef = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, number>())
  // Order ids top to bottom, with the containers of folders while reordering (they move too)
  const flatKeys = items.flatMap((i) =>
    onReorder && i.kind === 'stack' && i.stack.kind === 'folder' ? [i.key, ...i.stack.containers.map((c) => c.name)] : [i.key],
  )
  const orderKey = flatKeys.join('/')
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

    // Folders: only a standalone container (names have no ":") goes into one, dropped on another
    // standalone container or on a folder, never on a compose stack
    const folderable = !name.includes(':')
    let mergeEl: HTMLElement | null = null
    let mergeTimer = 0
    let mergeReady = false
    const clearMerge = () => {
      clearTimeout(mergeTimer)
      if (mergeEl) delete mergeEl.dataset.merge
      mergeEl = null
      mergeReady = false
    }
    // Over a container: highlighted now, ready to make a folder after MERGE_HOLD_MS. Over a
    // folder: ready at once
    const holdOver = (el: HTMLElement, delay: number) => {
      if (mergeEl === el) return
      clearMerge()
      mergeEl = el
      el.dataset.merge = 'hover'
      mergeTimer = window.setTimeout(() => {
        if (mergeEl !== el) return
        mergeReady = true
        el.dataset.merge = 'ready'
        navigator.vibrate?.(15)
      }, delay)
    }

    const check = () => {
      if (!active) return
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-order-id]')
      const over = target?.dataset.orderId
      if (!target || !over || over === name) return clearMerge()
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
      const r = target.getBoundingClientRect()
      const at = (y - r.top) / r.height
      // Containers of a folder are not drop targets (moving over them puts it in their folder),
      // and neither is the folder a dragged container is already in
      const ownFolder = placeholder()?.dataset.folder
      const canMerge =
        folderable &&
        Boolean(mergeRef.current) &&
        !over.startsWith('stack:') &&
        !target.dataset.folder &&
        over !== `folder:${ownFolder}`
      if (canMerge && at > MERGE_ZONE[0] && at < MERGE_ZONE[1]) {
        return holdOver(target, over.startsWith('folder:') ? 0 : MERGE_HOLD_MS)
      }
      clearMerge()
      // Swap only past the middle of the other row (past the folder zone when it has one): rows
      // of different heights would flip back and forth
      const own = placeholder()
      const below = own ? r.top > own.getBoundingClientRect().top : true
      const [top, bottom] = canMerge ? MERGE_ZONE : [0.5, 0.5]
      if (below ? at > bottom : at < top) reorderRef.current?.(name, over)
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
      const into = mergeReady ? mergeEl?.dataset.orderId : undefined
      const intoRect = into ? mergeEl!.getBoundingClientRect() : null
      clearMerge()
      const finish = () => {
        ghost.remove()
        draggingRef.current = false
        setDragName(null)
      }
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // Dropped into a folder: the copy shrinks into the target, then the folder is made
      if (into && intoRect) {
        const merge = () => {
          finish()
          mergeRef.current?.(name, into)
        }
        if (reduce) return merge()
        ghost
          .animate(
            [
              { transform: ghost.style.transform, scale: '1.03', opacity: 0.95 },
              { transform: `translate3d(${intoRect.left}px, ${intoRect.top}px, 0)`, scale: '0.6', opacity: 0 },
            ],
            { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
          )
          .finished.catch(() => {})
          .then(merge)
        return
      }
      // The copy lands on the final place of the row, then the row shows again
      const to = placeholder()?.getBoundingClientRect()
      if (!to || reduce) return finish()
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
          const i = flatKeys.indexOf(name)
          const next = flatKeys[e.key === 'ArrowUp' ? i - 1 : i + 1]
          if (next) onReorder(name, next)
        }}
      >
        <GripVertical size={16} />
      </button>
    )

  // While reordering, a stack moves as one row (its services are hidden); a folder shows its
  // containers so they can be moved in and out of it
  const showServices = (stack: StackGroup) =>
    onReorder ? stack.kind === 'folder' : !collapsed.has(stack.id)

  const folderIdOf = (g: StackGroup) => (g.kind === 'folder' ? g.id.slice('folder:'.length) : undefined)

  const cardOf = (c: ContainerInfo, nested?: StackColor, folderId?: string) => (
    <ContainerCard
      key={c.id}
      container={c}
      hostIp={hostIp}
      hostCpus={hostCpus}
      advanced={advanced}
      busy={busyIds.has(c.id)}
      checking={checkingIds.has(c.id)}
      onMenu={(x, y) => handlers.onMenu(c, x, y)}
      onAutostart={(e) => handlers.onAutostart(c.id, e)}
      onCheckUpdate={() => handlers.onCheckUpdate(c.id)}
      onUpdate={() => handlers.onUpdate(c.id)}
      onCopy={handlers.onCopy}
      grip={nested && !folderId ? undefined : grip(c.name)}
      dragging={dragName === c.name}
      nested={nested}
      folderId={folderId}
    />
  )

  const rowOf = (c: ContainerInfo, nested?: StackColor, folderId?: string) => (
    <ContainerRow
      key={c.id}
      container={c}
      hostIp={hostIp}
      hostCpus={hostCpus}
      advanced={advanced}
      busy={busyIds.has(c.id)}
      checking={checkingIds.has(c.id)}
      onMenu={(x, y) => handlers.onMenu(c, x, y)}
      onAutostart={(e) => handlers.onAutostart(c.id, e)}
      onCheckUpdate={() => handlers.onCheckUpdate(c.id)}
      onUpdate={() => handlers.onUpdate(c.id)}
      onCopy={handlers.onCopy}
      grip={nested && !folderId ? undefined : grip(c.name)}
      dragging={dragName === c.name}
      nested={nested}
      folderId={folderId}
    />
  )

  const stackProps = (stack: StackGroup, key: string) => ({
    stack,
    advanced,
    hostIp,
    hostCpus,
    onAutostart: (enabled: boolean) => onStackAutostart(stack, enabled),
    collapsed: !showServices(stack),
    busy: busyStacks.has(stack.id),
    checking: checkingStacks.has(stack.id),
    onCheck: () => onStackCheck(stack),
    onToggle: () => onToggleStack(stack.id),
    onMenu: (x: number, y: number) => onStackMenu(stack, x, y),
    onUpdate: () => onStackUpdate(stack),
    grip: grip(key),
    dragging: dragName === key,
  })

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
      className={onReorder ? 'cursor-grab select-none [-webkit-touch-callout:none]' : undefined}
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
          items.map((item) =>
            item.kind === 'container' ? (
              cardOf(item.container)
            ) : (
              <StackCard key={item.key} {...stackProps(item.stack, item.key)}>
                {item.stack.containers.length > 0 &&
                  item.stack.containers.map((c) => cardOf(c, item.stack.color, folderIdOf(item.stack)))}
              </StackCard>
            ),
          )}

        {!loading && items.length === 0 && (
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
                items.map((item) =>
                  item.kind === 'container' ? (
                    rowOf(item.container)
                  ) : (
                    <Fragment key={item.key}>
                      <StackHeaderRow {...stackProps(item.stack, item.key)} />
                      {showServices(item.stack) &&
                        item.stack.containers.map((c) => rowOf(c, item.stack.color, folderIdOf(item.stack)))}
                    </Fragment>
                  ),
                )}

              {!loading && items.length === 0 && (
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
