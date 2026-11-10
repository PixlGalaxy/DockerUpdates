import { LoaderCircle, ShieldAlert, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { MCP_LEVELS } from '../mcpLevels'
import type { McpAuthorizeInfo } from '../types'
import Logo from './Logo'
import { Button } from './ui'

/**
 * /oauth/authorize: an AI app (Claude, ChatGPT...) asks for access to the MCP endpoint.
 * Shown after signing in; approving sends the browser back to the app with a one-time code.
 */
export default function McpConsent() {
  const query = useMemo(() => Object.fromEntries(new URLSearchParams(window.location.search)), [])
  const [info, setInfo] = useState<McpAuthorizeInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)

  useEffect(() => {
    api.mcpAuthorizeInfo(window.location.search).then(setInfo, (err: unknown) => setError(err instanceof Error ? err.message : 'Invalid request'))
  }, [])

  async function decide(approve: boolean) {
    setBusy(approve ? 'approve' : 'deny')
    try {
      const { redirect } = await api.mcpAuthorize(query, approve)
      window.location.href = redirect
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(null)
    }
  }

  const level = MCP_LEVELS.find((l) => l.value === info?.level)

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 shadow-xl shadow-black/5">
        <Logo size={56} className="mx-auto block w-fit" />
        {error ? (
          <>
            <h1 className="mt-4 text-center text-lg font-semibold">Cannot connect this app</h1>
            <p className="mt-2 text-center text-sm text-muted">{error}</p>
            <a href="/" className="mt-6 block text-center text-sm text-sky-600 hover:underline dark:text-sky-400">
              Back to DockerUpdates
            </a>
          </>
        ) : !info ? (
          <div className="mt-8 flex justify-center text-muted">
            <LoaderCircle className="animate-spin" />
          </div>
        ) : (
          <>
            <h1 className="mt-4 text-center text-lg font-semibold">
              <span className="text-sky-600 dark:text-sky-400">{info.clientName}</span> wants to access DockerUpdates
            </h1>
            <p className="mt-2 text-center text-sm text-muted">
              After approving you go back to <span className="font-mono font-medium text-fg">{info.redirectHost}</span>. Only approve if you just connected it yourself.
            </p>
            <div className={`mt-5 flex gap-3 rounded-xl border p-3 text-sm ${info.level === 'full' ? 'border-amber-500/40 bg-amber-500/5' : 'border-line bg-surface-2'}`}>
              {info.level === 'full' ? (
                <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-500" />
              ) : (
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-emerald-500" />
              )}
              <div>
                <div className="font-medium">{level?.label}</div>
                <div className="text-xs text-muted">{level?.description}</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted">The access level can be changed any time in Settings → AI assistants, and the app disconnected there.</p>
            <div className="mt-6 flex gap-2">
              <Button className="flex-1" size="md" loading={busy === 'deny'} disabled={!!busy} onClick={() => void decide(false)}>
                Deny
              </Button>
              <Button className="flex-1" size="md" variant="primary" loading={busy === 'approve'} disabled={!!busy} onClick={() => void decide(true)}>
                Approve
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
