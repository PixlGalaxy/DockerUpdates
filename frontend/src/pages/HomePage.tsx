import {
  CloudDownload,
  Copy,
  ExternalLink,
  FileDown,
  Globe,
  History,
  ImageIcon,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCw,
  ScrollText,
  Square,
  Terminal,
  Trash2,
} from 'lucide-react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { api, UnauthorizedError } from '../api'
import ContainerFormModal from '../components/ContainerFormModal'
import ContainerTable from '../components/ContainerTable'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import HistoryModal from '../components/HistoryModal'
import LogsModal from '../components/LogsModal'
import StatsCards, { type Filter } from '../components/StatsCards'
import BackgroundUpdate from '../components/BackgroundUpdate'
import UpdateProgressModal from '../components/UpdateProgressModal'
import type { ToastTone } from '../components/Toasts'
import { ActionBar, TopBar } from '../components/Toolbar'
import { useStoredState } from '../hooks'
import type {
  BulkSummary,
  CheckResult,
  CheckSummary,
  ContainerAction,
  ContainerInfo,
  ContainerSpec,
  HostInfo,
  LiveOperation,
} from '../types'
import { isActive } from '../utils'

// xterm.js is large: only loaded when a console is opened
const ConsoleModal = lazy(() => import('../components/ConsoleModal'))

const POLL_MS = 10_000
/** CPU / RAM refresh rate */
const STATS_TICK_MS = 1000

const ACTION_DONE: Record<ContainerAction, string> = {
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  pause: 'paused',
  unpause: 'resumed',
}

interface Props {
  host: HostInfo | null
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
  onSignedOut: () => void
  onSelfUpdate: () => void
  /** Reports host IP / name for the header */
  onHost: (ip: string, name: string) => void
}

type Panel = { kind: 'logs' | 'console' | 'history'; container: ContainerInfo } | null

