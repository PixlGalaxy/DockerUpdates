import { ChevronRight, CircleCheck, CircleDashed, CloudDownload, EllipsisVertical, Folder, Layers, RefreshCw } from 'lucide-react'
import { useState, type MouseEvent, type ReactNode } from 'react'
import type { StackColor } from '../stackColors'
import type { ContainerInfo } from '../types'
import { MERGE_TARGET } from '../utils'
import { PortCells, Resources } from './ContainerRow'
import { Button, IconButton, Toggle } from './ui'

/**
 * A group in the container list, shown as one row with its containers below it: a compose stack,
 * or a folder of standalone containers made by the user.
 */
export interface StackGroup {
  kind: 'stack' | 'folder'
  /** Stack: compose project name. Folder: its id */
  id: string
  /** Shown name: the project, or the folder name */
  name: string
  /** Order id: "stack:<project>" / "folder:<id>" */
  orderKey: string
  /** Stack whose compose file lives in DockerUpdates (else it was started elsewhere) */
  managed: boolean
  containers: ContainerInfo[]
  color: StackColor
  /** Custom icon (URL of the cached file), shown instead of the stack / folder symbol */
  icon?: string
}

interface Props {
  stack: StackGroup
  /** Advanced view: Network, IP / MAC and Volumes columns */
  advanced: boolean
  hostIp: string
  /** Cores of the Docker host (scale of the CPU bar) */
  hostCpus?: number
  /** Turns autostart on / off for every service */
  onAutostart: (enabled: boolean) => void
  collapsed: boolean
  busy: boolean
  /** The update check of its containers is running */
  checking: boolean
  onToggle: () => void
  onMenu: (x: number, y: number) => void
  onUpdate: () => void
  /** Checks every container of the stack / folder for updates */
  onCheck: () => void
  grip?: ReactNode
  dragging?: boolean
}

/** Running / total services and the services with an update, for the stack header. */
const unit = (stack: StackGroup, n: number) => `${stack.kind === 'stack' ? 'service' : 'container'}${n === 1 ? '' : 's'}`

function stackSummary(stack: StackGroup) {
  const running = stack.containers.filter((c) => c.state === 'running').length
  const updates = stack.containers.filter((c) => c.updateStatus === 'update-available')
  const unchecked = stack.containers.some((c) => c.updateStatus === 'unknown')
  return { running, total: stack.containers.length, updates, unchecked }
}

/**
 * CPU and RAM of the whole stack, shown like one container: the sum of its running services,
 * against the host's cores and RAM (or the sum of the memory limits when every service has one).
 */
function stackUsage(stack: StackGroup): ContainerInfo | null {
  const running = stack.containers.filter((c) => c.state === 'running')
  if (running.length === 0) return null
  const sum = (f: (c: ContainerInfo) => number) => running.reduce((n, c) => n + f(c), 0)
  const limited = running.every((c) => c.memLimitConfigured > 0)
  return {
    ...running[0],
    cpuPercent: sum((c) => c.cpuPercent),
    memUsage: sum((c) => c.memUsage),
    memLimitConfigured: limited ? sum((c) => c.memLimitConfigured) : 0,
    cpuLimit: 0,
    cpusetCount: 0,
  }
}

function StackUsage({ stack, hostCpus, wide }: { stack: StackGroup; hostCpus?: number; wide?: boolean }) {
  const usage = stackUsage(stack)
  return usage ? <Resources container={usage} hostCpus={hostCpus} wide={wide} /> : <span className="text-xs text-muted">—</span>
}

/** Custom icon like a container's (white tile), else the stack / folder symbol in its color */
function StackIcon({ stack }: { stack: StackGroup }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (stack.icon && failed !== stack.icon) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-1 shadow-sm">
        <img src={stack.icon} alt="" loading="lazy" className="size-full object-contain" onError={() => setFailed(stack.icon!)} />
      </span>
    )
  }
  return (
    <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl shadow-sm ${stack.color.icon}`}>
      {stack.kind === 'stack' ? <Layers size={20} /> : <Folder size={20} />}
    </span>
  )
}

/** Published / exposed ports of every service (host-network services have none to list) */
function stackPorts(stack: StackGroup) {
  const seen = new Set<string>()
  return stack.containers
    .flatMap((c) => c.ports)
    .filter((p) => {
      const key = `${p.containerPort}/${p.protocol}/${p.hostPort ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.containerPort - b.containerPort)
}

