import {
  Activity,
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CloudDownload,
  Copy,
  EllipsisVertical,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { ContainerInfo, VolumeMapping } from '../types'
import { formatBytes, gradientFor, isActive, splitImage, timeAgo } from '../utils'
import { Button, Chip, IconButton, Meter, Toggle } from './ui'

interface Props {
  container: ContainerInfo
  hostIp: string
  advanced: boolean
  busy: boolean
  /** The update check of this container is running */
  checking?: boolean
  /** Opens the container menu at the given screen position */
  onMenu: (x: number, y: number) => void
  onAutostart: (enabled: boolean) => void
  onCheckUpdate: () => void
  onUpdate: () => void
  onCopy: (text: string) => void
}

const STATE: Record<string, { label: string; dot: string; text: string; pulse?: boolean }> = {
  running: { label: 'Running', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', pulse: true },
  paused: { label: 'Paused', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  restarting: { label: 'Restarting', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', pulse: true },
  exited: { label: 'Stopped', dot: 'bg-zinc-400', text: 'text-muted' },
  created: { label: 'Created', dot: 'bg-zinc-400', text: 'text-muted' },
  dead: { label: 'Dead', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
}

const td = 'px-3 py-3.5 align-middle'
// Volume mappings collapse into "+N more" only when they would make the row taller than this
const VOLUMES_MAX_PX = 64

const HEALTH = {
  healthy: { label: 'Healthy', cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  unhealthy: { label: 'Unhealthy', cls: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300' },
  starting: { label: 'Starting', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
}

/** Health check status (only for images with a HEALTHCHECK) and crash hints. */
function HealthTag({ container: c }: { container: ContainerInfo }) {
  const tags = []
  if (c.health && c.state === 'running') {
    const h = HEALTH[c.health]
    tags.push(
      <span
        key="health"
        title={c.healthLog ? `Last health check:\n${c.healthLog}` : 'Docker health check'}
        className={`inline-flex cursor-help items-center gap-1 rounded-md border px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase ${h.cls}`}
      >
        <Activity size={10} className={c.health === 'starting' ? 'animate-pulse' : ''} />
        {h.label}
      </span>,
    )
  }
  if (c.state === 'exited' && c.exitCode) {
    tags.push(
      <span
        key="exit"
        title={c.exitCode === 137 ? 'Killed (SIGKILL), possibly out of memory' : 'The container exited with an error'}
        className="inline-flex cursor-help items-center rounded-md border border-red-500/40 bg-red-500/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-red-700 uppercase dark:text-red-300"
      >
        Exit {c.exitCode}
      </span>,
    )
  }
  if (c.state === 'restarting' || c.restartCount > 3) {
    tags.push(
      <span
        key="restarts"
        title="Number of automatic restarts by Docker"
        className="inline-flex items-center rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300"
      >
        {c.restartCount} restarts
      </span>,
    )
  }
  return tags.length ? <div className="mt-1 flex flex-wrap gap-1">{tags}</div> : null
}
const badge = 'inline-flex items-center gap-1.5 rounded-full whitespace-nowrap px-2 py-0.5 text-xs font-medium'

export default function ContainerRow({
  container: c,
  hostIp,
  advanced,
  busy,
  checking,
  onMenu,
  onAutostart,
  onCheckUpdate,
  onUpdate,
  onCopy,
}: Props) {
  const active = isActive(c)
  const { repo } = splitImage(c.image)
  const hostNet = c.network === 'host'
  const published = c.ports.filter((p) => p.hostPort)

  const openMenuHere = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onMenu(r.left, r.bottom + 4)
  }

  return (
    <tr
      onContextMenu={(e) => {
        // Keep the native menu on links and text fields
        if ((e.target as HTMLElement).closest('a, input, textarea')) return
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      className={`group border-t border-line transition-colors hover:bg-surface-2/60 ${busy ? 'opacity-70' : ''}`}
    >
      {/* Application */}
      <td className={td}>
        <div className="flex items-center gap-3">
          <AppIcon container={c} onClick={openMenuHere} />
          <div className="max-w-60 min-w-0">
            <div className="flex items-center gap-2">
              <button type="button" onClick={openMenuHere} className="truncate text-left font-semibold hover:text-sky-600 dark:hover:text-sky-400">
                {c.name}
              </button>
              <StateLabel container={c} />
            </div>
            <div className="mt-0.5 truncate text-xs text-muted" title={c.image}>
              {repo}
            </div>
            <button
              type="button"
              onClick={() => onCopy(c.id)}
              title="Copy container ID"
              className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-muted/80 hover:text-fg"
            >
              {c.id.slice(0, 12)}
              <Copy size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
            <HealthTag container={c} />
          </div>
        </div>
      </td>

      {/* Version */}
      <td className={td}>
        <UpdateInfo container={c} busy={busy} checking={checking} onUpdate={onUpdate} onCheckUpdate={onCheckUpdate} />
      </td>

      {advanced && (
        <>
          <td className={td}>
            <Chip className="font-sans text-xs">{c.network}</Chip>
          </td>
          <td className={`${td} font-mono text-[11px] whitespace-nowrap`}>
            <div>{c.ip || (hostNet ? hostIp : <span className="text-muted">—</span>)}</div>
            {c.mac && <div className="mt-0.5 text-[11px] text-muted">{c.mac}</div>}
          </td>
        </>
      )}

      {/* Container port */}
      <td className={`${td} font-mono text-[11px] whitespace-nowrap`}>
        {hostNet ? (
          <span className="text-muted">all</span>
        ) : c.ports.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          c.ports.map((p) => (
            <div key={`${p.containerPort}/${p.protocol}`} className="leading-relaxed">
              {p.containerPort}:{p.protocol.toUpperCase()}
            </div>
          ))
        )}
      </td>

      {/* LAN IP:Port */}
      <td className={`${td} font-mono text-[11px] whitespace-nowrap`}>
        {hostNet ? (
          <span>{hostIp}</span>
        ) : published.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          published.map((p) => (
            <div key={`${p.hostPort}/${p.protocol}`} className="leading-relaxed">
              {p.protocol === 'tcp' ? (
                <a
                  href={`http://${hostIp}:${p.hostPort}`}
                  target="_blank"
                  rel="noreferrer"
                  className="group/link inline-flex items-center gap-0.5 text-sky-700 hover:underline dark:text-sky-300"
                >
                  {hostIp}:{p.hostPort}
                  <ArrowUpRight size={11} className="opacity-0 transition-opacity group-hover/link:opacity-100" />
                </a>
              ) : (
                <span>
                  {hostIp}:{p.hostPort}
                </span>
              )}
            </div>
          ))
        )}
      </td>

      {advanced && (
        <td className={`${td} min-w-52`}>
          {c.volumes.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            <VolumeList volumes={c.volumes} />
          )}
        </td>
      )}

      {/* Resources */}
      <td className={`${td} w-44 min-w-44`}>
        <Resources container={c} />
      </td>

      {/* Autostart */}
      <td className={td}>
        <Toggle label="Autostart" checked={c.autostart} disabled={busy} onChange={onAutostart} />
      </td>

      {/* Uptime */}
      <td className={`${td} min-w-28 text-xs`}>
        <div className="font-medium whitespace-nowrap">{active && c.startedAt ? timeAgo(c.startedAt) : '—'}</div>
        <div className="mt-0.5 text-muted">Created {timeAgo(c.createdAt)} ago</div>
      </td>
    </tr>
  )
}

/** Phone layout: the same information as a table row, stacked in a card. */
export function ContainerCard({
  container: c,
  hostIp,
  advanced,
  busy,
  checking,
  onMenu,
  onAutostart,
  onCheckUpdate,
  onUpdate,
  onCopy,
}: Props) {
  const active = isActive(c)
  const { repo } = splitImage(c.image)
  const hostNet = c.network === 'host'
  const published = c.ports.filter((p) => p.hostPort)
  const internal = c.ports.filter((p) => !p.hostPort)

  const openMenuHere = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onMenu(r.right - 224, r.bottom + 4)
  }

  return (
    <article
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest('a, input, textarea')) return
        e.preventDefault()
        onMenu(e.clientX, e.clientY)
      }}
      className={`group overflow-hidden rounded-2xl border border-line bg-surface shadow-sm ${busy ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        <AppIcon container={c} onClick={openMenuHere} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button type="button" onClick={openMenuHere} className="min-w-0 truncate text-left font-semibold">
              {c.name}
            </button>
            <StateLabel container={c} />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted" title={c.image}>
            {repo}
          </div>
          <button
            type="button"
            onClick={() => onCopy(c.id)}
            title="Copy container ID"
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-muted/80"
          >
            {c.id.slice(0, 12)}
            <Copy size={11} />
          </button>
          <HealthTag container={c} />
        </div>
        <IconButton label="Actions" className="-mt-1 -mr-1 size-9 shrink-0" onClick={openMenuHere}>
          <EllipsisVertical size={18} />
        </IconButton>
      </div>

      <div className="space-y-3 px-4 pb-4">
        <UpdateInfo container={c} busy={busy} checking={checking} onUpdate={onUpdate} onCheckUpdate={onCheckUpdate} inline />

        {(hostNet || c.ports.length > 0) && (
          <CardField label="Ports">
            {hostNet ? (
              <span className="font-mono text-xs">
                <span className="text-muted">host network · </span>
                {hostIp}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {published.map((p) =>
                  p.protocol === 'tcp' ? (
                    <a
                      key={`${p.hostPort}/${p.protocol}`}
                      href={`http://${hostIp}:${p.hostPort}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-700 dark:text-sky-300"
                      title={`Container port ${p.containerPort}/${p.protocol}`}
                    >
                      :{p.hostPort}
                      <ArrowUpRight size={11} />
                    </a>
                  ) : (
                    <Chip key={`${p.hostPort}/${p.protocol}`}>
                      :{p.hostPort}/{p.protocol}
                    </Chip>
                  ),
                )}
                {internal.map((p) => (
                  <Chip key={`${p.containerPort}/${p.protocol}`} className="opacity-70">
                    {p.containerPort}/{p.protocol} (internal)
                  </Chip>
                ))}
              </div>
            )}
          </CardField>
        )}

        {advanced && (
          <CardField label="Network">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px]">
              <Chip className="font-sans text-xs">{c.network}</Chip>
              <span>{c.ip || (hostNet ? hostIp : <span className="text-muted">—</span>)}</span>
              {c.mac && <span className="text-muted">{c.mac}</span>}
            </div>
          </CardField>
        )}

        {advanced && c.volumes.length > 0 && (
          <CardField label="Volumes">
            <VolumeList volumes={c.volumes} />
          </CardField>
        )}

        {c.state === 'running' && <Resources container={c} wide />}
      </div>

      <div className="flex items-center gap-3 border-t border-line bg-surface-2/40 px-4 py-2.5 text-xs">
        <div className="min-w-0 flex-1">
          <span className="font-medium">{active && c.startedAt ? `Up ${timeAgo(c.startedAt)}` : 'Not running'}</span>
          <span className="text-muted"> · created {timeAgo(c.createdAt)} ago</span>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-muted">
          Autostart
          <Toggle label="Autostart" checked={c.autostart} disabled={busy} onChange={onAutostart} />
        </label>
      </div>
    </article>
  )
}

function CardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold tracking-wider text-muted uppercase">{label}</div>
      {children}
    </div>
  )
}

/** App icon (or initials) that opens the container menu; shield badge on DockerUpdates itself. */
function AppIcon({ container: c, onClick }: { container: ContainerInfo; onClick: (e: MouseEvent<HTMLElement>) => void }) {
  const [iconFailed, setIconFailed] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      title="Actions (or right-click the row)"
      className="relative shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-sky-500"
    >
      {c.icon && !iconFailed ? (
        <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-1 shadow-sm transition-transform group-hover:scale-105">
          <img
            src={c.icon}
            alt=""
            loading="lazy"
            className="size-full object-contain"
            onError={() => setIconFailed(true)}
          />
        </div>
      ) : (
        <div
          className={`flex size-10 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-semibold text-white uppercase shadow-sm transition-transform group-hover:scale-105 ${gradientFor(c.name)}`}
        >
          {c.name.slice(0, 2)}
        </div>
      )}
      {c.isSelf && (
        <span
          title="This is DockerUpdates itself: it is never stopped, paused or removed by bulk actions"
          className="absolute -right-1.5 -bottom-1.5 flex size-5 items-center justify-center rounded-full bg-sky-600 text-white shadow-sm ring-2 ring-surface"
        >
          <ShieldCheck size={11} />
        </span>
      )}
    </button>
  )
}

