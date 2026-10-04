import { Eye, EyeOff, LockKeyhole, User } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import Logo from './Logo'
import { Button } from './ui'

const inputCls =
  'h-10 w-full rounded-lg border border-line bg-surface pr-3 pl-9 text-sm shadow-xs placeholder:text-muted/70 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 focus:outline-none'

export default function Login({ onLogin }: { onLogin: (user: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { user } = await api.login(username, password)
      onLogin(user)
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Session expired, please sign in again' ? err.message : 'Invalid username or password')
      setLoading(false)
    }
  }

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-sky-500/15 blur-3xl" />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-line bg-surface p-8 shadow-xl shadow-black/5 animate-[pop-in_.25s_ease-out]"
      >
        <Logo size={72} className="mx-auto block w-fit drop-shadow-[0_8px_16px_rgba(29,99,237,0.35)]" />
        <h1 className="mt-4 text-center text-xl font-semibold tracking-tight">DockerUpdates</h1>
        <p className="mt-1 text-center text-sm text-muted">Sign in to manage your containers</p>

        <div className="mt-6 space-y-3">
          <div className="relative">
            <User size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              required
              autoFocus
              autoComplete="username"
              placeholder="Username"
              className={inputCls}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="relative">
            <LockKeyhole size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              required
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Password"
              className={`${inputCls} pr-10`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-label={show ? 'Hide password' : 'Show password'}
              onClick={() => setShow((s) => !s)}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted hover:text-fg"
            >
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="md" loading={loading} className="mt-5 w-full">
          Sign in
        </Button>
      </form>
    </div>
  )
}
