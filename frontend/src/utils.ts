import type { ContainerInfo, OperationResult } from './types'

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** i
  return `${value >= 100 || i === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`
}

export function timeAgo(iso?: string): string {
  if (!iso) return '-'
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  const steps: [number, string][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [30, 'day'],
    [12, 'month'],
    [Infinity, 'year'],
  ]
  let value = seconds
  for (const [size, unit] of steps) {
    if (value < size) {
      const n = Math.floor(value)
      return `${n} ${unit}${n === 1 ? '' : 's'}`
    }
    value /= size
  }
  return '-'
}

export function isActive(c: ContainerInfo): boolean {
  return c.state === 'running' || c.state === 'paused' || c.state === 'restarting'
}

/** "ghcr.io/owner/app:tag" -> { repo: "ghcr.io/owner/app", tag: "tag" } */
export function splitImage(image: string): { repo: string; tag: string } {
  const at = image.indexOf('@')
  if (at !== -1) return { repo: image.slice(0, at), tag: 'digest' }
  const lastSlash = image.lastIndexOf('/')
  const colon = image.lastIndexOf(':')
  return colon > lastSlash
    ? { repo: image.slice(0, colon), tag: image.slice(colon + 1) }
    : { repo: image, tag: 'latest' }
}

const GRADIENTS = [
  'from-sky-500 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
  'from-fuchsia-500 to-violet-600',
  'from-lime-500 to-green-600',
]

/** Stable gradient per container name, used for the avatar tile. */
export function gradientFor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length]
}

/** Containers that failed in an operation result (an install has none: it fails as a whole) */
export function failedCount(r?: OperationResult): number {
  return r && 'failed' in r ? r.failed.length : 0
}

/**
 * Look of a container / folder while another container is held over it to make a folder
 * (the drag code sets data-merge: "hover" right away, "ready" after the hold time).
 */
export const MERGE_TARGET =
  'data-[merge=hover]:bg-sky-500/5 data-[merge=ready]:bg-sky-500/10 data-[merge=ready]:outline-2 data-[merge=ready]:-outline-offset-2 data-[merge=ready]:outline-sky-500'