function StateLabel({ container: c }: { container: ContainerInfo }) {
  const state = STATE[c.state] ?? STATE.exited
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${state.text}`}>
      <span className="relative flex size-2">
        {state.pulse && <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${state.dot}`} />}
        <span className={`relative inline-flex size-2 rounded-full ${state.dot}`} />
      </span>
      {state.label}
    </span>
  )
}

/** Update status badge, current tag (or from → to) and the check button. */
function UpdateInfo({
  container: c,
  busy,
  checking,
  onUpdate,
  onCheckUpdate,
  inline,
}: {
  container: ContainerInfo
  busy: boolean
  /** The update check of this container is running */
  checking?: boolean
  onUpdate: () => void
  onCheckUpdate: () => void
  /** Badge and tag side by side (mobile card) instead of stacked */
  inline?: boolean
}) {
  const { tag } = splitImage(c.image)
  return (
    <div className={inline ? 'flex flex-wrap items-center gap-1.5' : 'flex flex-col items-start gap-1.5'}>
      {busy ? (
        <span className={`${badge} bg-sky-500/10 text-sky-600 dark:text-sky-400`}>
          <LoaderCircle size={12} className="animate-spin" /> Working…
        </span>
      ) : c.updateStatus === 'up-to-date' ? (
        <span className={`${badge} bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`}>
          <CircleCheck size={12} /> Up to date
        </span>
      ) : c.updateStatus === 'update-available' ? (
        <Button variant="update" size="xs" icon={<CloudDownload size={13} />} onClick={onUpdate}>
          Update available
        </Button>
      ) : c.updateStatus === 'auth-required' ? (
        <span title={c.updateMessage} className={`${badge} cursor-help bg-red-500/10 text-red-600 dark:text-red-400`}>
          <LockKeyhole size={12} /> Auth required
        </span>
      ) : c.updateStatus === 'local' ? (
        <span
          title={c.updateMessage ?? 'Local image ID, there is no registry to check'}
          className={`${badge} cursor-help bg-zinc-500/10 text-muted`}
        >
          <HardDrive size={12} /> Local image
        </span>
      ) : c.updateStatus === 'error' ? (
        <span title={c.updateMessage} className={`${badge} cursor-help bg-amber-500/10 text-amber-600 dark:text-amber-400`}>
          <TriangleAlert size={12} /> Check failed
        </span>
      ) : (
        <span className={`${badge} bg-zinc-500/10 text-muted`}>
          <CircleDashed size={12} /> Not checked
        </span>
      )}
      <div className="flex items-center gap-1">
        {c.updateStatus === 'update-available' && c.updateFrom && c.updateTo ? (
          <Chip className="border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300">
            <span
              title={`${tag}: ${c.updateKind === 'version' ? 'version' : c.updateKind === 'revision' ? 'commit' : 'image ID'} ${c.updateFrom} → ${c.updateTo}`}
              className="inline-flex items-center gap-1"
            >
              {/* Image IDs are shown short like git commits; the tooltip has the full value */}
              <span className="opacity-70">{c.updateKind === 'image' ? c.updateFrom.slice(0, 7) : c.updateFrom}</span>
              <span aria-hidden>→</span>
              <span className="font-semibold">{c.updateKind === 'image' ? c.updateTo.slice(0, 7) : c.updateTo}</span>
            </span>
          </Chip>
        ) : (
          <Chip>{tag}</Chip>
        )}
        <IconButton
          label={checking ? 'Checking for update…' : 'Check for update'}
          // Still disabled while checking, but fully visible so the spin reads as progress
          className={`h-auto! w-[22px]! self-stretch rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/20 dark:text-indigo-300 ${checking ? 'disabled:opacity-100' : ''}`}
          disabled={busy || checking || c.updateStatus === 'local'}
          onClick={onCheckUpdate}
        >
          <RefreshCw size={12} className={checking ? 'animate-spin' : undefined} />
        </IconButton>
      </div>
    </div>
  )
}

