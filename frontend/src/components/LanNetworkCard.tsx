import { CircleAlert, Lock, Network, Radar, TriangleAlert, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { selectCls } from '../schedule'
import type { LanDetection, LanStatus } from '../types'
import Card from './Card'
import type { ToastTone } from './Toasts'
import { Button } from './ui'

interface Props {
  toast: (tone: ToastTone, message: string) => void
  onError: (err: unknown) => void
}

/** Settings section to enable a macvlan / ipvlan network (dedicated LAN IPs). Permanent once enabled. */
export default function LanNetworkCard({ toast, onError }: Props) {
  const [status, setStatus] = useState<LanStatus | null>(null)
  const [form, setForm] = useState<(LanDetection & { ipRange: string }) | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [enabling, setEnabling] = useState(false)

  useEffect(() => {
    api.lanStatus().then(setStatus, onError)
  }, [onError])

  async function detect() {
    setDetecting(true)
    setDetectError('')
    try {
      const d = await api.detectLan()
      setForm({ ...d, ipRange: '' })
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  async function enable() {
    if (!form) return
    setEnabling(true)
    try {
      const s = await api.enableLan({
        name: form.name,
        driver: form.driver,
        parent: form.parent,
        subnet: form.subnet,
        gateway: form.gateway,
        ipRange: form.ipRange.trim() || undefined,
      })
      setStatus(s)
      setForm(null)
      toast('success', `Network "${s.network?.name}" created: containers can now get a dedicated IP`)
    } catch (err) {
      onError(err)
    } finally {
      setEnabling(false)
    }
  }

  const set = (p: Partial<LanDetection & { ipRange: string }>) => setForm((f) => (f ? { ...f, ...p } : f))

  return (
    <Card
      title="Network (macvlan)"
      description="Give containers their own IP address on your LAN, like br0 on Unraid."
      icon={<Network size={18} />}
      actions={
        status?.enabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            <Lock size={12} /> Enabled
          </span>
        ) : null
      }
    >
      {!status ? null : status.enabled && status.network ? (
        <div className="space-y-3">
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <Info label="Network" value={status.network.name} />
            <Info label="Driver" value={status.network.driver} />
            <Info label="Parent interface" value={status.network.parent ?? '—'} />
            <Info label="Subnet" value={status.network.subnet ?? '—'} />
            <Info label="Gateway" value={status.network.gateway ?? '—'} />
            <Info label="Containers using it" value={String(status.network.containers)} />
          </div>
          <p className="text-xs text-muted">
            In Add / Edit container choose the <b className="text-fg">{status.network.name}</b> network, type the IP in <b className="text-fg">Fixed IP</b> and press Check.
            This network cannot be disabled from DockerUpdates because containers depend on it.
          </p>
        </div>
      ) : status.missing ? (
        <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          The LAN network was enabled but no longer exists in Docker (it was removed outside DockerUpdates).
        </p>
      ) : status.dockerDesktop ? (
        <p className="flex items-start gap-2 text-sm text-muted">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          Not available on Docker Desktop (Windows / macOS): Docker runs inside a VM and macvlan cannot reach your LAN. It works when DockerUpdates runs on a Linux server.
        </p>
      ) : !form ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            DockerUpdates detects your server's network interface, subnet and gateway automatically. Nothing has to be run on the server.
          </p>
          <Button variant="primary" icon={<Radar size={14} />} loading={detecting} onClick={() => void detect()}>
            Detect network
          </Button>
          {detectError && (
            <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              {detectError}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">
            Detected: interface <b>{form.parent}</b>, server IP <b>{form.hostIp}</b>. Review and enable.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Network name">
              <input className={selectCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Driver">
              <select className={selectCls} value={form.driver} onChange={(e) => set({ driver: e.target.value as 'macvlan' | 'ipvlan' })}>
                <option value="macvlan">macvlan (wired, own MAC per container)</option>
                <option value="ipvlan">ipvlan (WiFi / VMs, shares the server MAC)</option>
              </select>
            </Field>
            <Field label="Parent interface">
              <input className={`${selectCls} font-mono`} value={form.parent} onChange={(e) => set({ parent: e.target.value })} />
            </Field>
            <Field label="Subnet">
              <input className={`${selectCls} font-mono`} value={form.subnet} onChange={(e) => set({ subnet: e.target.value })} />
            </Field>
            <Field label="Gateway (router)">
              <input className={`${selectCls} font-mono`} value={form.gateway} onChange={(e) => set({ gateway: e.target.value })} />
            </Field>
            <Field label="Auto-assign range (optional)">
              <input
                className={`${selectCls} font-mono`}
                value={form.ipRange}
                placeholder={form.subnet.replace(/\.\d+\/\d+$/, '.192/27')}
                onChange={(e) => set({ ipRange: e.target.value })}
              />
            </Field>
          </div>

          {form.wifi && (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
              <Wifi size={14} className="mt-0.5 shrink-0" /> WiFi interface detected: ipvlan is selected because access points usually reject extra MAC addresses.
            </p>
          )}
          <ul className="space-y-1.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted">
            <li className="flex gap-2">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />
              Use IPs outside your router's DHCP range (or reserve them in the router) so no other device takes them.
            </li>
            <li className="flex gap-2">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />
              The server itself cannot reach containers on this network (normal macvlan behaviour). Other devices on the LAN can.
            </li>
            <li className="flex gap-2">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber-500" />
              If the server is a virtual machine, allow promiscuous mode / MAC spoofing in the hypervisor, or choose ipvlan.
            </li>
          </ul>

          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-sky-600" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
            <span>
              I understand that once enabled, this network <b>cannot be disabled</b> from DockerUpdates.
            </span>
          </label>

          <div className="flex gap-2">
            <Button onClick={() => setForm(null)}>Cancel</Button>
            <Button variant="primary" icon={<Lock size={14} />} loading={enabling} disabled={!confirm} onClick={() => void enable()}>
              Enable macvlan
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="truncate font-mono text-sm font-medium">{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}
