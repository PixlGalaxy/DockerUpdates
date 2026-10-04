import { CircleAlert, CircleCheck, Save, ShieldCheck, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SecurityInfo, SecurityValues } from '../adminTypes'
import { adminApi } from '../api'
import { selectCls } from '../schedule'
import Card, { SettingRow } from './Card'
import type { ToastTone } from './Toasts'
import { Button } from './ui'

const FIELDS: { key: keyof SecurityValues; label: string; description: string; unit: string }[] = [
  { key: 'sessionHours', label: 'Session lifetime', description: 'You must sign in again after this long, even when active.', unit: 'hours' },
  { key: 'idleMinutes', label: 'Idle timeout', description: 'Sign out after this long without any activity.', unit: 'minutes' },
  { key: 'ipMaxFailures', label: 'Failed logins per IP', description: 'Failed attempts from one address before it is locked out.', unit: 'attempts' },
  { key: 'globalMaxFailures', label: 'Failed logins in total', description: 'Failed attempts from all addresses before login is locked for everyone (stops IP rotation).', unit: 'attempts' },
  { key: 'lockoutMinutes', label: 'Lockout window', description: 'Failures are counted over this window, and a lockout lasts this long.', unit: 'minutes' },
]

/** Login and session limits (Settings page). Saved on its own, separately from the other settings. */
export default function SecurityCard({ toast, onError }: { toast: (tone: ToastTone, message: string) => void; onError: (err: unknown) => void }) {
  const [info, setInfo] = useState<SecurityInfo | null>(null)
  const [draft, setDraft] = useState<SecurityValues | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    adminApi.security().then((i) => {
      setInfo(i)
      setDraft(i.values)
    }, onError)
  }, [onError])

  if (!info || !draft) return null

  const dirty = FIELDS.some(({ key }) => draft[key] !== info.values[key])
  const st = info.status
  const checks: { ok: boolean; text: string }[] = [
    { ok: Boolean(st.trustProxy), text: st.trustProxy ? `TRUST_PROXY is set (${st.trustProxy})` : 'TRUST_PROXY is not set: every private-network host may send X-Forwarded-For' },
    {
      ok: st.cookieSecureForced || st.connectionSecure,
      text: st.cookieSecureForced ? 'COOKIE_SECURE=true: the session cookie is HTTPS-only' : st.connectionSecure ? 'This connection uses HTTPS' : 'Plain HTTP: set COOKIE_SECURE=true once you only use HTTPS',
    },
    { ok: st.sessionSecretSet, text: st.sessionSecretSet ? 'SESSION_SECRET is set' : 'SESSION_SECRET is not set: sessions reset on every restart' },
    { ok: st.passwordLength >= 16, text: st.passwordLength >= 16 ? 'ADMIN_PASSWORD has 16+ characters' : `ADMIN_PASSWORD has ${st.passwordLength} characters (16+ recommended)` },
  ]

  async function save() {
    setSaving(true)
    try {
      const next = await adminApi.saveSecurity(draft!)
      setInfo(next)
      setDraft(next.values)
      toast('success', 'Login and session limits saved')
    } catch (err) {
      onError(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title="Login & sessions"
      description="How long sessions last and when repeated failed logins are locked out. Lockouts can be lifted in Admin Panel → IP access."
      icon={<ShieldCheck size={18} />}
      actions={
        dirty && (
          <>
            <Button size="xs" icon={<Undo2 size={12} />} onClick={() => setDraft(info.values)} disabled={saving}>
              Discard
            </Button>
            <Button size="xs" variant="primary" icon={<Save size={12} />} loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </>
        )
      }
    >
      {FIELDS.map(({ key, label, description, unit }) => {
        const { min, max } = info.limits[key]
        return (
          <SettingRow key={key} label={label} description={`${description} Default ${info.defaults[key]}, range ${min} to ${max}.`}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={min}
                max={max}
                value={draft[key]}
                onChange={(e) => setDraft({ ...draft, [key]: Number(e.target.value) })}
                className={`${selectCls} w-24`}
              />
              <span className="w-16 text-xs text-muted">{unit}</span>
            </div>
          </SettingRow>
        )
      })}

      <div className="rounded-xl border border-line bg-surface-2/40 p-4">
        <p className="mb-2 text-xs font-medium text-muted">Set in the .env file (read-only here)</p>
        <ul className="space-y-1.5 text-sm">
          {checks.map((c) => (
            <li key={c.text} className="flex items-start gap-2">
              {c.ok ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-emerald-500" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-amber-500" />}
              <span className={c.ok ? '' : 'text-amber-700 dark:text-amber-300'}>{c.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