export default function HomePage({ host, toast, onError, onSignedOut, onSelfUpdate, onHost }: Props) {
  const [advanced, setAdvanced] = useStoredState('du:advanced', true)
  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [hostIp, setHostIp] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  // Custom order saved on the server, and the order being edited while the lock is open
  const [order, setOrder] = useState<string[]>([])
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  // Containers whose update check is running (spins their check button)
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<{ id: string; spec: ContainerSpec } | null>(null)
  const [menu, setMenu] = useState<{ container: ContainerInfo; x: number; y: number } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [updateOp, setUpdateOp] = useState<LiveOperation | null>(null)
  // Update / install whose log was closed while it was still running (notice at the top)
  const [backgroundOp, setBackgroundOp] = useState<LiveOperation | null>(null)

  /** Opens the live update log (one container, several, or all with an update) */
  async function startUpdate(ids?: string[]) {
    try {
      setUpdateOp({ ...(await api.startUpdate(ids)), kind: 'update' })
    } catch (err) {
      onError(err)
    }
  }

  const load = useCallback(async () => {
    try {
      const data = await api.list()
      setContainers(data.containers)
      setOrder(data.order ?? [])
      setHostIp(data.hostIp)
      onHost(data.hostIp, data.hostName)
      setLastUpdated(new Date())
    } catch (err) {
      onError(err)
    } finally {
      setLoaded(true)
      setRefreshing(false)
    }
  }, [onError, onHost])

  const refresh = useCallback(() => {
    setRefreshing(true)
    return load()
  }, [load])

  useEffect(() => {
    // State is only set after the fetch resolves, not synchronously.
    // eslint-disable-next-line react/set-state-in-effect
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  // Live CPU / RAM: lightweight endpoint served from cached docker stats streams
  useEffect(() => {
    let inFlight = false
    const tick = async () => {
      if (inFlight || document.visibilityState !== 'visible') return
      inFlight = true
      try {
        const live = await api.stats()
        setContainers((cs) =>
          cs.map((c) => {
            const s = live[c.id]
            if (s) return { ...c, ...s }
            return c.state === 'running' ? c : { ...c, cpuPercent: 0, memUsage: 0 }
          }),
        )
      } catch (err) {
        if (err instanceof UnauthorizedError) onSignedOut()
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(tick, STATS_TICK_MS)
    return () => clearInterval(timer)
  }, [onSignedOut])

  /** `report` is a success message, or a callback that turns the result into toasts. */
  async function withBusy<T>(id: string, fn: () => Promise<T>, report?: string | ((r: T) => void)) {
    setBusyIds((s) => new Set(s).add(id))
    try {
      const result = await fn()
      if (typeof report === 'function') report(result)
      else if (report) toast('success', report)
    } catch (err) {
      onError(err)
    } finally {
      setBusyIds((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      await refresh()
    }
  }

  // "Check for updates" checks every container: spin all their check buttons meanwhile
  const spinningIds =
    globalBusy === 'check' ? new Set(containers.filter((c) => c.updateStatus !== 'local').map((c) => c.id)) : checkingIds

  async function checkUpdate(id: string) {
    setCheckingIds((s) => new Set(s).add(id))
    try {
      await withBusy(id, () => api.checkUpdate(id), reportCheck)
    } finally {
      setCheckingIds((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
    }
  }

  async function withGlobal<T>(key: string, fn: () => Promise<T>, report: (r: T) => void) {
    setGlobalBusy(key)
    try {
      report(await fn())
    } catch (err) {
      onError(err)
    } finally {
      setGlobalBusy(null)
      await refresh()
    }
  }

  const nameOf = (id: string) => containers.find((c) => c.id === id)?.name ?? 'Container'

  function reportCheck(r: CheckResult) {
    if (r.status === 'up-to-date') toast('success', `${r.name} is up to date`)
    else if (r.status === 'update-available') toast('info', `Update available for ${r.name}`)
    else toast('error', r.message ?? `Could not check ${r.name}`)
  }

  function reportCheckAll(s: CheckSummary) {
    const parts = [`${s.available} update${s.available === 1 ? '' : 's'} available`, `${s.upToDate} up to date`]
    if (s.authRequired) parts.push(`${s.authRequired} need registry login`)
    if (s.local) parts.push(`${s.local} local`)
    if (s.failed) parts.push(`${s.failed} failed`)
    toast(s.authRequired || s.failed ? 'info' : 'success', `Check finished: ${parts.join(', ')}`)
  }



  function reportBulk(action: ContainerAction, s: BulkSummary) {
    const n = `${s.affected} container${s.affected === 1 ? '' : 's'}`
    toast(s.failed ? 'error' : 'success', `${n} ${ACTION_DONE[action]}${s.failed ? `, ${s.failed} failed` : ''}`)
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast('info', 'Copied to clipboard')
    } catch {
      toast('error', 'Clipboard not available')
    }
  }

  async function exportTemplate(c: ContainerInfo) {
    try {
      const spec = await api.spec(c.id)
      const blob = new Blob([JSON.stringify({ ...spec, exportedBy: 'DockerUpdates' }, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${c.name}.dockerupdates.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err) {
      onError(err)
    }
  }

  const openEditor = (id: string) => withBusy(id, async () => setEditing({ id, spec: await api.spec(id) }))

  function menuItems(c: ContainerInfo): MenuItem[] {
    const running = c.state === 'running'
    const webPort = c.ports.find((p) => p.hostPort && p.protocol === 'tcp')
    const act = (a: ContainerAction) => () => withBusy(c.id, () => api.action(c.id, a), `${c.name} ${ACTION_DONE[a]}`)
    return [
      { label: 'WebUI', icon: <Globe size={15} />, hidden: !webPort || !running, onSelect: () => window.open(`http://${hostIp}:${webPort?.hostPort}`, '_blank', 'noreferrer') },
      { label: 'Console', icon: <Terminal size={15} />, disabled: !running, onSelect: () => setPanel({ kind: 'console', container: c }) },
      { label: 'Logs', icon: <ScrollText size={15} />, onSelect: () => setPanel({ kind: 'logs', container: c }) },
      { label: 'Start', icon: <Play size={15} />, hidden: isActive(c), separatorBefore: true, onSelect: act('start') },
      // Also while restarting / paused, so a container in a restart loop can always be stopped
      { label: 'Stop', icon: <Square size={15} />, hidden: !isActive(c) || c.isSelf, separatorBefore: true, onSelect: act('stop') },
      { label: 'Pause', icon: <Pause size={15} />, hidden: !running || c.isSelf, onSelect: act('pause') },
      { label: 'Resume', icon: <Play size={15} />, hidden: c.state !== 'paused', onSelect: act('unpause') },
      { label: 'Restart', icon: <RotateCw size={15} />, hidden: !isActive(c), separatorBefore: c.isSelf, onSelect: act('restart') },
      { label: 'Edit', icon: <Pencil size={15} />, hidden: c.isSelf, separatorBefore: true, onSelect: () => void openEditor(c.id) },
      { label: 'Check for update', icon: <RefreshCw size={15} />, hidden: c.updateStatus === 'local', separatorBefore: c.isSelf, onSelect: () => void checkUpdate(c.id) },
      { label: 'Force update', icon: <CloudDownload size={15} />, hidden: c.updateStatus === 'local', onSelect: () => void startUpdate([c.id]) },
      { label: 'Update history', icon: <History size={15} />, onSelect: () => setPanel({ kind: 'history', container: c }) },
      { label: 'Export template', icon: <FileDown size={15} />, onSelect: () => void exportTemplate(c) },
      {
        label: 'Refresh icon',
        icon: <ImageIcon size={15} />,
        onSelect: () =>
          withBusy(c.id, () => api.refreshIcon(c.id), (r) =>
            toast('info', r.reset ? `Looking for ${c.name}'s icon again…` : `${c.name} uses a custom icon (change it in Edit)`),
          ),
      },
      { label: 'Project page', icon: <ExternalLink size={15} />, hidden: !c.projectUrl, separatorBefore: true, onSelect: () => window.open(c.projectUrl, '_blank', 'noreferrer') },
      { label: 'Copy ID', icon: <Copy size={15} />, separatorBefore: !c.projectUrl, onSelect: () => void copy(c.id) },
      {
        label: 'Remove',
        icon: <Trash2 size={15} />,
        danger: true,
        hidden: c.isSelf,
        separatorBefore: true,
        onSelect: () => {
          if (confirm(`Remove container "${c.name}"? This cannot be undone.`)) {
            void withBusy(c.id, () => api.remove(c.id), `${c.name} removed`)
          }
        },
      },
    ]
  }

  const stats = useMemo(() => {
    const running = containers.filter((c) => c.state === 'running').length
    return {
      total: containers.length,
      running,
      stopped: containers.length - running,
      updates: containers.filter((c) => c.updateStatus === 'update-available').length,
    }
  }, [containers])

  const visible = useMemo(() => {
    // Reordering: every container, in the order being edited
    if (draftOrder) return sortByOrder(containers, draftOrder)
    const q = search.trim().toLowerCase()
    const shown = containers
      .filter((c) => {
        if (filter === 'running') return c.state === 'running'
        if (filter === 'stopped') return c.state !== 'running'
        if (filter === 'updates') return c.updateStatus === 'update-available'
        return true
      })
      .filter((c) => !q || [c.name, c.image, c.ip ?? '', c.network].some((v) => v.toLowerCase().includes(q)))
    return sortByOrder(shown, order)
  }, [containers, filter, search, order, draftOrder])

  /** Lock button: open = start reordering every container; closed again = save the order */
  async function toggleOrder() {
    if (!draftOrder) {
      setSearch('')
      setFilter('all')
      setDraftOrder(sortByOrder(containers, order).map((c) => c.name))
      return
    }
    const names = sortByOrder(containers, draftOrder).map((c) => c.name)
    const saved = sortByOrder(containers, order)
    if (names.every((n, i) => n === saved[i].name)) {
      setDraftOrder(null)
      return
    }
    setSavingOrder(true)
    try {
      setOrder((await api.saveOrder(names)).order)
      setDraftOrder(null)
      toast('success', 'Container order saved')
    } catch (err) {
      onError(err) // stays unlocked: the order can be saved again
    } finally {
      setSavingOrder(false)
    }
  }

  /** Moves `name` to the place of `over` in the order being edited */
  const reorder = useCallback(
    (name: string, over: string) =>
      setDraftOrder((d) => {
        if (!d) return d
        const names = sortByOrder(containers, d).map((c) => c.name)
        const from = names.indexOf(name)
        const to = names.indexOf(over)
        if (from === -1 || to === -1) return d
        names.splice(from, 1)
        names.splice(to, 0, name)
        return names
      }),
    [containers],
  )

  // The server checks a created / edited container for updates 3 s after it starts:
  // refresh once more so its status replaces "Not checked" without waiting for the poll
  const refreshAfterCheck = () => setTimeout(() => void refresh(), 5000)

  const handleSubmitError = (err: unknown) => {
    if (err instanceof UnauthorizedError) onSignedOut()
    throw err
  }

  return (
    <>
      <StatsCards {...stats} filter={filter} onFilter={setFilter} />

      <TopBar
        search={search}
        onSearch={setSearch}
        advanced={advanced}
        onAdvanced={setAdvanced}
        lastUpdated={lastUpdated}
        refreshing={refreshing}
        onRefresh={refresh}
        orderUnlocked={draftOrder !== null}
        orderSaving={savingOrder}
        onToggleOrder={() => void toggleOrder()}
      />

      <ContainerTable
        containers={visible}
        hostIp={hostIp}
        hostCpus={host?.cpus}
        advanced={advanced}
        loading={!loaded}
        busyIds={busyIds}
        checkingIds={spinningIds}
        emptyMessage={search || filter !== 'all' ? 'No containers match your filters.' : 'No containers found.'}
        onMenu={(c, x, y) => setMenu({ container: c, x, y })}
        onAutostart={(id, enabled) =>
          withBusy(id, () => api.setAutostart(id, enabled), `Autostart ${enabled ? 'enabled' : 'disabled'} for ${nameOf(id)}`)
        }
        onCheckUpdate={(id) => void checkUpdate(id)}
        onUpdate={(id) => void startUpdate([id])}
        onCopy={copy}
        onReorder={draftOrder ? reorder : undefined}
      />

      <ActionBar
        busy={globalBusy}
        updates={stats.updates}
        onAdd={() => setShowAdd(true)}
        onBulk={(a) => withGlobal(a, () => api.bulk(a), (s) => reportBulk(a, s))}
        onCheckUpdates={() => withGlobal('check', api.checkAllUpdates, reportCheckAll)}
        onUpdateAll={() => void startUpdate()}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menu.container.name}
          items={menuItems(menu.container)}
          onClose={() => setMenu(null)}
        />
      )}

      {updateOp && (
        <UpdateProgressModal
          opId={updateOp.id}
          title={updateOp.title}
          kind={updateOp.kind}
          onSelfUpdate={onSelfUpdate}
          onClose={(finished) => {
            if (!finished) setBackgroundOp(updateOp)
            setUpdateOp(null)
            void refresh()
            // A new container gets its first update check a few seconds after it starts
            if (finished && updateOp.kind === 'install') refreshAfterCheck()
          }}
        />
      )}

      {backgroundOp && !updateOp && (
        <BackgroundUpdate
          key={backgroundOp.id}
          opId={backgroundOp.id}
          title={backgroundOp.title}
          kind={backgroundOp.kind}
          onOpen={() => {
            setUpdateOp(backgroundOp)
            setBackgroundOp(null)
          }}
          onDismiss={() => setBackgroundOp(null)}
          onFinished={() => {
            void refresh()
            if (backgroundOp.kind === 'install') refreshAfterCheck()
          }}
          onSelfUpdate={onSelfUpdate}
        />
      )}

      {panel?.kind === 'logs' && <LogsModal container={panel.container} onClose={() => setPanel(null)} />}
      {panel?.kind === 'console' && (
        <Suspense fallback={null}>
          <ConsoleModal container={panel.container} onClose={() => setPanel(null)} />
        </Suspense>
      )}
      {panel?.kind === 'history' && <HistoryModal container={panel.container} onClose={() => setPanel(null)} />}

      {showAdd && (
        <ContainerFormModal
          mode="add"
          hostMemTotal={host?.memTotal}
          onClose={() => setShowAdd(false)}
          onSubmit={async (spec) => {
            // Invalid settings are rejected right away and stay in the form; then the form closes
            // and the install runs with a live log (pull, docker run…)
            const op = await api.startCreate(spec).catch(handleSubmitError)
            setUpdateOp({ ...op, kind: 'install' })
          }}
        />
      )}

      {editing && (
        <ContainerFormModal
          mode="edit"
          initial={editing.spec}
          hostMemTotal={host?.memTotal}
          onClose={() => setEditing(null)}
          onSubmit={async (spec) => {
            const { id } = editing
            setBusyIds((s) => new Set(s).add(id))
            try {
              const r = await api.edit(id, spec).catch(handleSubmitError)
              toast('success', `${r.name} updated with the new settings`)
            } finally {
              setBusyIds((s) => {
                const next = new Set(s)
                next.delete(id)
                return next
              })
              await refresh()
              refreshAfterCheck()
            }
          }}
        />
      )}
    </>
  )
}

/** Containers in the saved order; the ones not in it (new) go after, alphabetically. */
function sortByOrder(list: ContainerInfo[], order: string[]) {
  const rank = new Map(order.map((name, i) => [name, i]))
  return [...list].sort(
    (a, b) => (rank.get(a.name) ?? Infinity) - (rank.get(b.name) ?? Infinity) || a.name.localeCompare(b.name),
  )
}