function Resources({ container: c, wide }: { container: ContainerInfo; wide?: boolean }) {
  // Prefer the limit configured on the container; otherwise Docker reports the host RAM
  const memLimit = c.memLimitConfigured || c.memLimit
  const memPct = memLimit ? (c.memUsage / memLimit) * 100 : 0
  return c.state === 'running' ? (
    <div className={`text-[11px] whitespace-nowrap ${wide ? 'grid grid-cols-2 gap-4' : 'space-y-2'}`}>
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-muted">
            CPU
            {c.cpuLimit > 0 && (
              <span className="ml-1 text-[10px] text-muted/80" title="CPU limit configured on the container">
                max {c.cpuLimit}
              </span>
            )}
          </span>
          <span className="font-medium tabular-nums">{c.cpuPercent.toFixed(1)}%</span>
        </div>
        <Meter value={c.cpuPercent} tone="cpu" />
      </div>
      <div>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-muted">RAM</span>
          <span className="tabular-nums">
            <span className="font-medium">{formatBytes(c.memUsage)}</span>
            {c.memLimitConfigured > 0 ? (
              <span className="text-muted" title="Memory limit configured on the container">
                {' / '}
                {formatBytes(c.memLimitConfigured)}
              </span>
            ) : (
              <span
                className="text-muted"
                title={`No memory limit: can use all host RAM${c.memLimit ? ` (${formatBytes(c.memLimit)})` : ''}. Set one in Edit.`}
              >
                {' / ∞'}
              </span>
            )}
          </span>
        </div>
        <Meter value={memPct} tone="mem" />
      </div>
    </div>
  ) : (
    <span className="text-xs text-muted">—</span>
  )
}

