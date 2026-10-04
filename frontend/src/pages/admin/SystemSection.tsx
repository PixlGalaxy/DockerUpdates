import { CircleAlert, CircleCheck, Container, HardDrive, Server } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import type { SystemInfo } from '../../adminTypes'
import { adminApi } from '../../api'
import { Meter } from '../../components/ui'
import { formatBytes } from '../../utils'
import { Loading, Panel, type SectionProps } from './shared'
import { formatDate, formatDuration, usePolling } from './format'

function Field({ label, children, mono, title }: { label: string; children: ReactNode; mono?: boolean; title?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`truncate text-sm font-medium ${mono ? 'font-mono text-[13px]' : ''}`} title={title ?? (typeof children === 'string' ? children : undefined)}>
        {children}
      </dd>
    </div>
  )
}

export default function SystemSection({ onError }: SectionProps) {
  const [data, setData] = useState<SystemInfo | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await adminApi.system())
    } catch (err) {
      onError(err)
    }
  }, [onError])
  usePolling(load, 5000)

  if (!data) return <Loading />
  const { app, self, docker, data: store } = data
  const diskPct = store.disk ? (store.disk.usedBytes / store.disk.totalBytes) * 100 : 0

  return (
    <div className="space-y-5">
      <Panel title="DockerUpdates" icon={<Server size={18} />} description="The app and the image it runs from.">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <Field label="App version" mono>{app.version}</Field>
          <Field label="Node.js">{app.node}</Field>
          <Field label="Platform">{`${app.platform} / ${app.arch}`}</Field>
          <Field label="Uptime" title={`Started ${formatDate(app.startedAt)}`}>{formatDuration(app.uptimeSeconds)}</Field>
          <Field label="Memory used">{`${formatBytes(app.rssBytes)} (heap ${formatBytes(app.heapUsedBytes)})`}</Field>
          <Field label="Runs in a container">{app.containerized ? 'Yes' : 'No'}</Field>
          {self && (
            <>
              <Field label="Image" mono>{self.image}</Field>
              <Field label="Image ID" mono>{self.imageId}</Field>
              <Field label="Container" mono title={self.id}>{self.container}</Field>
              <Field label="Restart policy">{self.restartPolicy}</Field>
              <Field label="Container created">{formatDate(self.created)}</Field>
              <Field label="no-new-privileges">
                <span className={`inline-flex items-center gap-1.5 ${self.noNewPrivileges ? '' : 'text-amber-600 dark:text-amber-400'}`}>
                  {self.noNewPrivileges ? <CircleCheck size={14} className="text-emerald-500" /> : <CircleAlert size={14} />}
                  {self.noNewPrivileges ? 'Enabled' : 'Not set (recommended)'}
                </span>
              </Field>
            </>
          )}
        </dl>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Docker engine" icon={<Container size={18} />} description={docker ? docker.name : 'The Docker daemon did not answer.'}>
          {docker ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              <Field label="Docker version">{docker.serverVersion}</Field>
              <Field label="API version">{docker.apiVersion ?? '—'}</Field>
              <Field label="Operating system">{docker.os}</Field>
              <Field label="Kernel" mono>{docker.kernel}</Field>
              <Field label="CPUs / memory">{`${docker.cpus} / ${formatBytes(docker.memTotal)}`}</Field>
              <Field label="Architecture">{docker.arch}</Field>
              <Field label="Containers">{`${docker.containers.running} running, ${docker.containers.stopped} stopped${docker.containers.paused ? `, ${docker.containers.paused} paused` : ''}`}</Field>
              <Field label="Images">{String(docker.images)}</Field>
              <Field label="Storage / logging driver">{`${docker.storageDriver} / ${docker.loggingDriver}`}</Field>
              <Field label="Docker root" mono>{docker.rootDir}</Field>
            </dl>
          ) : (
            <p className="text-sm text-muted">Check that the Docker socket is mounted.</p>
          )}
        </Panel>

        <Panel title="Data volume" icon={<HardDrive size={18} />} description={<span className="font-mono">{store.path}</span>}>
          {store.disk && (
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium">Disk</span>
                <span className="text-muted tabular-nums">
                  {formatBytes(store.disk.usedBytes)} / {formatBytes(store.disk.totalBytes)}
                </span>
              </div>
              <Meter value={diskPct} tone="mem" />
            </div>
          )}
          {store.parts.length === 0 ? (
            <p className="text-sm text-muted">Nothing stored yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-line">
                {store.parts.map((p) => (
                  <tr key={p.name}>
                    <td className="py-1.5 pr-4 font-mono text-xs">{p.name}</td>
                    <td className="py-1.5 pr-4 text-xs text-muted">{p.files > 1 ? `${p.files} files` : ''}</td>
                    <td className="py-1.5 text-right text-xs tabular-nums">{formatBytes(p.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  )
}
