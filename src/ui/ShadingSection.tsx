/**
 * Measured shading loss for the design.
 *
 * Computes on every design change — the calculation is a few milliseconds for
 * a residential array, so there is no reason to hide it behind a button.
 */

import { useEffect, useMemo } from 'react'
import { catalog } from '../catalog'
import { computeShading } from '../engine/shading'
import { buildShadingGeometry } from '../engine/siteGeometry'
import { useStore } from '../store'
import { Collapse, ScrollX, Section, Stat, StatGrid, fmt } from './controls'

/** Colour ramp used for both the bars here and the modules in the 3D view. */
export function lossTone(pct: number): 'good' | 'warn' | 'bad' {
  if (pct < 5) return 'good'
  if (pct < 15) return 'warn'
  return 'bad'
}

export function ShadingSection() {
  const design = useStore((s) => s.design)
  const setShading = useStore((s) => s.setShading)

  const result = useMemo(() => {
    const { surfaces, occluders } = buildShadingGeometry(design, catalog.modules)
    if (surfaces.length === 0) return null
    return computeShading({
      latitude_deg: design.site.latitude_deg,
      surfaces,
      occluders,
    })
  }, [design])

  // Publish so the 3D view can tint each module by its own loss.
  useEffect(() => {
    setShading(result)
  }, [result, setShading])

  if (!result) {
    return (
      <Section title="Shading">
        <p className="text-xs text-slate-500">
          Add an array to measure shading losses.
        </p>
      </Section>
    )
  }

  const worstBar = Math.max(...result.monthly.map((m) => m.loss_pct), 1)

  return (
    <Section
      title="Shading"
      hint="Rays are cast from nine points on every module toward the sun, twice an hour across twelve representative days, and weighted by the light available at that moment."
    >
      <StatGrid>
        <Stat
          label="Annual loss"
          value={fmt(result.annual_loss_pct, { digits: 1, unit: '%' })}
          tone={lossTone(result.annual_loss_pct)}
        />
        <Stat
          label={`Worst month`}
          value={fmt(result.worst_month_loss_pct, { digits: 1, unit: '%' })}
          hint={result.worst_month_name}
          tone={lossTone(result.worst_month_loss_pct)}
        />
      </StatGrid>

      {result.blame.length > 0 ? (
        <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-3">
          <p className="mb-2 text-xs font-medium text-slate-300">What is causing it</p>
          <ul className="space-y-1.5">
            {result.blame.slice(0, 5).map((b) => (
              <li key={b.id} className="text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-slate-300">{b.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">
                    {b.loss_pct.toFixed(1)}% of yield
                  </span>
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-ink-900">
                  <div
                    className="h-full rounded bg-amber-500/80"
                    style={{ width: `${Math.min(100, b.share_pct)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-slate-500">
            Bars show each obstruction's share of the total shading loss.
          </p>
        </div>
      ) : (
        <p className="rounded border-l-2 border-emerald-600/60 bg-emerald-500/5 px-2 py-1 text-xs text-emerald-200/90">
          Nothing is shading this array.
        </p>
      )}

      <Collapse summary="Month by month">
        <ScrollX>
          <table className="w-full min-w-[260px] text-xs">
            <tbody>
              {result.monthly.map((m) => (
                <tr key={m.month} className="border-b border-ink-700/60 last:border-0">
                  <td className="py-1 pr-2 whitespace-nowrap text-slate-400">
                    {m.month_name.slice(0, 3)}
                  </td>
                  <td className="w-full py-1 pr-2">
                    <div className="h-2 w-full overflow-hidden rounded bg-ink-900">
                      <div
                        className={`h-full rounded ${
                          lossTone(m.loss_pct) === 'bad'
                            ? 'bg-rose-500/80'
                            : lossTone(m.loss_pct) === 'warn'
                              ? 'bg-amber-500/80'
                              : 'bg-emerald-500/70'
                        }`}
                        style={{ width: `${(m.loss_pct / worstBar) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="py-1 text-right tabular-nums whitespace-nowrap text-slate-300">
                    {m.loss_pct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollX>
      </Collapse>

      <p className="rounded border-l-2 border-amber-500/60 bg-amber-500/5 px-2 py-1 text-xs leading-relaxed text-amber-200/90">
        This is <span className="font-semibold">geometric</span> shading only. The
        electrical loss is usually worse: a shaded cell drags down its whole series
        string, so a module 20% covered can lose considerably more than 20% of its
        output depending on bypass diodes and string layout. Treat this as a lower
        bound, and as a clear-sky model with no weather data behind it.
      </p>

      <p className="text-[11px] text-slate-500">
        {result.rays_cast.toLocaleString()} rays cast across{' '}
        {result.per_surface.length} modules.
      </p>
    </Section>
  )
}
