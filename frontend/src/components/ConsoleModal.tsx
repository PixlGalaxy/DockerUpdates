import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { RotateCw, Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ContainerInfo } from '../types'
import Modal from './Modal'
import { Button } from './ui'

type Status = 'connecting' | 'connected' | 'closed' | 'error'

export default function ConsoleModal({ container, onClose }: { container: ContainerInfo; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [message, setMessage] = useState('')
  const [session, setSession] = useState(0)

  useEffect(() => {
    if (!host.current) return
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#0b0e14', foreground: '#e4e4e7', cursor: '#38bdf8', selectionBackground: '#38bdf855' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    fit.fit()
    term.focus()

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/containers/${container.id}/console`)
    ws.binaryType = 'arraybuffer'
    const send = (msg: object) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg))
    const sendSize = () => send({ type: 'resize', cols: term.cols, rows: term.rows })
    let opened = false
    let disposed = false
    // Errors are also written in the terminal: the subtitle is cut on small screens
    const showError = (text: string) => {
      setStatus('error')
      setMessage(text)
      term.writeln(`\r\n\x1b[31m${text}\x1b[0m`)
    }

    ws.onopen = () => {
      opened = true
      setStatus('connected')
      sendSize()
    }
    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data)
        if (msg.type === 'error') {
          showError(msg.message)
        } else if (msg.type === 'exit') {
          term.writeln('\r\n\x1b[90m[session ended]\x1b[0m')
        }
        return
      }
      term.write(new Uint8Array(e.data))
    }
    ws.onclose = (e) => {
      if (disposed) return // closed by us (modal closed / reconnect)
      // 4401 / 4403: refused by the server, which already sent the reason
      if (e.code === 4401 || e.code === 4403) return
      if (!opened) {
        // The WebSocket never reached DockerUpdates (or was dropped on the way)
        showError(
          'Could not open the console connection. If you open DockerUpdates through a reverse proxy, enable WebSocket support in it ' +
            '(Nginx Proxy Manager: "Websockets Support"; Cloudflare: Network > WebSockets). Details may be in Admin Panel > Server logs.',
        )
        return
      }
      setStatus((s) => (s === 'error' ? s : 'closed'))
      if (e.code === 1006) setMessage('Connection lost')
    }

    const input = term.onData((data) => send({ type: 'input', data }))
    const observer = new ResizeObserver(() => {
      fit.fit()
      sendSize()
    })
    observer.observe(host.current)

    return () => {
      disposed = true
      observer.disconnect()
      input.dispose()
      ws.close()
      term.dispose()
      setStatus('connecting')
      setMessage('')
    }
  }, [container.id, session])

  const label = {
    connecting: ['bg-amber-500', 'Connecting…'],
    connected: ['bg-emerald-500', 'Connected'],
    closed: ['bg-zinc-400', 'Session closed'],
    error: ['bg-red-500', message || 'Error'],
  }[status]

  return (
    <Modal
      title={`Console · ${container.name}`}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <span className={`size-1.5 rounded-full ${label[0]}`} />
          {label[1]}
          {status === 'closed' && message ? ` · ${message}` : ''}
        </span>
      }
      icon={<Terminal size={18} />}
      size="full"
      flush
      onClose={onClose}
      actions={
        status !== 'connected' && status !== 'connecting' ? (
          <Button size="xs" icon={<RotateCw size={13} />} onClick={() => setSession((s) => s + 1)}>
            Reconnect
          </Button>
        ) : null
      }
    >
      <div className="h-[78vh] bg-[#0b0e14] p-2">
        <div ref={host} className="size-full" />
      </div>
    </Modal>
  )
}