/**
 * Volume mappings with their Host / Container badges. Every mapping is shown when they fit in
 * VOLUMES_MAX_PX; long paths that would make the row too tall are cut after the last mapping
 * that fits, with a "+N more" toggle.
 */
function VolumeList({ volumes }: { volumes: VolumeMapping[] }) {
  const [expanded, setExpanded] = useState(false)
  // clip: height to show (null = everything fits), hidden: mappings cut off
  const [fit, setFit] = useState<{ clip: number | null; hidden: number }>({ clip: null, hidden: 0 })
  const inner = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = inner.current
    if (!el) return
    // Measures the natural (unclipped) list; runs again when the column width changes
    const observer = new ResizeObserver(() => {
      const top = el.getBoundingClientRect().top
      const bottoms = [...el.children].map((child) => child.getBoundingClientRect().bottom - top)
      const fitting = bottoms.filter((b) => b <= VOLUMES_MAX_PX + 1).length
      setFit(
        fitting >= bottoms.length
          ? { clip: null, hidden: 0 }
          : { clip: Math.ceil(bottoms[Math.max(fitting, 1) - 1]), hidden: bottoms.length - Math.max(fitting, 1) },
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [volumes])

  return (
    <div>
      <div className="overflow-hidden" style={!expanded && fit.clip !== null ? { maxHeight: fit.clip } : undefined}>
        <div ref={inner} className="space-y-1">
          {volumes.map((v) => (
            <div key={v.container} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[11px] leading-relaxed break-all">
              <span className="shrink-0 rounded bg-amber-500/10 px-1 font-sans text-[9px] font-semibold tracking-wide text-amber-700 uppercase dark:text-amber-300" title="Path on the host (or Docker volume name)">
                Host
              </span>
              <span className="text-muted">{v.host}</span>
              <span className="text-muted">→</span>
              <span className="shrink-0 rounded bg-sky-500/10 px-1 font-sans text-[9px] font-semibold tracking-wide text-sky-700 uppercase dark:text-sky-300" title="Path inside the container">
                Container
              </span>
              <span className="text-fg">{v.container}</span>
            </div>
          ))}
        </div>
      </div>
      {fit.hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
        >
          {expanded ? 'Show less' : `+${fit.hidden} more`}
          <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}
