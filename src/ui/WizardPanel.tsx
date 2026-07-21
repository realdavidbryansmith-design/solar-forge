/**
 * "Build me a system that does this."
 *
 * Three ways to describe the load, because people arrive knowing very
 * different amounts:
 *   1. Pick appliances     — most accurate, most effort
 *   2. Let it guess        — a lifestyle preset, for people who have no idea
 *   3. Enter kWh directly  — for anyone holding a utility bill
 *
 * The guess is the important one. Most people genuinely do not know their
 * daily kWh, and a rough number they can then refine beats a blank field they
 * abandon.
 */

import { useMemo, useState } from 'react'
import type { SystemType } from '../types'
import {
  APPLIANCES,
  CATEGORY_LABELS,
  LOAD_PRESETS,
  type LoadCategory,
  type LoadItem,
  type SystemGoal,
  estimateLoads,
  sizeSystem,
} from '../engine/loads'
import { catalog } from '../catalog'
import { makeModulePositions, useStore } from '../store'
import {
  Collapse,
  NumberField,
  PanelBody,
  Section,
  SelectField,
  Stat,
  StatGrid,
  fmt,
} from './controls'

type LoadMode = 'guess' | 'appliances' | 'known'

const GOALS: Array<{ id: SystemGoal; title: string; blurb: string }> = [
  {
    id: 'off-grid',
    title: 'Off-grid — no utility connection',
    blurb: 'A cabin or property with no grid service. Solar and batteries carry everything, so the array is sized on the worst month of the year.',
  },
  {
    id: 'backup',
    title: 'Grid-connected with battery backup',
    blurb: 'Normally on the grid, but rides through outages. Batteries cover the critical loads; the grid covers the shortfall.',
  },
  {
    id: 'grid-offset',
    title: 'Offset my electric bill',
    blurb: 'Grid-tied, no batteries. Sized against the annual average, since the grid fills in the winter gap.',
  },
]

