import { CalendarClock, CircleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { DAYS, describeSchedule, hourLabel, selectCls } from '../schedule'
import type { Frequency, Schedule } from '../types'
const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom (cron)' },
]


export default function ScheduleEditor({
  value,
  onChange,
  compact = false,
}: {
  value: Schedule
  onChange: (s: Schedule) => void
  compact?: boolean
}) {
  const [preview, setPreview] = useState<{ next: string[]; timezone: string } | null>(null)
  const [error, setError] = useState('')
  const set = (p: Partial<Schedule>) => onChange({ ...value, ...p })
  const f = value.frequency

  useEffect(() => {
    const t = setTimeout(() => {
      api.previewSchedule(value).then(
        (r) => {
          setPreview(r)
          setError('')
        },
        (e) => {
          setPreview(null)
          setError(e instanceof Error ? e.message : 'Invalid schedule')
        },
      )
    }, 350)
    return () => clearTimeout(t)
  }, [value])

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      timeZone: preview?.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${compact ? 'grid-cols-2 lg:grid-cols-5' : 'sm:grid-cols-2 lg:grid-cols-5'}`}>
        <Field label="Frequency">
          <select className={selectCls} value={f} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
            {FREQUENCIES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day of week">
          <select className={selectCls} disabled={f !== 'weekly'} value={value.dayOfWeek} onChange={(e) => set({ dayOfWeek: Number(e.target.value) })}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Day of month">
          <select className={selectCls} disabled={f !== 'monthly'} value={value.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })}>
            {Array.from({ length: 31 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Hour">
          <select className={selectCls} disabled={f === 'hourly' || f === 'custom'} value={value.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {hourLabel(h)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Minute">
          <select className={selectCls} disabled={f === 'custom'} value={value.minute} onChange={(e) => set({ minute: Number(e.target.value) })}>
            {Array.from({ length: 60 }, (_, m) => (
              <option key={m} value={m}>
                {String(m).padStart(2, '0')}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {f === 'custom' && (
        <Field label="Cron expression" hint="minute hour day-of-month month day-of-week">
          <input
            className={`${selectCls} font-mono`}
            value={value.cron}
            onChange={(e) => set({ cron: e.target.value })}
            placeholder="0 4 * * 1-5"
          />
        </Field>
      )}

      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <CircleAlert size={13} /> {error}
        </p>
      ) : (
        preview && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <CalendarClock size={13} className="text-sky-500" />
            <span className="font-medium text-fg/80">{describeSchedule(value)}</span>
            <span aria-hidden>·</span>
            <span>Next: {preview.next.map(fmt).join('  ·  ') || 'never'}</span>
            <span className="text-muted/70">({preview.timezone})</span>
          </p>
        )
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2 text-xs font-medium text-muted">
        {label}
        {hint && <span className="truncate font-normal">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
