import { GitPullRequest, Heart, Star } from 'lucide-react'

const REPO = 'https://github.com/PixlGalaxy/DockerUpdates'

/** Thank-you note from the author, at the bottom of Settings. */
export default function SupportCard() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-sky-500/10 via-surface to-violet-500/10 shadow-sm">
      <div className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full bg-sky-500/10 blur-3xl" />
      <div className="relative flex flex-col items-center gap-6 p-6 sm:flex-row sm:items-stretch sm:p-8">
        <div className="flex flex-1 flex-col justify-center text-center sm:text-left">
          <p className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold tracking-wider text-sky-600 uppercase sm:justify-start dark:text-sky-400">
            <Heart size={13} className="fill-current" /> A note from Pixl
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">Thanks for using DockerUpdates!</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            DockerUpdates is free and open source. If it makes managing your server a little easier, consider dropping a star on GitHub: it
            really helps the project grow. Ideas, bug reports and pull requests are always welcome too.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
            <a
              href={REPO}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-amber-400 px-4 text-sm font-semibold text-zinc-900 shadow-sm shadow-amber-400/30 transition-colors hover:bg-amber-300"
            >
              <Star size={15} className="fill-current" /> Star on GitHub
            </a>
            <a
              href={`${REPO}/issues`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium transition-colors hover:bg-surface-2"
            >
              <GitPullRequest size={15} /> Contribute
            </a>
          </div>
          <a href={REPO} target="_blank" rel="noreferrer" className="mt-3 font-mono text-xs text-muted hover:text-sky-600 dark:hover:text-sky-400">
            github.com/PixlGalaxy/DockerUpdates
          </a>
        </div>

        <img
          src="/GalaxyPC.webp"
          alt="PixlGalaxy at the computer"
          width={1024}
          height={1024}
          loading="lazy"
          draggable={false}
          // The artwork has empty space at the top: crop it so the characters fill the box
          className="h-52 w-60 shrink-0 object-cover object-bottom select-none"
        />
      </div>
    </section>
  )
}
