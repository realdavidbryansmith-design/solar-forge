/**
 * Catches a render crash so the whole PWA does not white-screen.
 *
 * Matters more than usual here: the app installs as a service worker, so a
 * crashing build keeps being served from cache with no obvious way back. The
 * fallback therefore offers a way to clear the cached build and reload.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Shown above the message, e.g. "3D view" or "Code checks". */
  area?: string
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep it in the console for anyone reporting the fault.
    console.error('SolarForge crashed', error, info.componentStack)
  }

  private reset = () => this.setState({ error: null })

  private hardReload = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.()
      await Promise.all((regs ?? []).map((r) => r.unregister()))
      const keys = await caches?.keys?.()
      await Promise.all((keys ?? []).map((k) => caches.delete(k)))
    } catch {
      // Clearing is best-effort; reload regardless.
    }
    location.reload()
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
        <div className="max-w-md rounded-lg border border-rose-800/60 bg-rose-950/30 p-4">
          <h2 className="text-sm font-semibold text-rose-200">
            {this.props.area ? `${this.props.area} stopped working` : 'Something broke'}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-rose-100/80">
            This is a bug in SolarForge, not something you did. Your design is still
            in memory — try dismissing this first.
          </p>
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-ink-900/80 p-2 font-mono text-[11px] text-rose-200/80">
            {error.message}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Dismiss and retry
            </button>
            <button
              type="button"
              onClick={this.hardReload}
              className="rounded-md border border-ink-600 px-3 py-1.5 text-xs text-slate-300"
            >
              Clear cached build and reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
