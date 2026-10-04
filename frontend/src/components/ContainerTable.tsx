import type { ContainerInfo } from '../types'
import ContainerRow, { ContainerCard } from './ContainerRow'
import Logo from './Logo'

interface Props {
  containers: ContainerInfo[]
  hostIp: string
  advanced: boolean
  loading: boolean
  busyIds: Set<string>
  emptyMessage: string
  onMenu: (container: ContainerInfo, x: number, y: number) => void
  onAutostart: (id: string, enabled: boolean) => void
  onCheckUpdate: (id: string) => void
  onUpdate: (id: string) => void
  onCopy: (text: string) => void
}

export default function ContainerTable({
  containers,
  hostIp,
  advanced,
  loading,
  busyIds,
  emptyMessage,
  ...handlers
}: Props) {
  const heads = [
    'Application',
    'Version',
    ...(advanced ? ['Network', 'IP / MAC'] : []),
    'Container port',
    'LAN IP:Port',
    ...(advanced ? ['Volume mappings (host → container)'] : []),
    'CPU & Memory',
    'Autostart',
    'Uptime',
  ]

  return (
    <>
      {/* Phones: one card per container */}
      <div className="space-y-3 md:hidden">
        {loading &&
          Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex animate-pulse items-center gap-3">
                <div className="size-10 rounded-xl bg-surface-2" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-surface-2" />
                  <div className="h-2.5 w-48 rounded bg-surface-2" />
                </div>
              </div>
            </div>
          ))}

        {!loading &&
          containers.map((c) => (
            <ContainerCard
              key={c.id}
              container={c}
              hostIp={hostIp}
              advanced={advanced}
              busy={busyIds.has(c.id)}
              onMenu={(x, y) => handlers.onMenu(c, x, y)}
              onAutostart={(e) => handlers.onAutostart(c.id, e)}
              onCheckUpdate={() => handlers.onCheckUpdate(c.id)}
              onUpdate={() => handlers.onUpdate(c.id)}
              onCopy={handlers.onCopy}
            />
          ))}

        {!loading && containers.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface px-4 py-16 text-center shadow-sm">
            <Logo size={56} className="mx-auto block w-fit opacity-40 grayscale" />
            <p className="mt-3 text-sm font-medium">{emptyMessage}</p>
          </div>
        )}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-2/70">
                {heads.map((h, i) => (
                  <th
                    key={h || i}
                    className="px-3 py-2.5 text-[11px] leading-tight font-semibold tracking-wider text-muted uppercase"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }, (_, i) => (
                  <tr key={i} className="border-t border-line">
                    <td colSpan={heads.length} className="px-4 py-4">
                      <div className="flex animate-pulse items-center gap-3">
                        <div className="size-10 rounded-xl bg-surface-2" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3 w-40 rounded bg-surface-2" />
                          <div className="h-2.5 w-64 rounded bg-surface-2" />
                        </div>
                        <div className="h-3 w-24 rounded bg-surface-2" />
                      </div>
                    </td>
                  </tr>
                ))}

              {!loading &&
                containers.map((c) => (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    hostIp={hostIp}
                    advanced={advanced}
                    busy={busyIds.has(c.id)}
                    onMenu={(x, y) => handlers.onMenu(c, x, y)}
                    onAutostart={(e) => handlers.onAutostart(c.id, e)}
                    onCheckUpdate={() => handlers.onCheckUpdate(c.id)}
                    onUpdate={() => handlers.onUpdate(c.id)}
                    onCopy={handlers.onCopy}
                  />
                ))}

              {!loading && containers.length === 0 && (
                <tr>
                  <td colSpan={heads.length} className="px-4 py-16 text-center">
                    <Logo size={56} className="mx-auto block w-fit opacity-40 grayscale" />
                    <p className="mt-3 text-sm font-medium">{emptyMessage}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
