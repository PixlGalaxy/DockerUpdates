// Colors of compose stacks in the container list. Full class names (not built from parts) so
// Tailwind finds them. Ids match backend/stackColors.js.

export interface StackColor {
  id: string
  label: string
  /** Picker swatch */
  swatch: string
  /** Stack icon */
  icon: string
  /** Header row / card background */
  header: string
  /** Rows of its services */
  row: string
  /** Line left of its services */
  line: string
  /** Card border and service list border */
  border: string
}

export const STACK_COLORS: StackColor[] = [
  { id: 'violet', label: 'Violet', swatch: 'bg-violet-500', icon: 'bg-violet-500/15 text-violet-600 dark:text-violet-300', header: 'bg-violet-500/[0.06]', row: 'bg-violet-500/[0.025]', line: 'bg-violet-500/40', border: 'border-violet-500/40' },
  { id: 'sky', label: 'Sky', swatch: 'bg-sky-500', icon: 'bg-sky-500/15 text-sky-600 dark:text-sky-300', header: 'bg-sky-500/[0.06]', row: 'bg-sky-500/[0.025]', line: 'bg-sky-500/40', border: 'border-sky-500/40' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500', icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', header: 'bg-emerald-500/[0.06]', row: 'bg-emerald-500/[0.025]', line: 'bg-emerald-500/40', border: 'border-emerald-500/40' },
  { id: 'amber', label: 'Amber', swatch: 'bg-amber-500', icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', header: 'bg-amber-500/[0.07]', row: 'bg-amber-500/[0.03]', line: 'bg-amber-500/50', border: 'border-amber-500/40' },
  { id: 'rose', label: 'Rose', swatch: 'bg-rose-500', icon: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', header: 'bg-rose-500/[0.06]', row: 'bg-rose-500/[0.025]', line: 'bg-rose-500/40', border: 'border-rose-500/40' },
  { id: 'indigo', label: 'Indigo', swatch: 'bg-indigo-500', icon: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300', header: 'bg-indigo-500/[0.06]', row: 'bg-indigo-500/[0.025]', line: 'bg-indigo-500/40', border: 'border-indigo-500/40' },
  { id: 'teal', label: 'Teal', swatch: 'bg-teal-500', icon: 'bg-teal-500/15 text-teal-600 dark:text-teal-300', header: 'bg-teal-500/[0.06]', row: 'bg-teal-500/[0.025]', line: 'bg-teal-500/40', border: 'border-teal-500/40' },
  { id: 'orange', label: 'Orange', swatch: 'bg-orange-500', icon: 'bg-orange-500/15 text-orange-600 dark:text-orange-300', header: 'bg-orange-500/[0.06]', row: 'bg-orange-500/[0.025]', line: 'bg-orange-500/40', border: 'border-orange-500/40' },
  { id: 'fuchsia', label: 'Fuchsia', swatch: 'bg-fuchsia-500', icon: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-300', header: 'bg-fuchsia-500/[0.06]', row: 'bg-fuchsia-500/[0.025]', line: 'bg-fuchsia-500/40', border: 'border-fuchsia-500/40' },
  { id: 'lime', label: 'Lime', swatch: 'bg-lime-500', icon: 'bg-lime-500/20 text-lime-700 dark:text-lime-300', header: 'bg-lime-500/[0.07]', row: 'bg-lime-500/[0.03]', line: 'bg-lime-500/50', border: 'border-lime-500/40' },
]

/**
 * Color of a stack: the one chosen in the picker, else one picked from its name (looks random,
 * but stays the same on every load and device).
 */
export function stackColor(name: string, chosen?: string): StackColor {
  const picked = STACK_COLORS.find((c) => c.id === chosen)
  if (picked) return picked
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return STACK_COLORS[hash % STACK_COLORS.length]
}
