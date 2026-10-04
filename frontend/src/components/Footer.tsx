import { useEffect, useState } from 'react'
import { api } from '../api'

const link = 'font-medium text-fg/80 transition-colors hover:text-sky-600 dark:hover:text-sky-400'

export default function Footer() {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    api.version().then(
      (r) => setVersion(r.version),
      () => setVersion('unknown'),
    )
  }, [])

  return (
    <footer className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-6 text-xs text-muted sm:px-6">
      <span className="font-semibold text-fg/80">DockerUpdates</span>
      <span aria-hidden>|</span>
      <span>
        Ver: <span className="font-mono">{version ?? '…'}</span>
      </span>
      <span aria-hidden>|</span>
      <span>
        Developed By{' '}
        <a href="https://github.com/PixlGalaxy" target="_blank" rel="noreferrer" className={link}>
          PixlGalaxy
        </a>
      </span>
      <span aria-hidden>|</span>
      <a href="https://github.com/PixlGalaxy/DockerUpdates" target="_blank" rel="noreferrer" className={link}>
        Source Code
      </a>
    </footer>
  )
}