export function WizardPanel() {
  const design = useStore((s) => s.design)
  const setPanel = useStore((s) => s.setPanel)
  const setSystemTypes = useStore((s) => s.setSystemTypes)
  const setInverters = useStore((s) => s.setInverters)
  const setBattery = useStore((s) => s.setBattery)
  const setChargeController = useStore((s) => s.setChargeController)
  const addArray = useStore((s) => s.addArray)
  const loadDesign = useStore((s) => s.loadDesign)
  const setLoadProfile = useStore((s) => s.setLoadProfile)

  const [goal, setGoal] = useState<SystemGoal>('off-grid')
  const [mode, setMode] = useState<LoadMode>('guess')
  const [presetId, setPresetId] = useState(LOAD_PRESETS[1].id)
  const [items, setItems] = useState<LoadItem[]>([])
  const [knownKwh, setKnownKwh] = useState<number | null>(30)
  const [autonomy, setAutonomy] = useState(2)
  const [weather, setWeather] = useState(0.7)
  const [applied, setApplied] = useState<string | null>(null)

  const preset = LOAD_PRESETS.find((p) => p.id === presetId) ?? LOAD_PRESETS[1]
  const itemised = useMemo(() => estimateLoads(items), [items])

  // Resolve whichever input mode is active into one load figure.
  const load = useMemo(() => {
    if (mode === 'appliances') {
      return {
        daily_kwh: itemised.daily_kwh,
        peak_watts: itemised.peak_watts,
        surge_watts: itemised.surge_watts,
        warnings: itemised.warnings,
      }
    }
    if (mode === 'known') {
      const kwh = knownKwh ?? 0
      // No appliance list to work from, so scale the peak off the daily energy.
      return {
        daily_kwh: kwh,
        peak_watts: Math.max(1500, kwh * 300),
        surge_watts: Math.max(3000, kwh * 600),
        warnings: [],
      }
    }
    return {
      daily_kwh: preset.daily_kwh,
      peak_watts: preset.peak_watts,
      surge_watts: preset.surge_watts,
      warnings: estimateLoads(preset.implies.map((id) => ({ appliance_id: id, quantity: 1 })))
        .warnings,
    }
  }, [mode, itemised, knownKwh, preset])

  const plane = design.planes[0]
  const result = useMemo(
    () =>
      sizeSystem({
        goal,
        daily_kwh: load.daily_kwh,
        peak_watts: load.peak_watts,
        surge_watts: load.surge_watts,
        latitude_deg: design.site.latitude_deg,
        tilt_deg: plane?.tilt_deg ?? 30,
        azimuth_deg: plane?.azimuth_deg ?? 180,
        autonomy_days: goal === 'grid-offset' ? 0 : autonomy,
        weather_factor: weather,
      }),
    [goal, load, design.site.latitude_deg, plane, autonomy, weather],
  )

  /*
    Pick real parts that *just* meet the recommendation.

    Both selections minimise overshoot rather than grabbing the first match.
    Naively taking the largest battery or the first big-enough inverter
    routinely doubled the cost of a small cabin system for no benefit.
  */
  const picks = useMemo(() => {
    const module = catalog.modules.find((m) => m.pmax_w >= 400) ?? catalog.modules[0]
    /*
      Above roughly 62 degrees the worst month has no usable sun, so the array
      size is Infinity. That is the correct answer — an off-grid system cannot
      be sized on solar alone there — but it must not become "Infinity modules"
      in the UI or NaN grid dimensions in the design.
    */
    const sizable = Number.isFinite(result.array_w) && result.array_w > 0
    const moduleQty = sizable ? Math.max(1, Math.ceil(result.array_w / module.pmax_w)) : 0

    // Off-grid needs a unit that can form its own grid; a grid-tied-only
    // inverter is useless at a cabin with no utility connection.
    const suitable = catalog.inverters.filter((i) => {
      if (goal === 'grid-offset') return i.category === 'string' || i.category === 'micro'
      if (goal === 'off-grid') return i.category === 'offgrid' || i.category === 'hybrid'
      return i.category === 'hybrid'
    })

    const inverter =
      suitable
        .filter((i) => i.rated_ac_power_w >= result.inverter_w)
        // Smallest unit that still covers the load.
        .sort((a, b) => a.rated_ac_power_w - b.rated_ac_power_w)[0] ?? null

    /*
      Choose the battery whose whole-unit multiple wastes the least capacity,
      among those that are actually compatible with the chosen inverter.

      Compatibility is not optional here: an AC-coupled battery like the
      Enphase IQ series only works inside its own ecosystem and cannot be
      hung off a DC inverter/charger, and a 48 V bank has to fall inside the
      inverter's battery voltage window.
    */
    let battery = null as (typeof catalog.batteries)[number] | null
    let batteryQty = 0
    if (goal !== 'grid-offset' && result.battery_usable_kwh > 0) {
      const range = inverter?.battery_voltage_range_v ?? null
      const compatible = catalog.batteries.filter((b) => {
        if (b.usable_capacity_kwh <= 0) return false
        // A DC inverter/charger needs a DC-coupled bank.
        if (b.coupling === 'AC') return false
        // And the bank voltage must sit inside the inverter's window.
        if (range && (b.nominal_voltage_v < range[0] || b.nominal_voltage_v > range[1])) {
          return false
        }
        return true
      })

      let bestWaste = Infinity
      for (const b of compatible) {
        const qty = Math.max(1, Math.ceil(result.battery_usable_kwh / b.usable_capacity_kwh))
        if (b.max_units_stackable !== null && qty > b.max_units_stackable) continue
        const waste = qty * b.usable_capacity_kwh - result.battery_usable_kwh
        if (waste < bestWaste) {
          bestWaste = waste
          battery = b
          batteryQty = qty
        }
      }
    }

    /*
      Inverter/chargers (Schneider XW Pro, Victron, OutBack Radian) have no PV
      input at all — their DC terminals are the battery port. Those systems
      need a separate MPPT charge controller or the array has no way to charge
      the bank. Hybrids with their own MPPTs do not.
    */
    const needsController = goal !== 'grid-offset' && (inverter?.mppt_count ?? 0) === 0
    let controller = null as (typeof catalog.chargeControllers)[number] | null
    let controllerQty = 0
    if (needsController) {
      const bankV = battery?.nominal_voltage_v ?? 48
      // Charge current the array can deliver into the bank.
      const requiredA = result.array_w / bankV
      const candidates = catalog.chargeControllers.filter((c) =>
        c.battery_voltages_v.some((v) => Math.abs(v - bankV) < 6),
      )
      // Smallest unit that carries the whole array, else parallel the largest.
      const single = candidates
        .filter((c) => c.max_charge_current_a >= requiredA)
        .sort((a, b) => a.max_charge_current_a - b.max_charge_current_a)[0]
      if (single) {
        controller = single
        controllerQty = 1
      } else if (candidates.length > 0) {
        const biggest = [...candidates].sort(
          (a, b) => b.max_charge_current_a - a.max_charge_current_a,
        )[0]
        controller = biggest
        controllerQty = Math.max(1, Math.ceil(requiredA / biggest.max_charge_current_a))
      }
    }

    return { module, moduleQty, inverter, battery, batteryQty, controller, controllerQty }
  }, [result, goal])

  const apply = () => {
    const types: SystemType[] =
      goal === 'off-grid'
        ? ['off-grid']
        : goal === 'backup'
          ? ['grid-tie', 'hybrid-storage']
          : ['grid-tie']
    setSystemTypes(types)

    if (plane && picks.moduleQty > 0) {
      // Lay the modules out roughly square so they fit a real roof plane.
      const cols = Math.max(1, Math.ceil(Math.sqrt(picks.moduleQty * 1.6)))
      const rows = Math.max(1, Math.ceil(picks.moduleQty / cols))
      addArray({
        id: `array-${Date.now()}`,
        name: `Array ${design.arrays.length + 1} (sized by wizard)`,
        plane_id: plane.id,
        module_id: picks.module.id,
        mount_id: catalog.mounts[0].id,
        layout: 'portrait',
        rows,
        cols,
        module_positions: makeModulePositions(rows, cols),
        row_pitch_m: null,
        tilt_deg: null,
        azimuth_deg: null,
      })
    }

    // Carry the load figure into the design so the code checks size the
    // battery bank against the real number rather than a placeholder.
    setLoadProfile({
      daily_kwh: load.daily_kwh,
      peak_w: load.peak_watts,
      surge_w: load.surge_watts,
      source: mode === 'guess' ? 'estimated' : mode === 'known' ? 'entered' : 'itemised',
    })

    if (picks.inverter) setInverters([picks.inverter.id])
    if (picks.battery && picks.batteryQty > 0) setBattery(picks.battery.id, picks.batteryQty)
    if (picks.controller && picks.controllerQty > 0) {
      setChargeController(picks.controller.id, picks.controllerQty)
    }
    loadDesign({
      ...useStore.getState().design,
      autonomy_days: goal === 'grid-offset' ? null : autonomy,
    })

    setApplied(
      `Applied: ${picks.moduleQty} × ${picks.module.pmax_w} W modules` +
        (picks.inverter ? `, ${picks.inverter.manufacturer} ${picks.inverter.model}` : '') +
        (picks.battery && picks.batteryQty ? `, ${picks.batteryQty} × ${picks.battery.model}` : '') +
        (picks.controller && picks.controllerQty
          ? `, ${picks.controllerQty} × ${picks.controller.model}`
          : ''),
    )
  }

  const setQty = (id: string, qty: number) =>
    setItems((prev) => {
      const rest = prev.filter((p) => p.appliance_id !== id)
      return qty > 0 ? [...rest, { appliance_id: id, quantity: qty }] : rest
    })
  const qtyOf = (id: string) => items.find((p) => p.appliance_id === id)?.quantity ?? 0

  const categories = [...new Set(APPLIANCES.map((a) => a.category))] as LoadCategory[]
  const noLoad = load.daily_kwh <= 0

  return (
    <PanelBody>
      <Section
        title="1 · What do you need it to do?"
        hint="This changes how the array is sized. Off-grid has to survive the darkest month; a grid-tied system can average across the year."
      >
        {GOALS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGoal(g.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left ${
              goal === g.id ? 'border-brand-500 bg-brand-600/15' : 'border-ink-700 bg-ink-800/50'
            }`}
          >
            <span className="block text-sm font-medium text-slate-200">{g.title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{g.blurb}</span>
          </button>
        ))}
      </Section>

      <Section
        title="2 · How much power do you use?"
        hint="If you have no idea, use the estimate — that is what it is for. You can refine it later."
      >
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['guess', 'Estimate it for me'],
              ['appliances', 'Pick my appliances'],
              ['known', 'I know my kWh'],
            ] as Array<[LoadMode, string]>
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                mode === m
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-ink-600 text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'guess' ? (
          <>
            {LOAD_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left ${
                  presetId === p.id
                    ? 'border-brand-500 bg-brand-600/15'
                    : 'border-ink-700 bg-ink-800/50'
                }`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-200">{p.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-brand-400">
                    ~{p.daily_kwh} kWh/day
                  </span>
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                  {p.description}
                </span>
              </button>
            ))}
            <p className="rounded border-l-2 border-amber-500/60 bg-amber-500/5 px-2 py-1 text-xs text-amber-200/90">
              These are rough starting points, not measurements. Real usage varies a lot. Once
              you have a system running, check it against a real meter reading and resize.
            </p>
            <Collapse summary="What this preset assumes you own">
              <ul className="space-y-0.5 text-xs text-slate-400">
                {preset.implies.map((id) => {
                  const a = APPLIANCES.find((x) => x.id === id)
                  return a ? (
                    <li key={id}>
                      • {a.name} — {a.watts} W, ~{a.hours_per_day} h/day
                    </li>
                  ) : null
                })}
              </ul>
            </Collapse>
          </>
        ) : null}

        {mode === 'appliances' ? (
          <>
            {categories.map((cat) => (
              <Collapse key={cat} summary={CATEGORY_LABELS[cat]}>
                <div className="space-y-2">
                  {APPLIANCES.filter((a) => a.category === cat).map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-2 rounded border border-ink-700 bg-ink-800/40 px-2 py-1.5"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs text-slate-200">{a.name}</div>
                        <div className="text-[11px] text-slate-500">
                          {a.watts} W · ~{a.hours_per_day} h/day
                          {a.surge_watts ? ` · ${a.surge_watts} W surge` : ''}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Fewer ${a.name}`}
                          onClick={() => setQty(a.id, Math.max(0, qtyOf(a.id) - 1))}
                          className="h-7 w-7 rounded border border-ink-600 text-slate-300"
                        >
                          −
                        </button>
                        <span className="w-5 text-center text-xs tabular-nums text-slate-200">
                          {qtyOf(a.id)}
                        </span>
                        <button
                          type="button"
                          aria-label={`More ${a.name}`}
                          onClick={() => setQty(a.id, qtyOf(a.id) + 1)}
                          className="h-7 w-7 rounded border border-ink-600 text-slate-300"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Collapse>
            ))}
            {itemised.breakdown.length > 0 ? (
              <Collapse summary="Where the energy goes" defaultOpen>
                <ul className="space-y-0.5 text-xs">
                  {itemised.breakdown.slice(0, 6).map((b) => (
                    <li key={b.name} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-400">
                        {b.quantity > 1 ? `${b.quantity} × ` : ''}
                        {b.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-300">
                        {b.daily_kwh.toFixed(2)} kWh
                      </span>
                    </li>
                  ))}
                </ul>
              </Collapse>
            ) : null}
          </>
        ) : null}

        {mode === 'known' ? (
          <NumberField
            label="Average daily use"
            unit="kWh/day"
            emphasis
            allowNull
            step={0.5}
            value={knownKwh}
            onChange={setKnownKwh}
            hint="A utility bill's monthly kWh divided by 30. Off-grid, use what you expect to use, not what you use on the grid."
          />
        ) : null}
      </Section>

      {goal !== 'grid-offset' ? (
        <Section title="3 · Design margin">
          <NumberField
            label="Days of autonomy"
            min={0}
            max={10}
            step={0.5}
            value={autonomy}
            onChange={(v) => setAutonomy(v ?? 0)}
            hint="How long the battery must carry you with no useful sun. Two to three days is typical; less than two assumes a generator."
          />
          <SelectField
            label="How sunny is the site?"
            value={String(weather)}
            onChange={(v) => setWeather(Number(v))}
            options={[
              { value: '0.85', label: 'Very sunny (high desert, Southwest)' },
              { value: '0.7', label: 'Average (most of the US)' },
              { value: '0.55', label: 'Often cloudy (Pacific NW, Northeast)' },
              { value: '0.45', label: 'Very cloudy / heavy winter overcast' },
            ]}
            hint="Applied on top of the clear-sky calculation to account for weather."
          />
        </Section>
      ) : null}

      <Section title={goal === 'grid-offset' ? '3 · Recommendation' : '4 · Recommendation'}>
        {noLoad ? (
          <p className="text-xs text-slate-500">
            Add some load above and a recommendation will appear here.
          </p>
        ) : (
          <>
            <StatGrid>
              <Stat
                label="Daily use"
                value={fmt(load.daily_kwh, { digits: 1, unit: 'kWh' })}
                hint={mode === 'guess' ? 'estimated' : mode === 'known' ? 'you entered' : 'itemised'}
              />
              <Stat
                label="Solar array"
                value={fmt(result.array_w / 1000, { digits: 1, unit: 'kW' })}
                tone="good"
              />
              <Stat
                label="Battery"
                value={
                  result.battery_nameplate_kwh > 0
                    ? fmt(result.battery_nameplate_kwh, { digits: 1, unit: 'kWh' })
                    : 'none'
                }
              />
              <Stat
                label="Inverter"
                value={fmt(result.inverter_w / 1000, { digits: 1, unit: 'kW' })}
                hint={`${fmt(result.inverter_surge_w / 1000, { digits: 1, unit: 'kW' })} surge`}
              />
            </StatGrid>

            <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs">
              <p className="mb-1 font-medium text-slate-300">Sun at this site</p>
              <p className="leading-relaxed text-slate-400">
                Worst month ({result.insolation.worst_month_name}):{' '}
                <span className="tabular-nums text-slate-200">
                  {result.insolation.worst_month_kwh_m2.toFixed(1)}
                </span>{' '}
                sun hours/day · annual average{' '}
                <span className="tabular-nums text-slate-200">
                  {result.insolation.annual_average_kwh_m2.toFixed(1)}
                </span>
                . Sized against{' '}
                <span className="tabular-nums text-slate-200">
                  {result.design_sun_hours.toFixed(1)}
                </span>{' '}
                after the weather derate.
              </p>
            </div>

            {[...load.warnings, ...result.notes].map((n, i) => (
              <p
                key={i}
                className="rounded border-l-2 border-amber-500/60 bg-amber-500/5 px-2 py-1 text-xs leading-relaxed text-amber-200/90"
              >
                {n}
              </p>
            ))}

            <div className="rounded-lg border border-ink-700 bg-ink-800/50 p-3 text-xs">
              <p className="mb-1 font-medium text-slate-300">Suggested equipment</p>
              <ul className="space-y-0.5 text-slate-400">
                <li>
                  •{' '}
                  {picks.moduleQty > 0
                    ? `${picks.moduleQty} × ${picks.module.manufacturer} ${picks.module.model} (${picks.module.pmax_w} W)`
                    : 'No array size can meet this load at this latitude.'}
                </li>
                <li>
                  •{' '}
                  {picks.inverter
                    ? `${picks.inverter.manufacturer} ${picks.inverter.model} (${fmt(picks.inverter.rated_ac_power_w / 1000, { digits: 1, unit: 'kW' })})`
                    : 'No catalogued inverter is large enough — this system needs multiple units in parallel.'}
                </li>
                {picks.battery && picks.batteryQty > 0 ? (
                  <li>
                    • {picks.batteryQty} × {picks.battery.manufacturer} {picks.battery.model} (
                    {fmt(picks.batteryQty * picks.battery.usable_capacity_kwh, { digits: 1, unit: 'kWh' })}{' '}
                    usable)
                  </li>
                ) : null}
                {picks.controller && picks.controllerQty > 0 ? (
                  <li>
                    • {picks.controllerQty} × {picks.controller.manufacturer}{' '}
                    {picks.controller.model} — the inverter/charger has no PV input, so the
                    array charges through this
                  </li>
                ) : null}
              </ul>
            </div>

            {picks.moduleQty > 0 ? (
              <button
                type="button"
                onClick={apply}
                className="w-full rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
              >
                Build this design
              </button>
            ) : (
              <p className="rounded border-l-2 border-rose-500/60 bg-rose-500/5 px-2 py-1 text-xs leading-relaxed text-rose-200/90">
                No array size can meet this load. At{' '}
                {design.site.latitude_deg.toFixed(1)}° the worst month has effectively
                no usable sun, so an off-grid system cannot be carried on solar alone —
                it needs a generator, wind, or a grid connection. Try the annual-average
                sizing by choosing a grid-connected goal, or check the latitude.
              </p>
            )}

            {applied ? (
              <div className="rounded border border-emerald-700/50 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <p>{applied}</p>
                <button
                  type="button"
                  onClick={() => setPanel('compliance')}
                  className="mt-1 underline underline-offset-2"
                >
                  Run the code checks →
                </button>
              </div>
            ) : null}

            <p className="text-xs leading-relaxed text-slate-500">
              This is a starting point, not a quote. It assumes an unshaded array at the roof
              tilt and azimuth on the Site panel, and uses a clear-sky model with no real
              weather data. Verify against a real site assessment before buying anything.
            </p>
          </>
        )}
      </Section>
    </PanelBody>
  )
}