/** On when every service starts with Docker; a mix shows off, with how many are on. */
function StackAutostart({ stack, busy, onAutostart }: { stack: StackGroup; busy: boolean; onAutostart: (enabled: boolean) => void }) {
  const total = stack.containers.length
  const on = stack.containers.filter((c) => c.autostart).length
  if (total === 0) return null
  const mixed = on > 0 && on < total
  return (
    <span className="inline-flex items-center gap-1.5">
      <Toggle
        label={mixed ? `Autostart on for ${on} of ${total} ${unit(stack, total)}: turn it on for all` : `Autostart for every ${unit(stack, 1)} of ${stack.name}`}
        checked={on === total}
        disabled={busy}
        onChange={onAutostart}
      />
      {mixed && (
        <span className="text-[11px] text-muted tabular-nums">
          {on}/{total}
        </span>
      )}
    </span>
  )
}

function StackBadges({ stack }: { stack: StackGroup }) {
  if (stack.kind === 'folder') {
    return (
      <span
        className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-sky-700 uppercase dark:text-sky-300"
        title="Folder of containers: unlock the order to drag containers in or out of it"
      >
        Folder
      </span>
    )
  }
  return stack.managed ? (
    <span
      className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-700 uppercase dark:text-violet-300"
      title="Created in DockerUpdates: its compose file is edited here, and updates run docker compose pull + up -d"
    >
      Compose
    </span>
  ) : (
    <span
      className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted uppercase"
      title="Started outside DockerUpdates: updates recreate each container with the same settings; edit it in its own compose file"
    >
      Compose · external
    </span>
  )
}

function StackStatus({ stack }: { stack: StackGroup }) {
  const { running, total } = stackSummary(stack)
  const dot = total === 0 || running === 0 ? 'bg-zinc-400' : running === total ? 'bg-emerald-500' : 'bg-amber-500'
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      <span className={`size-2 rounded-full ${dot}`} />
      {total === 0
        ? 'Not deployed'
        : `${total} ${unit(stack, total)} · ${running === total ? 'all running' : `${running}/${total} running`}`}
    </span>
  )
}

/**
 * Update state of a stack / folder with its check button below, like a container (with a label:
 * there is no tag next to it).
 */
function StackUpdate(props: { stack: StackGroup; busy: boolean; checking: boolean; onUpdate: () => void; onCheck: () => void }) {
  const { stack, busy, checking, onCheck } = props
  const total = stack.containers.length
  if (total === 0) return null
  const checkable = stack.containers.some((c) => c.updateStatus !== 'local')
  return (
    <div className="flex flex-col items-start gap-1.5">
      <StackUpdateState {...props} />
      <button
        type="button"
        title={`Check every ${unit(stack, 1)} of ${stack.name} for updates`}
        // Still disabled while checking, but fully visible so the spin reads as progress
        className={`inline-flex h-6 items-center gap-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 text-[11px] font-medium whitespace-nowrap text-indigo-700 transition-colors hover:bg-indigo-500/20 focus-visible:outline-2 focus-visible:outline-sky-500 disabled:pointer-events-none dark:text-indigo-300 ${checking ? '' : 'disabled:opacity-40'}`}
        disabled={busy || checking || !checkable}
        onClick={onCheck}
      >
        <RefreshCw size={12} className={checking ? 'animate-spin' : undefined} />
        {checking ? 'Checking…' : `Check for ${stack.kind} updates`}
      </button>
    </div>
  )
}

function StackUpdateState({ stack, busy, onUpdate }: { stack: StackGroup; busy: boolean; onUpdate: () => void }) {
  const { updates, unchecked } = stackSummary(stack)
  if (updates.length > 0) {
    return (
      <Button
        variant="update"
        size="xs"
        icon={<CloudDownload size={13} />}
        loading={busy}
        onClick={onUpdate}
        title={`Update ${updates.map((c) => c.name).join(', ')}`}
      >
        {stack.kind === 'stack' ? 'Update stack' : 'Update folder'}
        <span className="rounded-full bg-white/25 px-1.5 text-[11px] tabular-nums">{updates.length}</span>
      </Button>
    )
  }
  return unchecked ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <CircleDashed size={13} /> Not checked
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
      <CircleCheck size={13} /> All up to date
    </span>
  )
}

function openBelow(e: MouseEvent<HTMLElement>, onMenu: (x: number, y: number) => void, alignRight = false) {
  const r = e.currentTarget.getBoundingClientRect()
  onMenu(alignRight ? r.right - 224 : r.left, r.bottom + 4)
}

