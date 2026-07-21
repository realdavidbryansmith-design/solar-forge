/**
 * Shared low-level controls.
 *
 * Two rules the whole UI depends on:
 *   1. A `null` is never rendered as 0 or as a blank number. It renders as
 *      "—" (or a caller-supplied phrase like "not published").
 *   2. Any catalog part whose provenance is shaky gets a visible ⓘ affordance,
 *      so a contractor can tell a datasheet number from an estimate.
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SourceRef } from '../types'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format a number that may legitimately be absent. Never turns null into 0. */
export function fmt(
  value: number | null | undefined,
  opts: { digits?: number; unit?: string; nullText?: string } = {},
): string {
  const { digits = 0, unit, nullText = '—' } = opts
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return nullText
  }
  const n = value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return unit ? `${n} ${unit}` : n
}

/** Currency, or an explicit "price unavailable" — never a silent $0. */
export function money(
  value: number | null | undefined,
  nullText = 'price unavailable',
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return nullText
  }
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Section({
  title,
  hint,
  right,
  children,
}: {
  title: string
  hint?: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="min-w-0 border-b border-ink-700/70 px-4 py-4">
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="min-w-0 text-xs font-semibold tracking-[0.12em] text-slate-400 uppercase">
          {title}
        </h2>
        {right ? <div className="shrink-0">{right}</div> : null}
      </header>
      {hint ? <p className="mb-3 text-xs leading-relaxed text-slate-500">{hint}</p> : null}
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  )
}

