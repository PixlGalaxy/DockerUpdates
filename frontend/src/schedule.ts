import type { Schedule } from './types'

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export const selectCls =
  'h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-sm shadow-xs focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40'

export const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`

/** Human summary, e.g. "Every Sunday at 4:00 AM" */
export function describeSchedule(s: Schedule): string {
  const time = `${s.hour % 12 === 0 ? 12 : s.hour % 12}:${String(s.minute).padStart(2, '0')} ${s.hour < 12 ? 'AM' : 'PM'}`
  switch (s.frequency) {
    case 'hourly':
      return `Every hour at :${String(s.minute).padStart(2, '0')}`
    case 'daily':
      return `Every day at ${time}`
    case 'weekly':
      return `Every ${DAYS[s.dayOfWeek]} at ${time}`
    case 'monthly':
      return `Day ${s.dayOfMonth} of every month at ${time}`
    default:
      return `Cron: ${s.cron || '—'}`
  }
}
