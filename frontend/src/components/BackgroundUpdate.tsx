import { Bomb, CircleAlert, CircleCheck, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { OperationKind, OperationResult } from '../types'
import { failedCount } from '../utils'

interface Props {
  opId: string
  /** "Updating all containers", "Updating the container"… */
  title: string
  kind?: OperationKind
  /** Reopen the live log */
  onOpen: () => void
  /** The notice is gone (finished and faded, or dismissed) */
  onDismiss: () => void
  /** Finished: refresh the container list */
  onFinished: () => void
  onSelfUpdate: () => void
}

type State = 'running' | 'ok' | 'failed' | 'lost'

const HIDE_AFTER_MS = 3000

const TONES: Record<State, string> = {
  running: 'bg-amber-500 text-white shadow-amber-500/30',
  ok: 'bg-emerald-600 text-white shadow-emerald-600/30',
  failed: 'bg-red-600 text-white shadow-red-600/30',
  lost: 'bg-amber-500 text-white shadow-amber-500/30',
}

/**
 * Notice shown when the update log is closed while the update is still running: it keeps
 * following the operation, turns green when it finishes (and hides after 3 s) or red on errors.
 */
export default function BackgroundUpdate({ opId, title, kind = 'update', onOpen, onDismiss, onFinished, onSelfUpdate }: Props) {
  const [state, setState] = useState<State>('running')
  const [detail, setDetail] = useState('')
  // Latest callbacks without re-subscribing (the parent re-renders every second)
  const cb = useRef({ onDismiss, onFinished, onSelfUpdate })
  useEffect(() => {
    cb.current = { onDismiss, onFinished, onSelfUpdate }
  }, [onDismiss, onFinished, onSelfUpdate])

  useEffect(() => {
    const es = new EventSource(`/api/operations/${opId}/stream`)
    let hide: ReturnType<typeof setTimeout> | undefined
    es.onmessage = (msg) => {
      const e = JSON.parse(msg.data) as { t: string; ok?: boolean; result?: OperationResult; error?: string }
      if (e.t !== 'done') return
      es.close()
      cb.current.onFinished()
      const failed = !e.ok || failedCount(e.result) > 0
      if (failed) {
        setState('failed')
        setDetail(e.error ?? (e.result && 'failed' in e.result ? e.result.failed.map((f) => f.name).join(', ') : ''))
        return
      }
      setState('ok')
      if (e.result && 'selfUpdate' in e.result && e.result.selfUpdate) cb.current.onSelfUpdate()
      hide = setTimeout(() => cb.current.onDismiss(), HIDE_AFTER_MS)
    }
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setState((s) => (s === 'running' ? 'lost' : s))
    }
    return () => {
      es.close()
      clearTimeout(hide)
    }
  }, [opId])

  const text = (
    kind === 'install'
      ? {
          running: 'Container installation running in the background',
          ok: 'Container installed',
          failed: 'Container installation failed',
          lost: 'Lost track of the installation (it keeps running on the server)',
        }
      : {
          running: 'Container update running in the background',
          ok: 'Container update finished',
          failed: 'Container update finished with errors',
          lost: 'Lost track of the update (it keeps running on the server)',
        }
  )[state]
  const Icon = state === 'ok' ? CircleCheck : state === 'failed' ? CircleAlert : Bomb
  // The log can be opened while it runs or after errors; a successful update is only a notice
  const canOpen = state !== 'ok'
  const content = (
    <>
      <Icon size={20} className={`shrink-0 ${state === 'running' ? 'animate-pulse' : ''}`} />
      <span className="min-w-0">
        <span className="block text-sm leading-tight font-semibold">{text}</span>
        <span className="block truncate text-xs opacity-90">
          {state === 'failed' && detail ? `${detail} · tap to see the log` : canOpen ? `${title} · tap to see the log` : title}
        </span>
      </span>
    </>
  )

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[72px] z-[60] flex justify-center px-4">
      <div
        role="status"
        className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl py-2.5 pr-2 pl-3.5 shadow-lg transition-colors duration-300 animate-[toast-in_.2s_ease-out] ${TONES[state]}`}
      >
        {canOpen ? (
          <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Show the log">
            {content}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg hover:bg-white/15"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
