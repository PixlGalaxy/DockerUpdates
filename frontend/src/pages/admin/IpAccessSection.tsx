import { Ban, ShieldAlert, ShieldBan, ShieldOff, TriangleAlert, Unlock } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { IpAccessInfo, LockoutRow } from '../../adminTypes'
import { adminApi } from '../../api'
import { Button } from '../../components/ui'
import { selectCls } from '../../schedule'
import { timeAgo } from '../../utils'
import { ConfirmButton, Empty, Loading, Panel, type SectionProps } from './shared'
import { formatDate, formatDuration, formatIp, tdCls, thCls, usePolling } from './format'

export default function IpAccessSection({ toast, onError }: SectionProps) {
  const [data, setData] = useState<IpAccessInfo | null>(null)
  const [ip, setIp] = useState('')
  const [reason, setReason] = useState('')
  const [banning, setBanning] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await adminApi.ipAccess())
    } catch (err) {
      onError(err)
    }
  }, [onError])
  usePolling(load, 3000)

  async function unlock(key: string, label: string) {
    try {
      await adminApi.unlock(key)
      toast('success', `Lockout lifted for ${label}`)
      await load()
    } catch (err) {
      onError(err)
    }
  }

  async function ban(value: string, why?: string) {
    setBanning(true)
    try {
      const r = await adminApi.ban(value, why)
      toast('success', `${r.ip} is banned`)
      setIp('')
      setReason('')
      await load()
    } catch (err) {
      onError(err)
    } finally {
      setBanning(false)
    }
  }

  if (!data) return <Loading />

  const lockRow = (row: LockoutRow, locked: boolean) => (
    <tr key={row.key}>
      <td className={`${tdCls} font-mono text-xs`}>
        {formatIp(row.ip)}
        {row.viaConnection && (
          <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] text-muted" title="Counted by the address that opened the connection, because TRUST_PROXY is not set">
            connection
          </span>
        )}
      </td>
      <td className={`${tdCls} tabular-nums`}>
        {row.recentFailures} <span className="text-muted">/ {row.totalFailures} total</span>
      </td>
      <td className={`${tdCls} text-muted`}>{locked ? formatDuration(row.retryAfterSeconds) : `${data.limits.ipMaxFailures - row.recentFailures} attempt(s) left`}</td>
      <td className={`${tdCls} pr-0 text-right`}>
        <div className="inline-flex flex-wrap justify-end gap-2">
          <ConfirmButton
            label={locked ? 'Unlock' : 'Reset'}
            confirm={locked ? 'Allow logins again?' : 'Reset the counter?'}
            icon={<Unlock size={13} />}
            onConfirm={() => unlock(row.key, formatIp(row.ip))}
          />
          {formatIp(row.ip) !== formatIp(data.yourIp) && !data.banned.some((b) => b.ip === formatIp(row.ip)) && (
            <ConfirmButton
              label="Ban"
              confirm={`Ban ${formatIp(row.ip)}?`}
              icon={<Ban size={13} />}
              variant="danger"
              onConfirm={() => ban(formatIp(row.ip), `Failed logins (${row.totalFailures})`)}
            />
          )}
        </div>
      </td>
    </tr>
  )

  return (
    <div className="space-y-5">
      {!data.proxyPinned && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            TRUST_PROXY is not set, so failed logins are also counted per connection. Behind a reverse proxy, everyone using it shares that counter. Set
            TRUST_PROXY to the proxy IP in the .env file.
          </span>
        </div>
      )}

      <Panel
        title="Locked out"
        icon={<ShieldAlert size={18} />}
        description={`An address is locked for ${data.limits.lockoutMinutes} min after ${data.limits.ipMaxFailures} failed logins within ${data.limits.lockoutMinutes} min. Change these limits in Settings.`}
      >
        {data.global.retryAfterSeconds > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <span>
              Login is locked for everyone for {formatDuration(data.global.retryAfterSeconds)} after {data.limits.globalMaxFailures} failed attempts from all addresses.
            </span>
            <ConfirmButton label="Unlock" confirm="Allow logins again?" icon={<Unlock size={13} />} onConfirm={() => unlock('global', 'everyone')} />
          </div>
        )}
        {data.locked.length === 0 && data.watching.length === 0 ? (
          <Empty>No address is locked out and nobody failed to log in recently.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>IP</th>
                  <th className={thCls}>Recent failures</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.locked.map((r) => lockRow(r, true))}
                {data.watching.map((r) => lockRow(r, false))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-muted">
          {data.global.recentFailures} failed login(s) from all addresses in the last {data.limits.lockoutMinutes} min. Login locks for everyone at{' '}
          {data.limits.globalMaxFailures}.
        </p>
      </Panel>

      <Panel
        title="Banned IPs"
        icon={<ShieldBan size={18} />}
        description="Banned addresses get no answer at all from DockerUpdates, not even the login page. Bans are saved in the data volume."
      >
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            if (ip.trim()) void ban(ip.trim(), reason.trim() || undefined)
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">IP address or range</span>
            <input className={`${selectCls} font-mono text-xs`} value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7 or 203.0.113.0/24" spellCheck={false} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Reason (optional)</span>
            <input className={selectCls} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. brute force" />
          </label>
          <Button type="submit" variant="danger" size="md" icon={<Ban size={14} />} loading={banning} disabled={!ip.trim()}>
            Ban
          </Button>
        </form>
        <p className="text-xs text-muted">
          Your IP is <span className="font-mono">{formatIp(data.yourIp)}</span>. You cannot ban it, loopback, or your reverse proxy.
        </p>

        {data.banned.length === 0 ? (
          <Empty>No banned addresses.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>IP</th>
                  <th className={thCls}>Reason</th>
                  <th className={thCls}>Added by</th>
                  <th className={thCls}>Added</th>
                  <th className={thCls} />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.banned.map((b) => (
                  <tr key={b.ip}>
                    <td className={`${tdCls} font-mono text-xs`}>{b.ip}</td>
                    <td className={tdCls}>{b.reason ?? <span className="text-muted">—</span>}</td>
                    <td className={`${tdCls} text-muted`}>{b.createdBy ?? '—'}</td>
                    <td className={`${tdCls} text-muted`} title={formatDate(b.createdAt)}>
                      {timeAgo(b.createdAt)} ago
                    </td>
                    <td className={`${tdCls} pr-0 text-right`}>
                      <ConfirmButton
                        label="Remove"
                        confirm={`Unban ${b.ip}?`}
                        icon={<ShieldOff size={13} />}
                        onConfirm={async () => {
                          try {
                            await adminApi.unban(b.ip)
                            toast('success', `${b.ip} is no longer banned`)
                            await load()
                          } catch (err) {
                            onError(err)
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
