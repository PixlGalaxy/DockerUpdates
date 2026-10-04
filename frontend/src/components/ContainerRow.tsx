import {
  ArrowUpRight,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CloudDownload,
  Copy,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'
import type { ContainerAction, ContainerInfo } from '../types'
import { formatBytes, gradientFor, isActive, splitImage, timeAgo } from '../utils'
import RowMenu from './RowMenu'
import { Button, Chip, IconButton, Meter, Toggle } from './ui'

interface Props {
  container: ContainerInfo
  hostIp: string
  advanced: boolean
  busy: boolean
  onAction: (action: ContainerAction) => void
  onRemove: () => void
  onAutostart: (enabled: boolean) => void
  onCheckUpdate: () => void
  onUpdate: () => void
  onCopy: (text: string) => void
  onEdit: () => void
}

const STATE: Record<string, { label: string; dot: string; text: string; pulse?: boolean }> = {
  running: { label: 'Running', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', pulse: true },
  paused: { label: 'Paused', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  restarting: { label: 'Restarting', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400', pulse: true },
  exited: { label: 'Stopped', dot: 'bg-zinc-400', text: 'text-muted' },
  created: { label: 'Created', dot: 'bg-zinc-400', text: 'text-muted' },
  dead: { label: 'Dead', dot: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
}

const td = 'px-4 py-3.5 align-middle'

export default function ContainerRow({
  container: c,
  hostIp,
  advanced,
  busy,
  onAction,
  onRemove,
  onAutostart,
  onCheckUpdate,
  onUpdate,
  onCopy,
  onEdit,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [iconFailed, setIconFailed] = useState(false)
  const active = isActive(c)
  const state = STATE[c.state] ?? STATE.exited
  const { repo, tag } = splitImage(c.image)
  // Prefer the limit configured on the container; otherwise Docker reports the host RAM
  const memLimit = c.memLimitConfigured || c.memLimit
  const memPct = memLimit ? (c.memUsage / memLimit) * 100 : 0
  const visibleVolumes = expanded ? c.volumes : c.volumes.slice(0, 2)
  const confirmRemove = () => {
    if (confirm(`Remove container "${c.name}"? This cannot be undone.`)) onRemove()
  }

  return (
    <tr className={`group border-t border-line transition-colors hover:bg-surface-2/60 ${busy ? 'opacity-70' : ''}`}>
      {/* Application */}
      <td className={td}>
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            {c.icon && !iconFailed ? (
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white p-1 shadow-sm">
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
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-sm font-semibold text-white uppercase shadow-sm ${gradientFor(c.name)}`}
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
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">{c.name}</span>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${state.text}`}>
                <span className="relative flex size-2">
                  {state.pulse && (
                    <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${state.dot}`} />
                  )}
                  <span className={`relative inline-flex size-2 rounded-full ${state.dot}`} />
                </span>
                {state.label}
              </span>
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
          </div>
        </div>
      </td>

      {/* Version */}
      <td className={td}>
        <div className="flex flex-col items-start gap-1.5">
          {busy ? (
            <span className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
              <LoaderCircle size={12} className="animate-spin" /> Working…
            </span>
          ) : c.updateStatus === 'up-to-date' ? (
            <span className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CircleCheck size={12} /> Up to date
            </span>
          ) : c.updateStatus === 'update-available' ? (
            <Button variant="warning" size="xs" icon={<CloudDownload size={13} />} onClick={onUpdate}>
              Update available
            </Button>
          ) : c.updateStatus === 'auth-required' ? (
            <span
              title={c.updateMessage}
              className="inline-flex cursor-help items-center gap-1.5 rounded-full whitespace-nowrap bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400"
            >
              <LockKeyhole size={12} /> Auth required
            </span>
          ) : c.updateStatus === 'local' ? (
            <span
              title={c.updateMessage ?? 'Local image ID, there is no registry to check'}
              className="inline-flex cursor-help items-center gap-1.5 rounded-full whitespace-nowrap bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted"
            >
              <HardDrive size={12} /> Local image
            </span>
          ) : c.updateStatus === 'error' ? (
            <span
              title={c.updateMessage}
              className="inline-flex cursor-help items-center gap-1.5 rounded-full whitespace-nowrap bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
            >
              <TriangleAlert size={12} /> Check failed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full whitespace-nowrap bg-zinc-500/10 px-2 py-0.5 text-xs font-medium text-muted">
              <CircleDashed size={12} /> Not checked
            </span>
          )}
          <div className="flex items-center gap-1">
            {c.updateStatus === 'update-available' && c.updateFrom && c.updateTo ? (
              <Chip
                className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <span
                  title={`${tag}: ${c.updateKind === 'version' ? 'version' : c.updateKind === 'revision' ? 'commit' : 'image ID'} ${c.updateFrom} → ${c.updateTo}`}
                  className="inline-flex items-center gap-1"
                >
                  <span className="opacity-70">{c.updateFrom}</span>
                  <span aria-hidden>→</span>
                  <span className="font-semibold">{c.updateTo}</span>
                </span>
              </Chip>
            ) : (
              <Chip>{tag}</Chip>
            )}
            <IconButton
              label="Check for update"
              className="size-6"
              disabled={busy || c.updateStatus === 'local'}
              onClick={onCheckUpdate}
            >
              <RefreshCw size={12} />
            </IconButton>
          </div>
        </div>
      </td>

      {advanced && (
        <>
          <td className={td}>
            <Chip className="font-sans text-xs">{c.network}</Chip>
          </td>
          <td className={`${td} font-mono text-xs`}>
            <div>{c.ip || <span className="text-muted">—</span>}</div>
            {c.mac && <div className="mt-0.5 text-[11px] text-muted">{c.mac}</div>}
          </td>
        </>
      )}

      {/* Ports */}
      <td className={td}>
        {c.ports.length === 0 ? (
          <span className="text-xs text-muted">{c.network === 'host' ? 'Host network' : '—'}</span>
        ) : (
          <div className="flex max-w-56 flex-wrap gap-1">
            {c.ports.map((p) =>
              p.hostPort ? (
                <a
                  key={`${p.containerPort}/${p.protocol}`}
                  href={`http://${hostIp}:${p.hostPort}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`${hostIp}:${p.hostPort} → ${p.containerPort}/${p.protocol}`}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[11px] text-sky-700 transition-colors hover:bg-sky-500/20 dark:text-sky-300"
                >
                  {p.hostPort}
                  <span className="text-sky-700/50 dark:text-sky-300/50">→</span>
                  {p.containerPort}/{p.protocol}
                  <ArrowUpRight size={11} />
                </a>
              ) : (
                <Chip key={`${p.containerPort}/${p.protocol}`}>
                  {p.containerPort}/{p.protocol}
                </Chip>
              ),
            )}
          </div>
        )}
      </td>

      {advanced && (
        <td className={`${td} max-w-sm`}>
          {c.volumes.length === 0 ? (
            <span className="text-xs text-muted">—</span>
          ) : (
            <div className="space-y-1">
              {visibleVolumes.map((v) => (
                <div key={v.container} className="font-mono text-[11px] leading-relaxed break-all">
                  <span className="text-fg">{v.container}</span>
                  <span className="mx-1 text-muted">↔</span>
                  <span className="text-muted">{v.host}</span>
                </div>
              ))}
              {c.volumes.length > 2 && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"
                >
                  {expanded ? 'Show less' : `+${c.volumes.length - 2} more`}
                  <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                </button>
              )}
            </div>
          )}
        </td>
      )}

      {/* Resources */}
      <td className={`${td} w-48`}>
        {c.state === 'running' ? (
          <div className="space-y-2">
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-muted">
                  CPU
                  {c.cpuLimit > 0 && <span title="CPU limit configured on the container"> · max {c.cpuLimit} cores</span>}
                </span>
                <span className="font-medium tabular-nums">{c.cpuPercent.toFixed(1)}%</span>
              </div>
              <Meter value={c.cpuPercent} tone="cpu" />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-muted">RAM</span>
                <span className="font-medium tabular-nums">
                  {formatBytes(c.memUsage)}
                  {c.memLimitConfigured > 0 ? (
                    <span className="text-muted" title="Memory limit configured on the container (--memory)">
                      {' '}
                      / {formatBytes(c.memLimitConfigured)}
                    </span>
                  ) : (
                    <span
                      className="text-muted"
                      title={`No memory limit: can use all host RAM${c.memLimit ? ` (${formatBytes(c.memLimit)})` : ''}. Set one with --memory in Edit → Extra parameters.`}
                    >
                      {' '}
                      / no limit
                    </span>
                  )}
                </span>
              </div>
              <Meter value={memPct} tone="mem" />
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted">—</span>
        )}
      </td>

      {/* Autostart */}
      <td className={td}>
        <Toggle label="Autostart" checked={c.autostart} disabled={busy} onChange={onAutostart} />
      </td>

      {/* Uptime */}
      <td className={`${td} text-xs whitespace-nowrap`}>
        <div className="font-medium">{active && c.startedAt ? timeAgo(c.startedAt) : '—'}</div>
        <div className="mt-0.5 text-muted">Created {timeAgo(c.createdAt)} ago</div>
      </td>

      {/* Actions */}
      <td className={`${td} text-right`}>
        <div className="flex items-center justify-end gap-0.5">
          {c.state === 'running' ? (
            <IconButton
              label={c.isSelf ? 'DockerUpdates cannot stop itself' : 'Stop'}
              tone="danger"
              disabled={busy || c.isSelf}
              onClick={() => onAction('stop')}
            >
              <Square size={15} />
            </IconButton>
          ) : c.state === 'paused' ? (
            <IconButton label="Resume" tone="success" disabled={busy} onClick={() => onAction('unpause')}>
              <Play size={15} />
            </IconButton>
          ) : (
            <IconButton label="Start" tone="success" disabled={busy} onClick={() => onAction('start')}>
              <Play size={15} />
            </IconButton>
          )}
          <IconButton label="Restart" disabled={busy || !active} onClick={() => onAction('restart')}>
            <RotateCw size={15} />
          </IconButton>
          {!c.isSelf && (
            <IconButton label="Edit" disabled={busy} onClick={onEdit}>
              <Pencil size={15} />
            </IconButton>
          )}
          <RowMenu
            items={[
              { label: 'Pause', icon: <Pause size={15} />, onSelect: () => onAction('pause'), hidden: c.state !== 'running' || c.isSelf },
              { label: 'Edit', icon: <Pencil size={15} />, onSelect: onEdit, hidden: c.isSelf },
              { label: 'Check for update', icon: <RefreshCw size={15} />, onSelect: onCheckUpdate, hidden: c.updateStatus === 'local' },
              { label: 'Force update', icon: <CloudDownload size={15} />, onSelect: onUpdate, hidden: c.updateStatus === 'local' },
              { label: 'Copy ID', icon: <Copy size={15} />, onSelect: () => onCopy(c.id) },
              { label: 'Remove', icon: <Trash2 size={15} />, onSelect: confirmRemove, danger: true, separatorBefore: true, hidden: c.isSelf },
            ]}
          />
        </div>
      </td>
    </tr>
  )
}