export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="min-w-0 pb-6">{children}</div>
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'good' | 'warn' | 'bad'
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-300'
      : tone === 'warn'
        ? 'text-amber-300'
        : tone === 'bad'
          ? 'text-rose-300'
          : 'text-slate-100'
  return (
    <div className="min-w-0 rounded-lg border border-ink-700 bg-ink-800/60 px-3 py-2">
      <div className="truncate text-[11px] tracking-wide text-slate-400 uppercase">
        {label}
      </div>
      <div className={`truncate text-lg font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  )
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-2 gap-2">{children}</div>
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mx-4 my-6 rounded-lg border border-dashed border-ink-600 bg-ink-800/40 px-4 py-6 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {children ? <p className="mt-1 text-xs text-slate-500">{children}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Provenance affordance
// ---------------------------------------------------------------------------

/**
 * Small ⓘ badge exposing where a catalog spec came from.
 *
 * Rendered as a span rather than a button on purpose: index.css forces every
 * <button> to 44px on coarse pointers, which would wreck inline text flow.
 * Keyboard semantics are supplied by hand instead.
 */
export function SourceInfo({
  source,
  compact = false,
}: {
  source?: SourceRef
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!source) {
    return (
      <span
        className="ml-1 inline-flex shrink-0 items-center rounded border border-slate-600 px-1 text-[10px] text-slate-400"
        title="No datasheet provenance recorded for this part."
      >
        ⓘ no source
      </span>
    )
  }

  const needsAttention = source.confidence !== 'high' || Boolean(source.note)
  if (!needsAttention && compact) return null

  const tone =
    source.confidence === 'low'
      ? 'border-rose-500/60 text-rose-300'
      : source.confidence === 'medium'
        ? 'border-amber-500/60 text-amber-300'
        : 'border-emerald-500/50 text-emerald-300'

  return (
    <span className="inline min-w-0">
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className={`ml-1 inline-flex shrink-0 cursor-pointer items-center rounded border px-1 py-0.5 text-[10px] select-none ${tone}`}
        title={`Source confidence: ${source.confidence}`}
      >
        ⓘ {source.confidence}
      </span>
      {open ? (
        <span className="mt-1 block rounded border border-ink-600 bg-ink-800 p-2 text-[11px] leading-relaxed break-words text-slate-300">
          <span className="block">
            Confidence: <strong className="font-semibold">{source.confidence}</strong> ·
            retrieved {source.retrieved}
          </span>
          {source.note ? <span className="mt-1 block">{source.note}</span> : null}
          <span className="mt-1 block break-all text-slate-500">{source.url}</span>
        </span>
      ) : null}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function FieldShell({
  label,
  hint,
  emphasis,
  badge,
  htmlFor,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  emphasis?: boolean
  badge?: ReactNode
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div
      className={
        emphasis
          ? 'min-w-0 rounded-lg border border-brand-500/60 bg-brand-500/5 p-3'
          : 'min-w-0'
      }
    >
      <label
        htmlFor={htmlFor}
        className={`mb-1 flex flex-wrap items-center gap-x-1 text-xs ${
          emphasis ? 'font-semibold text-brand-400' : 'text-slate-400'
        }`}
      >
        <span className="min-w-0">{label}</span>
        {badge}
      </label>
      {children}
      {hint ? (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{hint}</p>
      ) : null}
    </div>
  )
}

const inputClass =
  'w-full min-w-0 rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500'

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step,
  min,
  max,
  hint,
  emphasis,
  allowNull = false,
  nullPlaceholder = 'not set',
}: {
  label: ReactNode
  value: number | null
  onChange: (v: number | null) => void
  unit?: string
  step?: number
  min?: number
  max?: number
  hint?: ReactNode
  emphasis?: boolean
  allowNull?: boolean
  nullPlaceholder?: string
}) {
  const id = useId()
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const external = useRef(value)

  // Re-sync only when the value changed underneath us (undo, preset load, …),
  // so typing "-2" or "1." is never clobbered mid-keystroke.
  useEffect(() => {
    if (external.current !== value) {
      external.current = value
      setDraft(value === null ? '' : String(value))
    }
  }, [value])

  return (
    <FieldShell label={label} hint={hint} emphasis={emphasis} htmlFor={id}>
      <div className="flex min-w-0 items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={inputClass}
          value={draft}
          step={step}
          min={min}
          max={max}
          placeholder={allowNull ? nullPlaceholder : undefined}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            if (next.trim() === '') {
              if (allowNull) {
                external.current = null
                onChange(null)
              }
              return
            }
            const parsed = Number(next)
            if (Number.isFinite(parsed)) {
              external.current = parsed
              onChange(parsed)
            }
          }}
        />
        {unit ? (
          <span className="shrink-0 text-xs text-slate-400">{unit}</span>
        ) : null}
      </div>
    </FieldShell>
  )
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  placeholder,
}: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  hint?: ReactNode
  placeholder?: string
}) {
  const id = useId()
  return (
    <FieldShell label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="text"
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldShell>
  )
}

export interface Option {
  value: string
  label: string
  badge?: ReactNode
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  hint,
  emphasis,
  badge,
}: {
  label: ReactNode
  value: string
  onChange: (v: string) => void
  options: Option[]
  hint?: ReactNode
  emphasis?: boolean
  badge?: ReactNode
}) {
  const id = useId()
  return (
    <FieldShell label={label} hint={hint} emphasis={emphasis} badge={badge} htmlFor={id}>
      <select
        id={id}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
  hint?: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full min-w-0 items-center justify-between gap-3 rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm text-slate-200">{label}</span>
        {hint ? <span className="block text-[11px] text-slate-500">{hint}</span> : null}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-brand-500' : 'bg-ink-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

/** Multi-select chip row. Used for system types, inverters, EVSE. */
export function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  hint,
}: {
  label: ReactNode
  options: Option[]
  selected: string[]
  onToggle: (value: string) => void
  hint?: ReactNode
}) {
  return (
    <FieldShell label={label} hint={hint}>
      <div className="flex min-w-0 flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value)
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(o.value)}
              className={`rounded-full border px-3 py-1.5 text-xs ${
                on
                  ? 'border-brand-500 bg-brand-500/20 text-brand-400'
                  : 'border-ink-600 bg-ink-800 text-slate-300'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </FieldShell>
  )
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  readout,
}: {
  label: ReactNode
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  readout: ReactNode
}) {
  const id = useId()
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 text-slate-400">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums text-slate-200">{readout}</span>
      </label>
      <input
        id={id}
        type="range"
        className="w-full min-w-0 accent-brand-500"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function Collapse({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-ink-600 bg-ink-800/70 px-2 py-1.5 text-left text-xs text-slate-300"
      >
        <span className="shrink-0 text-slate-500">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 truncate">{summary}</span>
      </button>
      {open ? <div className="mt-2 min-w-0">{children}</div> : null}
    </div>
  )
}

/** Any wide content must scroll inside itself — the page never scrolls sideways. */
export function ScrollX({ children }: { children: ReactNode }) {
  return <div className="w-full min-w-0 overflow-x-auto">{children}</div>
}
