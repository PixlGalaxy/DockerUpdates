import {
  CloudDownload,
  Eye,
  Copy,
  ExternalLink,
  FileDown,
  FolderMinus,
  FolderX,
  Globe,
  History,
  ImageIcon,
  Layers,
  Palette,
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
import ContainerTable, { type ListItem } from '../components/ContainerTable'
import ContextMenu, { type MenuItem } from '../components/ContextMenu'
import HistoryModal from '../components/HistoryModal'
import LogsModal from '../components/LogsModal'
import StatsCards, { type Filter } from '../components/StatsCards'
import BackgroundUpdate from '../components/BackgroundUpdate'
import UpdateProgressModal from '../components/UpdateProgressModal'
import FolderNameModal from '../components/FolderNameModal'
import GroupIconModal from '../components/GroupIconModal'
import StackColorPicker from '../components/StackColorPicker'
import StackFormModal from '../components/StackFormModal'
import type { StackGroup } from '../components/StackRow'
import type { ToastTone } from '../components/Toasts'
import { ActionBar, TopBar } from '../components/Toolbar'
import { useStoredState } from '../hooks'
import type {
  BulkSummary,
  CheckResult,
  ContainerFolder,
  GroupIcon,
  CheckSummary,
  ContainerAction,
  ContainerInfo,
  ContainerSpec,
  HostInfo,
  LiveOperation,
  StackAction,
  StackFile,
} from '../types'
import { stackColor } from '../stackColors'
import { isActive } from '../utils'

// xterm.js is large: only loaded when a console is opened
const ConsoleModal = lazy(() => import('../components/ConsoleModal'))

const POLL_MS = 10_000
/** CPU / RAM refresh rate */
const STATS_TICK_MS = 1000

const STACK_DONE: Record<StackAction, string> = {
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  down: 'removed',
}

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
  // Managed compose stacks, and the stack editor (new stack or a managed one)
  const [stacks, setStacks] = useState<string[]>([])
  const [stackEditor, setStackEditor] = useState<{ mode: 'add' | 'edit'; initial?: StackFile } | null>(null)
  const [stackMenu, setStackMenu] = useState<{ stack: StackGroup; x: number; y: number } | null>(null)
  const [busyStacks, setBusyStacks] = useState<Set<string>>(new Set())
  // Stacks / folders whose update check is running (spins their check button)
  const [checkingGroups, setCheckingGroups] = useState<Set<string>>(new Set())
  const [stackColors, setStackColors] = useState<Record<string, string>>({})
  const [colorPicker, setColorPicker] = useState<{ group: StackGroup; x: number; y: number } | null>(null)
  // Folders of standalone containers, and the folder being named (`created`: just made)
  const [folders, setFolders] = useState<ContainerFolder[]>([])
  const [naming, setNaming] = useState<{ folder: ContainerFolder; created: boolean } | null>(null)
  // Icons of stacks and folders, and the group whose icon is being set
  const [groupIcons, setGroupIcons] = useState<Record<string, GroupIcon>>({})
  const [iconFor, setIconFor] = useState<StackGroup | null>(null)
  const [collapsedList, setCollapsedList] = useStoredState<string[]>('du:collapsed-stacks', [])
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList])
  // Custom order saved on the server, and the order being edited while the lock is open
  const [order, setOrder] = useState<string[]>([])
  // While the lock is open: the order and the folders being edited, saved together when it closes
  const [draft, setDraft] = useState<Draft | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  // Containers whose update check is running (spins their check button)
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set())
  const [globalBusy, setGlobalBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<{ id: string; spec: ContainerSpec } | null>(null)
  // Read-only settings of a compose service (it is edited in its compose file, not in the form)
  const [viewing, setViewing] = useState<{ container: ContainerInfo; spec: ContainerSpec } | null>(null)
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
      setStacks(data.stacks ?? [])
      setStackColors(data.stackColors ?? {})
      setFolders(data.folders ?? [])
      setGroupIcons(data.groupIcons ?? {})
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

  /** Opens the compose file of a managed stack */
  const openStackEditor = (name: string) =>
    withStack(name, async () => setStackEditor({ mode: 'edit', initial: await api.stack(name) }))

  async function withStack<T>(name: string, fn: () => Promise<T>, report?: (r: T) => void) {
    setBusyStacks((s) => new Set(s).add(name))
    try {
      const r = await fn()
      report?.(r)
    } catch (err) {
      onError(err)
    } finally {
      setBusyStacks((s) => {
        const next = new Set(s)
        next.delete(name)
        return next
      })
      await refresh()
    }
  }

  /** Shows the new color at once, then saves it (reverts if the server refuses) */
  async function pickStackColor(name: string, color: string | null) {
    const before = stackColors
    setStackColors(({ [name]: _old, ...rest }) => (color ? { ...rest, [name]: color } : rest))
    try {
      setStackColors((await api.setStackColor(name, color)).stackColors)
    } catch (err) {
      setStackColors(before)
      onError(err)
    }
  }

  /** Shows the folders at once, then saves them (reverts if the server refuses) */
  async function saveFolders(next: ContainerFolder[]) {
    const before = folders
    setFolders(next)
    try {
      setFolders((await api.saveFolders(next)).folders)
    } catch (err) {
      setFolders(before)
      onError(err)
    }
  }

  const folderOf = (name: string) => folders.find((f) => f.containers.includes(name))
  const folderById = (group: StackGroup) => folders.find((f) => `folder:${f.id}` === group.id)

  /**
   * Container `name` dropped on `into` while reordering: on another container, both make a new
   * folder in that container's place (then it is named); on a folder, it joins it at the end.
   * Only in the draft: saved when the lock closes.
   */
  function merge(name: string, into: string) {
    const folder: ContainerFolder | null = into.startsWith('folder:')
      ? null
      : { id: Math.random().toString(36).slice(2, 10), name: 'New folder', containers: [into, name] }
    setDraft((d) => {
      if (!d) return d
      const without = d.folders.map((f) => ({ ...f, containers: f.containers.filter((n) => n !== name) }))
      if (!folder) {
        return {
          order: d.order.filter((k) => k !== name),
          folders: without.map((f) => (`folder:${f.id}` === into ? { ...f, containers: [...f.containers, name] } : f)),
        }
      }
      return {
        order: d.order.filter((k) => k !== name).map((k) => (k === into ? `folder:${folder.id}` : k)),
        folders: [...without, folder],
      }
    })
    if (folder) setNaming({ folder, created: true })
  }

  /** Takes containers out of a folder (its menu); they keep its place in the order. Empty folders go away. */
  async function leaveFolder(folder: ContainerFolder, names: string[]) {
    const key = `folder:${folder.id}`
    const place = (list: string[]) => {
      const at = list.indexOf(key)
      const rest = list.filter((k) => !names.includes(k))
      return at === -1 ? [...rest, ...names] : [...rest.slice(0, at + 1), ...names, ...rest.slice(at + 1)]
    }
    const left = folder.containers.filter((n) => !names.includes(n))
    await saveFolders(left.length ? folders.map((f) => (f.id === folder.id ? { ...f, containers: left } : f)) : folders.filter((f) => f.id !== folder.id))
    try {
      setOrder((await api.saveOrder(place(order).filter((k) => left.length || k !== key))).order)
    } catch (err) {
      onError(err)
    }
  }

  /** Same action on every container of a folder (DockerUpdates itself is never stopped / paused) */
  const folderAction = (group: StackGroup, a: ContainerAction) =>
    withStack(
      group.id,
      async () => {
        const targets = group.containers.filter((c) => !(c.isSelf && a !== 'start' && a !== 'restart'))
        const results = await Promise.allSettled(targets.map((c) => api.action(c.id, a)))
        return { affected: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length }
      },
      (r) => toast(r.failed ? 'error' : 'success', `${group.name}: ${r.affected} ${ACTION_DONE[a]}${r.failed ? `, ${r.failed} failed` : ''}`),
    )

  /**
   * Checks every container of a stack or folder for updates, one by one (registries rate-limit
   * parallel pulls); the check buttons of the group and of its containers spin meanwhile.
   */
  async function checkGroup(group: StackGroup) {
    const ids = group.containers.filter((c) => c.updateStatus !== 'local').map((c) => c.id)
    const remove = (set: Set<string>, keys: string[]) => {
      const next = new Set(set)
      for (const k of keys) next.delete(k)
      return next
    }
    setCheckingGroups((s) => new Set(s).add(group.id))
    setCheckingIds((s) => new Set([...s, ...ids]))
    try {
      await withStack(
        group.id,
        async () => {
          if (group.kind === 'stack') return api.checkStackUpdates(group.name)
          const s: CheckSummary = { upToDate: 0, available: 0, authRequired: 0, failed: 0, local: 0 }
          for (const id of ids) {
            const r = await api.checkUpdate(id).catch(() => ({ status: 'error' as const }))
            if (r.status === 'up-to-date') s.upToDate++
            else if (r.status === 'update-available') s.available++
            else if (r.status === 'auth-required') s.authRequired++
            else s.failed++
          }
          return s
        },
        reportCheckAll,
      )
    } finally {
      setCheckingGroups((s) => remove(s, [group.id]))
      setCheckingIds((s) => remove(s, ids))
    }
  }

  function folderMenuItems(group: StackGroup, x: number, y: number): MenuItem[] {
    const folder = folderById(group)
    const ids = group.containers.filter((c) => c.updateStatus === 'update-available').map((c) => c.id)
    const anyActive = group.containers.some(isActive)
    return [
      { label: `Update folder (${ids.length})`, icon: <CloudDownload size={15} />, hidden: ids.length === 0, onSelect: () => void startUpdate(ids) },
      { label: 'Check for updates', icon: <RefreshCw size={15} />, onSelect: () => void checkGroup(group) },
      { label: 'Start all', icon: <Play size={15} />, separatorBefore: true, hidden: group.containers.every(isActive), onSelect: () => void folderAction(group, 'start') },
      { label: 'Stop all', icon: <Square size={15} />, hidden: !anyActive, onSelect: () => void folderAction(group, 'stop') },
      { label: 'Restart all', icon: <RotateCw size={15} />, hidden: !anyActive, onSelect: () => void folderAction(group, 'restart') },
      { label: 'Rename folder', icon: <Pencil size={15} />, separatorBefore: true, onSelect: () => folder && setNaming({ folder, created: false }) },
      { label: 'Select color', icon: <Palette size={15} />, onSelect: () => setColorPicker({ group, x, y }) },
      { label: 'Set icon', icon: <ImageIcon size={15} />, onSelect: () => setIconFor(group) },
      {
        label: 'Ungroup folder',
        icon: <FolderX size={15} />,
        separatorBefore: true,
        onSelect: () => folder && void leaveFolder(folder, folder.containers),
      },
    ]
  }

  function stackMenuItems(st: StackGroup, x: number, y: number): MenuItem[] {
    if (st.kind === 'folder') return folderMenuItems(st, x, y)
    const ids = st.containers.filter((c) => c.updateStatus === 'update-available').map((c) => c.id)
    const anyActive = st.containers.some(isActive)
    const hasSelf = st.containers.some((c) => c.isSelf)
    const act = (a: StackAction) => () =>
      withStack(st.name, () => api.stackAction(st.name, a), (r) =>
        toast(r.failed ? 'error' : 'success', `Stack ${st.name} ${STACK_DONE[a]}${r.failed ? `, ${r.failed} failed` : ''}`),
      )
    return [
      { label: `Update stack (${ids.length})`, icon: <CloudDownload size={15} />, hidden: ids.length === 0, onSelect: () => void startUpdate(ids) },
      {
        label: 'Check for updates',
        icon: <RefreshCw size={15} />,
        hidden: st.containers.length === 0,
        onSelect: () => void checkGroup(st),
      },
      { label: st.containers.length === 0 ? 'Deploy' : 'Start all', icon: <Play size={15} />, separatorBefore: true, hidden: !st.managed && st.containers.every(isActive), onSelect: act('start') },
      { label: 'Stop all', icon: <Square size={15} />, hidden: !anyActive || hasSelf, onSelect: act('stop') },
      { label: 'Restart all', icon: <RotateCw size={15} />, hidden: !anyActive || hasSelf, onSelect: act('restart') },
      {
        label: 'Select color',
        icon: <Palette size={15} />,
        separatorBefore: true,
        onSelect: () => setColorPicker({ group: st, x, y }),
      },
      { label: 'Set icon', icon: <ImageIcon size={15} />, onSelect: () => setIconFor(st) },
      {
        label: st.managed ? 'Edit compose file' : 'Edit compose file (external)',
        icon: <Pencil size={15} />,
        disabled: !st.managed,
        onSelect: () => void openStackEditor(st.name),
      },
      {
        label: 'Remove stack',
        icon: <Trash2 size={15} />,
        danger: true,
        hidden: !st.managed || hasSelf,
        separatorBefore: true,
        onSelect: () => {
          if (confirm(`Remove stack "${st.name}"? Its containers are removed (docker compose down); volumes are kept.`)) {
            void withStack(st.name, () => api.stackAction(st.name, 'down'), () => toast('success', `Stack ${st.name} removed`))
          }
        },
      },
    ]
  }

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
      // A compose service is edited in its stack's compose file, never through the form
      c.stack
        ? {
            label: c.stack.managed ? 'Edit compose file' : 'Edit (in its compose file)',
            icon: <Layers size={15} />,
            hidden: c.isSelf,
            disabled: !c.stack.managed,
            separatorBefore: true,
            onSelect: () => void openStackEditor(c.stack!.project),
          }
        : { label: 'Edit', icon: <Pencil size={15} />, hidden: c.isSelf, separatorBefore: true, onSelect: () => void openEditor(c.id) },
      {
        label: 'View settings',
        icon: <Eye size={15} />,
        hidden: !c.stack,
        onSelect: () => void withBusy(c.id, async () => setViewing({ container: c, spec: await api.spec(c.id) })),
      },
      { label: 'Check for update', icon: <RefreshCw size={15} />, hidden: c.updateStatus === 'local', separatorBefore: c.isSelf, onSelect: () => void checkUpdate(c.id) },
      { label: 'Force update', icon: <CloudDownload size={15} />, hidden: c.updateStatus === 'local', onSelect: () => void startUpdate([c.id]) },
      { label: 'Update history', icon: <History size={15} />, onSelect: () => setPanel({ kind: 'history', container: c }) },
      {
        label: `Remove from ${folderOf(c.name)?.name ?? 'folder'}`,
        icon: <FolderMinus size={15} />,
        hidden: Boolean(c.stack) || !folderOf(c.name),
        onSelect: () => void leaveFolder(folderOf(c.name)!, [c.name]),
      },
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
          const note = c.stack ? ` It belongs to the stack "${c.stack.project}": compose creates it again on the next deploy.` : ''
          if (confirm(`Remove container "${c.name}"? This cannot be undone.${note}`)) {
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

  const items = useMemo(() => {
    // Reordering: every container and stack, in the order being edited
    if (draft) return sortItems(groupItems(containers, stacks, stackColors, draft.folders, groupIcons), draft.order)
    const q = search.trim().toLowerCase()
    const shown = containers
      .filter((c) => {
        if (filter === 'running') return c.state === 'running'
        if (filter === 'stopped') return c.state !== 'running'
        if (filter === 'updates') return c.updateStatus === 'update-available'
        return true
      })
      .filter((c) =>
        !q ||
        [c.name, c.image, c.ip ?? '', c.network, c.stack?.project ?? '', c.stack ? '' : (folders.find((f) => f.containers.includes(c.name))?.name ?? '')].some((v) =>
          v.toLowerCase().includes(q),
        ),
      )
    // Managed stacks with no container (not deployed) only show in the unfiltered list
    const empty = filter === 'all' ? stacks.filter((s) => !q || s.includes(q)) : []
    return sortItems(groupItems(shown, empty, stackColors, folders, groupIcons), order)
  }, [containers, stacks, stackColors, folders, groupIcons, filter, search, order, draft])

  /** Lock button: open = start reordering every container; closed again = save the order and folders */
  async function toggleOrder() {
    if (!draft) {
      setSearch('')
      setFilter('all')
      setDraft({ order: sortItems(groupItems(containers, stacks, {}, folders), order).map((i) => i.key), folders })
      return
    }
    // Folders left empty (every container moved out) go away
    const nextFolders = draft.folders.filter((f) => f.containers.length > 0)
    const names = sortItems(groupItems(containers, stacks, {}, nextFolders), draft.order).map((i) => i.key)
    const saved = sortItems(groupItems(containers, stacks, {}, folders), order).map((i) => i.key)
    const foldersChanged = JSON.stringify(nextFolders) !== JSON.stringify(folders)
    const orderChanged = names.join('/') !== saved.join('/')
    if (!foldersChanged && !orderChanged) {
      setDraft(null)
      return
    }
    setSavingOrder(true)
    try {
      if (foldersChanged) setFolders((await api.saveFolders(nextFolders)).folders)
      if (orderChanged) setOrder((await api.saveOrder(names)).order)
      setDraft(null)
      toast('success', foldersChanged ? 'Order and folders saved' : 'Container order saved')
    } catch (err) {
      onError(err) // stays unlocked: it can be saved again
    } finally {
      setSavingOrder(false)
    }
  }

  /** Moves `name` to the place of `over` in the draft, in or out of folders (see moveInDraft) */
  const reorder = useCallback(
    (name: string, over: string) =>
      setDraft((d) => d && moveInDraft(d, sortItems(groupItems(containers, stacks, {}, d.folders), d.order).map((i) => i.key), name, over)),
    [containers, stacks],
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
        orderUnlocked={draft !== null}
        orderSaving={savingOrder}
        onToggleOrder={() => void toggleOrder()}
      />

      <ContainerTable
        items={items}
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
        onReorder={draft ? reorder : undefined}
        onMerge={draft ? merge : undefined}
        collapsed={collapsed}
        busyStacks={busyStacks}
        // "Check for updates" at the bottom checks every container: spin the group buttons too
        checkingStacks={
          globalBusy === 'check'
            ? new Set(items.flatMap((i) => (i.kind === 'stack' ? [i.stack.id] : [])))
            : checkingGroups
        }
        onStackCheck={(stack) => void checkGroup(stack)}
        onToggleStack={(name) =>
          setCollapsedList((l) => (l.includes(name) ? l.filter((n) => n !== name) : [...l, name]))
        }
        onStackMenu={(stack, x, y) => setStackMenu({ stack, x, y })}
        onStackAutostart={(stack, enabled) =>
          void withStack(
            stack.id,
            async () => {
              if (stack.kind === 'stack') return api.setStackAutostart(stack.name, enabled)
              const results = await Promise.allSettled(stack.containers.map((c) => api.setAutostart(c.id, enabled)))
              return { affected: results.filter((r) => r.status === 'fulfilled').length, failed: results.filter((r) => r.status === 'rejected').length }
            },
            (r) =>
            toast(
              r.failed ? 'error' : 'success',
              `Autostart ${enabled ? 'enabled' : 'disabled'} for ${r.affected} ${stack.kind === 'stack' ? 'service' : 'container'}${r.affected === 1 ? '' : 's'} of ${stack.name}${r.failed ? `, ${r.failed} failed` : ''}`,
            ),
          )
        }
        onStackUpdate={(stack) =>
          void startUpdate(stack.containers.filter((c) => c.updateStatus === 'update-available').map((c) => c.id))
        }
      />

      <ActionBar
        busy={globalBusy}
        updates={stats.updates}
        onAdd={() => setShowAdd(true)}
        onAddCompose={() => setStackEditor({ mode: 'add' })}
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

      {stackMenu && (
        <ContextMenu
          x={stackMenu.x}
          y={stackMenu.y}
          title={`Stack ${stackMenu.stack.name}`}
          items={stackMenuItems(stackMenu.stack, stackMenu.x, stackMenu.y)}
          onClose={() => setStackMenu(null)}
        />
      )}

      {colorPicker && (
        <StackColorPicker
          x={colorPicker.x}
          y={colorPicker.y}
          name={colorPicker.group.name}
          seed={colorPicker.group.kind === 'stack' ? colorPicker.group.name : colorPicker.group.id}
          chosen={colorPicker.group.kind === 'stack' ? stackColors[colorPicker.group.name] : folderById(colorPicker.group)?.color}
          onPick={(color) => {
            const g = colorPicker.group
            if (g.kind === 'stack') return void pickStackColor(g.name, color)
            void saveFolders(folders.map((f) => (`folder:${f.id}` === g.id ? { ...f, color: color ?? undefined } : f)))
          }}
          onClose={() => setColorPicker(null)}
        />
      )}

      {iconFor && (
        <GroupIconModal
          kind={iconFor.kind}
          name={iconFor.name}
          initial={groupIcons[iconFor.orderKey]?.url ?? ''}
          onSave={async (url) => {
            setGroupIcons((await api.setGroupIcon(iconFor.orderKey, url).catch(handleSubmitError)).groupIcons)
          }}
          onClose={() => setIconFor(null)}
        />
      )}

      {naming && (
        <FolderNameModal
          initial={naming.folder.name}
          created={naming.created}
          onSave={(name) => {
            const rename = (list: ContainerFolder[]) => list.map((f) => (f.id === naming.folder.id ? { ...f, name } : f))
            // A folder just made only exists in the draft until the lock closes
            if (draft) setDraft((d) => d && { ...d, folders: rename(d.folders) })
            else void saveFolders(rename(folders))
          }}
          onClose={() => setNaming(null)}
        />
      )}

      {stackEditor && (
        <StackFormModal
          mode={stackEditor.mode}
          initial={stackEditor.initial}
          onClose={() => setStackEditor(null)}
          onSubmit={async (stack) => {
            // A file docker compose rejects stays in the editor; then the deploy runs with a live log
            const op = await api
              .startStackDeploy({ ...stack, isNew: stackEditor.mode === 'add' })
              .catch(handleSubmitError)
            setUpdateOp({ ...op, kind: 'install' })
          }}
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

      {viewing && (
        <ContainerFormModal
          mode="view"
          initial={viewing.spec}
          hostMemTotal={host?.memTotal}
          readOnlyNote={
            viewing.container.stack?.managed
              ? `Service "${viewing.container.stack.service}" of the stack ${viewing.container.stack.project}: change it with Edit compose file.`
              : `Service "${viewing.container.stack?.service}" of the stack ${viewing.container.stack?.project}, started outside DockerUpdates: change it in its own compose file.`
          }
          onClose={() => setViewing(null)}
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

/**
 * Containers of a compose project become one stack entry (services sorted by name), standalone
 * containers in a folder one folder entry (in the order they were added); the others stay single.
 * `emptyStacks`: managed stacks to show even with no container. `colors`: colors chosen for
 * stacks (the others get one from their name). `icons`: custom icons of stacks and folders.
 * Folders with no container in `list` are left out.
 */
function groupItems(
  list: ContainerInfo[],
  emptyStacks: string[],
  colors: Record<string, string> = {},
  folders: ContainerFolder[] = [],
  icons: Record<string, GroupIcon> = {},
): ListItem[] {
  const items: ListItem[] = []
  const stacks = new Map<string, StackGroup>()
  const inFolder = new Map(folders.flatMap((f) => f.containers.map((n) => [n, f] as const)))
  const folderGroups = new Map<string, StackGroup>()
  for (const c of list) {
    const folder = c.stack ? undefined : inFolder.get(c.name)
    if (folder) {
      let g = folderGroups.get(folder.id)
      if (!g) {
        g = { kind: 'folder', id: `folder:${folder.id}`, name: folder.name, orderKey: `folder:${folder.id}`, managed: false, containers: [], color: stackColor(`folder:${folder.id}`, folder.color) }
        folderGroups.set(folder.id, g)
      }
      g.containers.push(c)
    } else if (c.stack) {
      const project = c.stack.project
      let g = stacks.get(project)
      if (!g) {
        g = { kind: 'stack', id: project, name: project, orderKey: `stack:${project}`, managed: c.stack.managed, containers: [], color: stackColor(project, colors[project]) }
        stacks.set(project, g)
      }
      g.containers.push(c)
    } else {
      items.push({ kind: 'container', key: c.name, container: c })
    }
  }
  for (const name of emptyStacks) {
    if (!stacks.has(name)) {
      stacks.set(name, { kind: 'stack', id: name, name, orderKey: `stack:${name}`, managed: true, containers: [], color: stackColor(name, colors[name]) })
    }
  }
  for (const g of [...stacks.values(), ...folderGroups.values()]) g.icon = icons[g.orderKey]?.icon
  for (const g of stacks.values()) {
    g.containers.sort((a, b) => a.name.localeCompare(b.name))
    items.push({ kind: 'stack', key: g.orderKey, stack: g })
  }
  for (const [id, g] of folderGroups) {
    const position = folders.find((f) => f.id === id)!.containers
    g.containers.sort((a, b) => position.indexOf(a.name) - position.indexOf(b.name))
    items.push({ kind: 'stack', key: g.orderKey, stack: g })
  }
  return items
}

/**
 * Entries in the saved order; the ones not in it (new) go after, alphabetically. A stack or folder
 * not saved yet takes the place of its first container (the order from before it was grouped).
 */
function sortItems(items: ListItem[], order: string[]) {
  const rank = new Map(order.map((key, i) => [key, i]))
  const rankOf = (item: ListItem) =>
    rank.get(item.key) ??
    (item.kind === 'stack' ? Math.min(...item.stack.containers.map((c) => rank.get(c.name) ?? Infinity)) : Infinity)
  const label = (item: ListItem) => (item.kind === 'stack' ? item.stack.name : item.container.name)
  return [...items].sort((a, b) => rankOf(a) - rankOf(b) || label(a).localeCompare(label(b)))
}

/** Order and folders being edited while the lock is open */
interface Draft {
  order: string[]
  folders: ContainerFolder[]
}

/**
 * Moves container or group `name` to the place of `over` (the row it was dragged past). `keys`:
 * the top-level order ids as shown. A container passed over a container of a folder goes into
 * that folder; one of a folder passed over anything outside it leaves the folder. Moving down,
 * it goes after `over`; moving up, before it. Stacks and folders only move at the top level.
 */
function moveInDraft(d: Draft, keys: string[], name: string, over: string): Draft {
  const folderOf = (n: string) => d.folders.find((f) => f.containers.includes(n))
  const from = name.includes(':') ? undefined : folderOf(name)
  let into = over.includes(':') ? undefined : folderOf(over)
  // A stack or folder dragged over the containers of a folder moves past the whole folder
  if (name.includes(':') && into) {
    over = `folder:${into.id}`
    into = undefined
  }
  // Where it is now, as a top-level position (a container in a folder counts as the folder)
  const at = (k: string) => {
    const f = k.includes(':') ? undefined : folderOf(k)
    return keys.indexOf(f ? `folder:${f.id}` : k)
  }

  let folders = from ? d.folders.map((f) => (f.id === from.id ? { ...f, containers: f.containers.filter((n) => n !== name) } : f)) : d.folders
  if (into) {
    const list = folders.find((f) => f.id === into.id)!.containers
    const down = from?.id === into.id ? into.containers.indexOf(name) < into.containers.indexOf(over) : at(name) < at(over)
    const i = list.indexOf(over)
    const next = [...list.slice(0, down ? i + 1 : i), name, ...list.slice(down ? i + 1 : i)]
    folders = folders.map((f) => (f.id === into.id ? { ...f, containers: next } : f))
    return { order: d.order.filter((k) => k !== name), folders }
  }

  const order = keys.filter((k) => k !== name)
  const i = order.indexOf(over)
  if (i === -1) return d
  // Out of its folder over the folder itself: just above it
  const down = from && over === `folder:${from.id}` ? false : at(name) < at(over)
  order.splice(down ? i + 1 : i, 0, name)
  return { order, folders }
}
