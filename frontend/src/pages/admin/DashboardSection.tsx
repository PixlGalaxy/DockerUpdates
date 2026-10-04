import { KeyRound, LogOut, Monitor, ShieldAlert, ShieldBan, TriangleAlert, Users } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { AdminOverview } from '../../adminTypes'
import { adminApi } from '../../api'
import { timeAgo } from '../../utils'
import type { Section } from './AdminPage'
import { ConfirmButton, Empty, Loading, Panel, StatTile, type SectionProps } from './shared'
import { describeAgent, formatDate, formatIp, tdCls, thCls, usePolling } from './format'

export default function DashboardSection({ toast, onError, onOpen }: SectionProps & { onOpen: (s: Section) => void }) {
  const [data, setData] = useState<AdminOverview | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await adminApi.overview())
    } catch (err) {
      onError(err)
    }
  }, [onError])
  usePolling(load, 3000)

  if (!data) return <Loading />

  const others = data.sessions.filter((s) => !s.current).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={<Users size={18} />} tone="text-violet-500 bg-violet-500/10" value={data.sessions.length} label="Active sessions" />
        <StatTile
          icon={<KeyRound size={18} />}
          tone={data.failedLogins ? 'text-amber-500 bg-amber-500/10' : 'text-emerald-500 bg-emerald-500/10'}
          value={data.failedLogins}
          label={`Failed logins (last ${data.lockoutMinutes} min)`}
          highlight={data.failedLogins > 0}
        />
        <StatTile
          icon={<ShieldAlert size={18} />}
          tone={data.lockedCount || data.globalLocked ? 'text-red-500 bg-red-500/10' : 'text-sky-500 bg-sky-500/10'}
          value={data.globalLocked ? 'All' : data.lockedCount}
          label="Locked out"
          hint={data.globalLocked ? 'Login is locked for everyone after too many failures' : 'Open IP access'}
          onClick={() => onOpen('ip-access')}
          highlight={data.lockedCount > 0 || data.globalLocked > 0}
        />
        <StatTile
          icon={<ShieldBan size={18} />}
          tone="text-zinc-500 bg-zinc-500/10"
          value={data.bannedCount}
          label="Banned IPs"
          hint="Open IP access"
          onClick={() => onOpen('ip-access')}
        />
      </div>

      {(data.logLevels.ERROR > 0 || data.logLevels.WARN > 0) && (
        <button
          type="button"
          onClick={() => onOpen('logs')}
          className="flex w-full items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-left text-sm text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
        >
          <TriangleAlert size={16} className="shrink-0" />
          {data.logLevels.ERROR} error(s) and {data.logLevels.WARN} warning(s) were logged in the last hour. Open the server logs.
        </button>
      )}

      <Panel
        title="Active sessions"
        icon={<Monitor size={18} />}
        description="Browsers signed in to DockerUpdates. Sign out any session you do not recognise."
        actions={
          others > 0 && (
            <ConfirmButton
              label="Sign out others"
              confirm={`Sign out ${others} session(s)?`}
              icon={<LogOut size={13} />}
              variant="danger"
              onConfirm={async () => {
                try {
                  const r = await adminApi.revokeOtherSessions()
                  toast('success', `${r.revoked} session(s) signed out`)
                  await load()
                } catch (err) {
                  onError(err)
                }
              }}
            />
          )
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th className={thCls}>IP</th>
                <th className={thCls}>Device</th>
                <th className={thCls}>User</th>
                <th className={thCls}>Signed in</th>
                <th className={thCls}>Last activity</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className={`${tdCls} font-mono text-xs`}>
                    {formatIp(s.lastIp)}
                    {s.ip && s.lastIp && s.ip !== s.lastIp && (
                      <span className="ml-1.5 text-muted" title="IP used to sign in">
                        (from {formatIp(s.ip)})
                      </span>
                    )}
                  </td>
                  <td className={tdCls} title={s.agent}>
                    {describeAgent(s.agent)}
                    {s.current && (
                      <span className="ml-2 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        This browser
                      </span>
                    )}
                  </td>
                  <td className={tdCls}>{s.user}</td>
                  <td className={`${tdCls} text-muted`} title={formatDate(s.created)}>
                    {timeAgo(s.created)} ago
                  </td>
                  <td className={`${tdCls} text-muted`} title={`Expires ${formatDate(s.expires)}`}>
                    {s.current ? 'Now' : `${timeAgo(s.lastSeen)} ago`}
                  </td>
                  <td className={`${tdCls} pr-0 text-right`}>
                    {!s.current && (
                      <ConfirmButton
                        label="Sign out"
                        confirm="Sign out this session?"
                        icon={<LogOut size={13} />}
                        onConfirm={async () => {
                          try {
                            await adminApi.revokeSession(s.id)
                            toast('success', 'Session signed out')
                            await load()
                          } catch (err) {
                            onError(err)
                          }
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Recent failed logins"
        icon={<KeyRound size={18} />}
        description="Kept in memory since the last restart."
      >
        {data.recentFailures.length === 0 ? (
          <Empty>No failed logins since the server started.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className={thCls}>IP</th>
                  <th className={thCls}>Username tried</th>
                  <th className={thCls}>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.recentFailures.map((f, i) => (
                  <tr key={`${f.at}-${i}`}>
                    <td className={`${tdCls} font-mono text-xs`}>
                      {formatIp(f.ip)}
                      {f.peer && formatIp(f.peer) !== formatIp(f.ip) && <span className="ml-1.5 text-muted">via {formatIp(f.peer)}</span>}
                    </td>
                    <td className={`${tdCls} font-mono text-xs`}>{f.username || '—'}</td>
                    <td className={`${tdCls} text-muted`} title={formatDate(f.at)}>
                      {timeAgo(f.at)} ago
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-xs text-muted">
        Your IP: <span className="font-mono">{formatIp(data.yourIp)}</span> · Server started {timeAgo(data.startedAt)} ago
      </p>
    </div>
  )
}