/** Desktop: header row of a stack, above its services, with the same columns as a container. */
export function StackHeaderRow({ stack, advanced, hostIp, hostCpus, collapsed, busy, checking, onToggle, onMenu, onUpdate, onCheck, onAutostart, grip, dragging }: Props) {
  const td = 'px-3 py-3.5 align-middle'
  return (
    <tr
      data-order-id={stack.orderKey}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      className={`border-t border-line ${stack.color.header} ${stack.kind === 'folder' ? MERGE_TARGET : ''} ${busy ? 'opacity-70' : ''} ${dragging ? 'outline-2 -outline-offset-4 outline-dashed outline-rose-500/50 [&>td]:opacity-30' : ''}`}
    >
      {/* Application */}
      <td className={td}>
        <div className="flex items-center gap-3">
          {grip}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Show' : 'Hide'} the ${unit(stack, 2)} of ${stack.name}`}
            className="-mr-1 flex items-center gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-sky-500"
          >
            <ChevronRight size={16} className={`-ml-1 text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`} />
            <StackIcon stack={stack} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button type="button" onClick={onToggle} className="truncate text-left font-semibold hover:opacity-75">
                {stack.name}
              </button>
              <StackBadges stack={stack} />
            </div>
            <div className="mt-1">
              <StackStatus stack={stack} />
            </div>
          </div>
        </div>
      </td>

      {/* Version */}
      <td className={td}>
        <StackUpdate stack={stack} busy={busy} checking={checking} onUpdate={onUpdate} onCheck={onCheck} />
      </td>

      {advanced && <td colSpan={2} className={td} />}

      <PortCells ports={stackPorts(stack)} hostNet={false} hostIp={hostIp} />

      {advanced && <td className={td} />}

      {/* Resources */}
      <td className={`${td} w-44 min-w-44`}>
        <StackUsage stack={stack} hostCpus={hostCpus} />
      </td>

      {/* Autostart */}
      <td className={td}>
        <StackAutostart stack={stack} busy={busy} onAutostart={onAutostart} />
      </td>

      {/* Uptime column: stack actions */}
      <td className={`${td} text-right`}>
        <IconButton label={`${stack.kind === 'stack' ? 'Stack' : 'Folder'} actions for ${stack.name}`} onClick={(e) => openBelow(e, onMenu, true)}>
          <EllipsisVertical size={16} />
        </IconButton>
      </td>
    </tr>
  )
}

/** Phones: header card of a stack; its service cards go in `children`. */
export function StackCard({ stack, hostCpus, collapsed, busy, checking, onToggle, onMenu, onUpdate, onCheck, onAutostart, grip, dragging, children }: Props & { children: ReactNode }) {
  return (
    <section
      data-order-id={stack.orderKey}
      className={`overflow-hidden rounded-2xl border shadow-sm ${stack.color.header} ${stack.kind === 'folder' ? MERGE_TARGET : ''} ${busy ? 'opacity-70' : ''} ${dragging ? 'border-dashed border-rose-500/60 [&>*]:opacity-30' : stack.color.border}`}
    >
      <div className="flex items-center gap-2 p-3">
        {grip}
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <ChevronRight size={16} className={`shrink-0 text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <StackIcon stack={stack} />
          <span className="min-w-0">
            <span className="block truncate font-semibold">{stack.name}</span>
            <StackStatus stack={stack} />
          </span>
        </button>
        <IconButton label={`${stack.kind === 'stack' ? 'Stack' : 'Folder'} actions for ${stack.name}`} onClick={(e) => openBelow(e, onMenu, true)}>
          <EllipsisVertical size={16} />
        </IconButton>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
        <StackBadges stack={stack} />
        <StackAutostart stack={stack} busy={busy} onAutostart={onAutostart} />
        <span className="ml-auto">
          <StackUpdate stack={stack} busy={busy} checking={checking} onUpdate={onUpdate} onCheck={onCheck} />
        </span>
      </div>
      {stackUsage(stack) && (
        <div className={`border-t px-3 py-2.5 ${stack.color.border}`}>
          <StackUsage stack={stack} hostCpus={hostCpus} wide />
        </div>
      )}
      {!collapsed && children && (
        <div className={`border-t py-3 pr-3 pl-2 ${stack.color.border}`}>
          <div className={`space-y-3 border-l-2 pl-2 ${stack.color.border}`}>{children}</div>
        </div>
      )}
    </section>
  )
}
