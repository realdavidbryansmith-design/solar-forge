/**
 * Design input panels: site, array, electrical, storage, EV.
 *
 * These only read and write the store. All derived numbers come from selectors
 * so nothing can drift out of sync with the design.
 */

import type { RoofType, SiteObject, SiteObjectKind, SystemType } from '../types'
import type { Option } from './controls'
import { ShadingSection } from './ShadingSection'
import { catalog } from '../catalog'
import {
  arrayDcWatts,
  makeModulePositions,
  moduleCount,
  systemAcWatts,
  systemDcWatts,
  useStore,
} from '../store'
import { optimalFixedTilt } from '../engine/solar'
import {
  ChipGroup,
  Collapse,
  EmptyState,
  NumberField,
  PanelBody,
  Section,
  SelectField,
  SliderField,
  SourceInfo,
  Stat,
  StatGrid,
  TextField,
  Toggle,
  fmt,
} from './controls'

const MONTH_STARTS = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayLabel(day: number): string {
  let idx = 0
  for (let i = 0; i < MONTH_STARTS.length; i++) if (day >= MONTH_STARTS[i]) idx = i
  return `${MONTH_NAMES[idx]} ${day - MONTH_STARTS[idx] + 1}`
}

function hourLabel(hour: number): string {
  const h = Math.floor(hour)
  const m = Math.round((hour - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} solar`
}

// ---------------------------------------------------------------------------

const SYSTEM_TYPES: Option[] = [
  { value: 'grid-tie', label: 'Grid-tie' },
  { value: 'hybrid-storage', label: 'Hybrid / storage' },
  { value: 'off-grid', label: 'Off-grid' },
  { value: 'ground-mount', label: 'Ground mount' },
  { value: 'tracker', label: 'Tracker' },
  { value: 'ev-charging', label: 'EV charging' },
]

export function SitePanel() {
  const design = useStore((s) => s.design)
  const updateSite = useStore((s) => s.updateSite)
  const setSystemTypes = useStore((s) => s.setSystemTypes)
  const sunDay = useStore((s) => s.sunDay)
  const sunHour = useStore((s) => s.sunHour)
  const setSun = useStore((s) => s.setSun)
  const showShadows = useStore((s) => s.showShadows)
  const toggleShadows = useStore((s) => s.toggleShadows)
  const site = design.site

  const toggleType = (v: string) => {
    const t = v as SystemType
    const next = design.system_type.includes(t)
      ? design.system_type.filter((x) => x !== t)
      : [...design.system_type, t]
    setSystemTypes(next)
  }

  return (
    <PanelBody>
      <Section title="Project">
        <TextField label="Site name" value={site.label} onChange={(v) => updateSite({ label: v })} />
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Latitude" unit="°" step={0.01} value={site.latitude_deg} onChange={(v) => updateSite({ latitude_deg: v ?? 0 })} />
          <NumberField label="Longitude" unit="°" step={0.01} value={site.longitude_deg} onChange={(v) => updateSite({ longitude_deg: v ?? 0 })} />
        </div>
        <NumberField label="Elevation" unit="m" value={site.elevation_m} onChange={(v) => updateSite({ elevation_m: v ?? 0 })} />
        <p className="text-xs text-slate-500">
          Optimal fixed tilt for this latitude is about{' '}
          <span className="font-semibold text-slate-300">
            {fmt(optimalFixedTilt(site.latitude_deg), { digits: 0, unit: '°' })}
          </span>
          .
        </p>
      </Section>

      <Section
        title="Design temperatures"
        hint="The record low drives the NEC 690.7 cold-temperature Voc correction, which sets your maximum string length. It matters more than any other input on this screen — use the ASHRAE extreme annual mean minimum for the site, not a typical winter low."
      >
        <NumberField
          label="Record low (ASHRAE extreme minimum)"
          unit="°C"
          emphasis
          value={site.record_low_temp_c}
          onChange={(v) => updateSite({ record_low_temp_c: v ?? 0 })}
          hint="Colder values shorten the maximum string."
        />
        <NumberField
          label="Design high (ASHRAE 2%)"
          unit="°C"
          value={site.design_high_temp_c}
          onChange={(v) => updateSite({ design_high_temp_c: v ?? 0 })}
          hint="Used for conductor ampacity correction."
        />
      </Section>

      <Section title="Structural &amp; code">
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Wind speed" unit="mph" allowNull value={site.wind_speed_mph} onChange={(v) => updateSite({ wind_speed_mph: v })} />
          <NumberField label="Ground snow" unit="psf" allowNull value={site.ground_snow_load_psf} onChange={(v) => updateSite({ ground_snow_load_psf: v })} />
        </div>
        <SelectField
          label="NEC edition enforced by the AHJ"
          value={site.nec_edition}
          onChange={(v) => updateSite({ nec_edition: v as '2017' | '2020' | '2023' })}
          options={[
            { value: '2017', label: 'NEC 2017' },
            { value: '2020', label: 'NEC 2020' },
            { value: '2023', label: 'NEC 2023' },
          ]}
          hint="Section numbering and several rules changed between editions."
        />
        <ChipGroup label="System types" options={SYSTEM_TYPES} selected={design.system_type} onToggle={toggleType} />
      </Section>

      <Section title="Sun position" hint="Scrub the date and time to watch shadows move across the array.">
        <SliderField label="Day of year" value={sunDay} onChange={(v) => setSun(v, sunHour)} min={1} max={365} readout={dayLabel(sunDay)} />
        <SliderField label="Time" value={sunHour} onChange={(v) => setSun(sunDay, v)} min={0} max={24} step={0.25} readout={hourLabel(sunHour)} />
        <div className="flex flex-wrap gap-2">
          <QuickSun label="Winter 9am" day={355} hour={9} />
          <QuickSun label="Winter noon" day={355} hour={12} />
          <QuickSun label="Summer noon" day={172} hour={12} />
          <QuickSun label="Equinox 3pm" day={80} hour={15} />
        </div>
        <Toggle label="Cast shadows" checked={showShadows} onChange={toggleShadows} />
      </Section>

      <SiteObjectsSection />
    </PanelBody>
  )
}

// ---------------------------------------------------------------------------

/** Sensible starting dimensions per object type, in metres. */
const OBJECT_PRESETS: Record<
  SiteObjectKind,
  { label: string; width: number; depth: number; height: number; pitch: number }
> = {
  house: { label: 'House', width: 12, depth: 8, height: 3, pitch: 25 },
  barn: { label: 'Barn', width: 14, depth: 9, height: 5, pitch: 30 },
  garage: { label: 'Garage', width: 7, depth: 6, height: 2.7, pitch: 20 },
  shed: { label: 'Shed', width: 3, depth: 2.5, height: 2.2, pitch: 15 },
  'tree-deciduous': { label: 'Tree (leafy)', width: 7, depth: 7, height: 9, pitch: 0 },
  'tree-conifer': { label: 'Tree (conifer)', width: 4.5, depth: 4.5, height: 12, pitch: 0 },
}

/**
 * Placement of buildings and trees.
 *
 * This is a shading tool as much as a drawing tool: put the neighbour's oak
 * where it really is, then scrub the sun to see when it crosses the array.
 */
function SiteObjectsSection() {
  const objects = useStore((s) => s.design.site_objects)
  const addSiteObject = useStore((s) => s.addSiteObject)
  const updateSiteObject = useStore((s) => s.updateSiteObject)
  const removeSiteObject = useStore((s) => s.removeSiteObject)

  const add = (kind: SiteObjectKind) => {
    const p = OBJECT_PRESETS[kind]
    const n = objects.filter((o) => o.kind === kind).length + 1
    const obj: SiteObject = {
      id: `obj-${kind}-${Date.now()}`,
      kind,
      name: `${p.label} ${n}`,
      // Drop new objects clear of the default house footprint.
      x: -8,
      y: 6 + objects.length * 2,
      rotation_deg: 0,
      width_m: p.width,
      depth_m: p.depth,
      height_m: p.height,
      roof_pitch_deg: p.pitch,
    }
    addSiteObject(obj)
  }

  return (
    <Section
      title="Site objects"
      hint="Buildings and trees cast real shadows here. Place the ones that matter, then scrub the sun above to see when they shade the array — trees are usually the reason a location does not work."
    >
      <div className="flex flex-wrap gap-2">
        {(Object.keys(OBJECT_PRESETS) as SiteObjectKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => add(k)}
            className="rounded-full border border-ink-600 px-3 py-1 text-xs text-slate-300 hover:border-brand-500"
          >
            + {OBJECT_PRESETS[k].label}
          </button>
        ))}
      </div>

      {objects.length === 0 ? (
        <p className="text-xs text-slate-500">
          No site objects. Add the house, any outbuildings, and nearby trees.
        </p>
      ) : null}

      {objects.map((o) => {
        const isTree = o.kind.startsWith('tree-')
        return (
          <Collapse key={o.id} summary={`${o.name} — ${isTree ? 'tree' : 'building'}`}>
            <div className="space-y-3">
              <TextField
                label="Name"
                value={o.name}
                onChange={(v) => updateSiteObject(o.id, { name: v })}
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="East / west"
                  unit="m"
                  step={0.5}
                  value={o.x}
                  onChange={(v) => updateSiteObject(o.id, { x: v ?? 0 })}
                  hint="+ is east"
                />
                <NumberField
                  label="North / south"
                  unit="m"
                  step={0.5}
                  value={o.y}
                  onChange={(v) => updateSiteObject(o.id, { y: v ?? 0 })}
                  hint="+ is north"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label={isTree ? 'Canopy spread' : 'Width'}
                  unit="m"
                  min={0.5}
                  step={0.5}
                  value={o.width_m}
                  onChange={(v) => updateSiteObject(o.id, { width_m: v ?? 1 })}
                />
                <NumberField
                  label={isTree ? 'Total height' : 'Wall height'}
                  unit="m"
                  min={0.5}
                  step={0.5}
                  value={o.height_m}
                  onChange={(v) => updateSiteObject(o.id, { height_m: v ?? 1 })}
                />
              </div>
              {!isTree ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Depth"
                    unit="m"
                    min={0.5}
                    step={0.5}
                    value={o.depth_m}
                    onChange={(v) => updateSiteObject(o.id, { depth_m: v ?? 1 })}
                  />
                  <NumberField
                    label="Roof pitch"
                    unit="°"
                    min={0}
                    max={60}
                    value={o.roof_pitch_deg}
                    onChange={(v) => updateSiteObject(o.id, { roof_pitch_deg: v ?? 0 })}
                    hint="0 = flat"
                  />
                </div>
              ) : null}
              {!isTree ? (
                <NumberField
                  label="Rotation"
                  unit="°"
                  min={0}
                  max={360}
                  value={o.rotation_deg}
                  onChange={(v) => updateSiteObject(o.id, { rotation_deg: v ?? 0 })}
                />
              ) : null}
              <button
                type="button"
                onClick={() => removeSiteObject(o.id)}
                className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300"
              >
                Remove {o.name}
              </button>
            </div>
          </Collapse>
        )
      })}
    </Section>
  )
}

function QuickSun({ label, day, hour }: { label: string; day: number; hour: number }) {
  const setSun = useStore((s) => s.setSun)
  return (
    <button
      type="button"
      onClick={() => setSun(day, hour)}
      className="rounded-full border border-ink-600 bg-ink-800 px-3 py-1 text-xs text-slate-300 hover:border-brand-500"
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------

const ROOF_TYPES: Option[] = [
  { value: 'comp-shingle', label: 'Composition shingle' },
  { value: 'tile', label: 'Tile' },
  { value: 'standing-seam-metal', label: 'Standing seam metal' },
  { value: 'corrugated-metal', label: 'Corrugated metal' },
  { value: 'flat-membrane', label: 'Flat / membrane' },
  { value: 'ground', label: 'Ground' },
]

export function ArrayPanel() {
  const design = useStore((s) => s.design)
  const updatePlane = useStore((s) => s.updatePlane)
  const addArray = useStore((s) => s.addArray)
  const updateArray = useStore((s) => s.updateArray)
  const removeArray = useStore((s) => s.removeArray)
  const selectedArrayId = useStore((s) => s.selectedArrayId)
  const selectArray = useStore((s) => s.selectArray)

  const moduleOptions: Option[] = catalog.modules.map((m) => ({
    value: m.id,
    label: `${m.manufacturer} ${m.model} — ${m.pmax_w} W`,
  }))
  const mountOptions: Option[] = catalog.mounts.map((m) => ({
    value: m.id,
    label: `${m.manufacturer} ${m.product_line}`,
  }))

  const handleAdd = (planeId: string) => {
    const rows = 3
    const cols = 5
    addArray({
      id: `array-${Date.now()}`,
      name: `Array ${design.arrays.length + 1}`,
      plane_id: planeId,
      module_id: catalog.modules[0].id,
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

  return (
    <PanelBody>
      {design.planes.map((plane) => (
        <Section
          key={plane.id}
          title={plane.name}
          right={
            <button
              type="button"
              onClick={() => handleAdd(plane.id)}
              className="rounded-md bg-brand-600 px-3 py-1 text-xs font-semibold text-white"
            >
              + Array
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="Tilt" unit="°" min={0} max={90} value={plane.tilt_deg} onChange={(v) => updatePlane(plane.id, { tilt_deg: v ?? 0 })} />
            <NumberField label="Azimuth" unit="°" min={0} max={360} value={plane.azimuth_deg} onChange={(v) => updatePlane(plane.id, { azimuth_deg: v ?? 0 })} hint="180 = due south" />
          </div>
          <NumberField label="Eave height" unit="m" step={0.1} value={plane.eave_height_m} onChange={(v) => updatePlane(plane.id, { eave_height_m: v ?? 0 })} />
          <SelectField label="Roof type" value={plane.roof_type} onChange={(v) => updatePlane(plane.id, { roof_type: v as RoofType })} options={ROOF_TYPES} />
        </Section>
      ))}

      {design.arrays.length > 0 ? <ShadingSection /> : null}

      {design.arrays.length === 0 ? (
        <EmptyState title="No arrays yet">
          Add an array to a roof plane above to start the design.
        </EmptyState>
      ) : null}

      {design.arrays.map((array) => {
        const mod = catalog.modules.find((m) => m.id === array.module_id)
        const mount = catalog.mounts.find((m) => m.id === array.mount_id)
        const count = moduleCount(array)
        const area = mod ? (count * mod.length_mm * mod.width_mm) / 1e6 : 0
        const isSel = selectedArrayId === array.id

        return (
          <Section
            key={array.id}
            title={array.name}
            right={
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => selectArray(isSel ? null : array.id)}
                  className={`rounded-md px-2 py-1 text-xs ${isSel ? 'bg-brand-600 text-white' : 'border border-ink-600 text-slate-300'}`}
                >
                  {isSel ? 'Selected' : 'Select'}
                </button>
                <button
                  type="button"
                  onClick={() => removeArray(array.id)}
                  className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300"
                >
                  Remove
                </button>
              </div>
            }
          >
            <StatGrid>
              <Stat label="Modules" value={count} />
              <Stat label="DC nameplate" value={fmt(arrayDcWatts(array) / 1000, { digits: 2, unit: 'kW' })} />
              <Stat label="Array area" value={fmt(area, { digits: 1, unit: 'm²' })} />
              <Stat label="Grid" value={`${array.rows} × ${array.cols}`} />
            </StatGrid>

            <SelectField
              label="Module"
              value={array.module_id}
              onChange={(v) => updateArray(array.id, { module_id: v })}
              options={moduleOptions}
              badge={<SourceInfo source={mod?.source} compact />}
            />
            <SelectField
              label="Mount"
              value={array.mount_id}
              onChange={(v) => updateArray(array.id, { mount_id: v })}
              options={mountOptions}
              badge={<SourceInfo source={mount?.source} compact />}
            />
            <SelectField
              label="Orientation"
              value={array.layout}
              onChange={(v) => updateArray(array.id, { layout: v as 'portrait' | 'landscape' })}
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Rows"
                min={1}
                max={30}
                value={array.rows}
                onChange={(v) => {
                  const rows = Math.max(1, v ?? 1)
                  updateArray(array.id, { rows, module_positions: makeModulePositions(rows, array.cols) })
                }}
              />
              <NumberField
                label="Columns"
                min={1}
                max={40}
                value={array.cols}
                onChange={(v) => {
                  const cols = Math.max(1, v ?? 1)
                  updateArray(array.id, { cols, module_positions: makeModulePositions(array.rows, cols) })
                }}
              />
            </div>
            <p className="text-xs text-slate-500">
              Select the array, then tap a module in the 3D view to remove it — useful for
              working around vents and obstructions.
            </p>
          </Section>
        )
      })}
    </PanelBody>
  )
}

// ---------------------------------------------------------------------------

export function ElectricalPanel() {
  const design = useStore((s) => s.design)
  const setInverters = useStore((s) => s.setInverters)
  const updateService = useStore((s) => s.updateService)
  const updateCircuit = useStore((s) => s.updateCircuit)
  const moduleCountTotal = design.arrays.reduce((n, a) => n + moduleCount(a), 0)

  const dc = systemDcWatts(design)
  const ac = systemAcWatts(design)
  const ratio = ac > 0 ? dc / ac : null

  const toggleInverter = (id: string) => {
    const next = design.inverter_ids.includes(id)
      ? design.inverter_ids.filter((x) => x !== id)
      : [...design.inverter_ids, id]
    setInverters(next)
  }

  return (
    <PanelBody>
      <Section title="System size">
        <StatGrid>
          <Stat label="DC nameplate" value={fmt(dc / 1000, { digits: 2, unit: 'kW' })} />
          <Stat label="AC nameplate" value={fmt(ac / 1000, { digits: 2, unit: 'kW' })} />
          <Stat
            label="DC : AC ratio"
            value={ratio === null ? '—' : ratio.toFixed(2)}
            tone={ratio === null ? 'default' : ratio > 1.5 ? 'warn' : 'good'}
            hint={ratio !== null && ratio > 1.5 ? 'Heavy clipping likely' : undefined}
          />
          <Stat label="Inverters" value={design.inverter_ids.length} />
        </StatGrid>
      </Section>

      <Section
        title="Inverters"
        hint="Microinverters count one unit per module. Select every unit in the design."
      >
        {catalog.inverters.map((inv) => {
          const on = design.inverter_ids.includes(inv.id)
          return (
            <button
              key={inv.id}
              type="button"
              onClick={() => toggleInverter(inv.id)}
              className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left ${
                on ? 'border-brand-500 bg-brand-600/15' : 'border-ink-700 bg-ink-800/50'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">
                  {inv.manufacturer} {inv.model}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {inv.category} · {fmt(inv.rated_ac_power_w, { unit: 'W' })} AC ·{' '}
                  {fmt(inv.max_dc_input_voltage_v, { unit: 'V', nullText: 'V n/a' })} max DC
                  <SourceInfo source={inv.source} compact />
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{on ? '✓' : '+'}</span>
            </button>
          )
        })}
      </Section>

      <Section
        title="DC circuit"
        hint="How the array is actually wired. The module grid is a layout, not a circuit — 15 modules can be three strings of five or one string of fifteen, and only one of those is safe on a given controller. Left blank, the code checks report unknown rather than guessing."
      >
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Modules per string"
            allowNull
            min={1}
            emphasis
            value={design.circuit.modules_per_string}
            onChange={(v) => updateCircuit({ modules_per_string: v })}
            nullPlaceholder="not set"
          />
          <NumberField
            label="Strings in parallel"
            allowNull
            min={1}
            emphasis
            value={design.circuit.strings_in_parallel}
            onChange={(v) => updateCircuit({ strings_in_parallel: v })}
            nullPlaceholder="not set"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="DC run length"
            unit="ft"
            allowNull
            min={1}
            value={design.circuit.dc_run_ft}
            onChange={(v) => updateCircuit({ dc_run_ft: v })}
            hint="One way, for voltage drop"
          />
          <NumberField
            label="Conductors in raceway"
            allowNull
            min={2}
            value={design.circuit.conductors_in_raceway}
            onChange={(v) => updateCircuit({ conductors_in_raceway: v })}
            hint="Current-carrying, for the fill derate"
          />
        </div>
        <SelectField
          label="Termination temperature rating"
          value={String(design.circuit.termination_rating_c)}
          onChange={(v) => updateCircuit({ termination_rating_c: Number(v) as 60 | 75 | 90 })}
          options={[
            { value: '60', label: '60 °C' },
            { value: '75', label: '75 °C (typical)' },
            { value: '90', label: '90 °C' },
          ]}
          hint="NEC 110.14(C) — read it off the equipment label."
        />
        {moduleCountTotal > 0 && design.circuit.modules_per_string !== null && design.circuit.strings_in_parallel !== null ? (
          <p
            className={`rounded border-l-2 px-2 py-1 text-xs ${
              design.circuit.modules_per_string * design.circuit.strings_in_parallel === moduleCountTotal
                ? 'border-emerald-600/60 bg-emerald-500/5 text-emerald-200/90'
                : 'border-amber-500/60 bg-amber-500/5 text-amber-200/90'
            }`}
          >
            {design.circuit.modules_per_string * design.circuit.strings_in_parallel === moduleCountTotal
              ? `Wiring accounts for all ${moduleCountTotal} modules.`
              : `${design.circuit.modules_per_string} × ${design.circuit.strings_in_parallel} = ${design.circuit.modules_per_string * design.circuit.strings_in_parallel} modules, but the array has ${moduleCountTotal}.`}
          </p>
        ) : null}
      </Section>

      <Section
        title="Service equipment"
        hint="Busbar rating and main breaker drive the NEC 705.12 interconnection check. Read them off the panel label, not the meter."
      >
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Service rating" unit="A" value={design.service.service_rating_a} onChange={(v) => updateService({ service_rating_a: v ?? 0 })} />
          <NumberField label="Busbar rating" unit="A" emphasis value={design.service.busbar_rating_a} onChange={(v) => updateService({ busbar_rating_a: v ?? 0 })} />
        </div>
        <NumberField label="Main breaker" unit="A" value={design.service.main_breaker_a} onChange={(v) => updateService({ main_breaker_a: v ?? 0 })} />
        <SelectField
          label="Interconnection method"
          value={design.service.interconnection}
          onChange={(v) => updateService({ interconnection: v as typeof design.service.interconnection })}
          options={[
            { value: 'load-side-breaker', label: 'Load-side breaker (705.12)' },
            { value: 'supply-side-tap', label: 'Supply-side tap (705.11)' },
            { value: 'pcs', label: 'Power control system (705.13)' },
            { value: 'feeder-tap', label: 'Feeder tap' },
          ]}
        />
        <Toggle
          label="Backfeed breaker at the opposite end of the busbar"
          checked={design.service.backfeed_at_opposite_end}
          onChange={(v) => updateService({ backfeed_at_opposite_end: v })}
          hint="Required to use the 120% rule."
        />
      </Section>
    </PanelBody>
  )
}

// ---------------------------------------------------------------------------

export function StoragePanel() {
  const design = useStore((s) => s.design)
  const setBattery = useStore((s) => s.setBattery)
  const setChargeController = useStore((s) => s.setChargeController)
  const loadDesign = useStore((s) => s.loadDesign)

  const battery = catalog.batteries.find((b) => b.id === design.battery_id)
  const cc = catalog.chargeControllers.find((c) => c.id === design.charge_controller_id)
  const offGrid = design.system_type.includes('off-grid')

  const totalKwh = battery ? battery.usable_capacity_kwh * design.battery_qty : 0
  const totalKw =
    battery && battery.max_continuous_discharge_kw !== null
      ? battery.max_continuous_discharge_kw * design.battery_qty
      : null

  return (
    <PanelBody>
      <Section title="Battery bank">
        <StatGrid>
          <Stat label="Usable capacity" value={fmt(totalKwh, { digits: 1, unit: 'kWh' })} />
          <Stat label="Continuous power" value={fmt(totalKw, { digits: 1, unit: 'kW' })} />
        </StatGrid>
        <SelectField
          label="Battery"
          value={design.battery_id ?? ''}
          onChange={(v) => setBattery(v || null, v ? Math.max(1, design.battery_qty) : 0)}
          options={[{ value: '', label: 'None' }, ...catalog.batteries.map((b) => ({
            value: b.id,
            label: `${b.manufacturer} ${b.model} — ${b.usable_capacity_kwh} kWh`,
          }))]}
          badge={<SourceInfo source={battery?.source} compact />}
        />
        {battery ? (
          <>
            <NumberField
              label="Quantity"
              min={1}
              max={battery.max_units_stackable ?? 40}
              value={design.battery_qty}
              onChange={(v) => setBattery(battery.id, Math.max(1, v ?? 1))}
              hint={
                battery.max_units_stackable !== null
                  ? `Manufacturer maximum ${battery.max_units_stackable} units`
                  : 'Stacking limit not published — confirm with the manufacturer'
              }
            />
            <Collapse summary="Listings and enclosure">
              <div className="space-y-1 text-xs text-slate-400">
                <p>Listings: {battery.listings.length ? battery.listings.join(', ') : 'none recorded'}</p>
                <p>Enclosure: {battery.enclosure_rating ?? '—'} ({battery.outdoor_rated === null ? 'outdoor rating unknown' : battery.outdoor_rated ? 'outdoor rated' : 'indoor only'})</p>
                <p>Coupling: {battery.coupling}</p>
                <p className="text-amber-300/80">
                  UL listings are manufacturer claims and were not verified against UL's
                  database. UL 9540 is usually a system listing for a specific
                  battery + inverter pairing.
                </p>
              </div>
            </Collapse>
          </>
        ) : null}
      </Section>

      {offGrid ? (
        <Section
          title="Charge controller"
          hint="Cold-temperature string Voc must stay under the controller's maximum PV input voltage. Exceeding it is the most common way to destroy an off-grid controller."
        >
          <SelectField
            label="Controller"
            value={design.charge_controller_id ?? ''}
            onChange={(v) => setChargeController(v || null, v ? Math.max(1, design.charge_controller_qty) : 0)}
            options={[{ value: '', label: 'None' }, ...catalog.chargeControllers.map((c) => ({
              value: c.id,
              label: `${c.manufacturer} ${c.model}`,
            }))]}
            badge={<SourceInfo source={cc?.source} compact />}
          />
          {cc ? (
            <NumberField label="Quantity" min={1} value={design.charge_controller_qty} onChange={(v) => setChargeController(cc.id, Math.max(1, v ?? 1))} />
          ) : null}
          <NumberField
            label="Days of autonomy"
            allowNull
            min={0}
            max={14}
            value={design.autonomy_days}
            onChange={(v) => loadDesign({ ...design, autonomy_days: v })}
            hint="How long the bank must carry the loads with no sun."
          />
        </Section>
      ) : (
        <Section title="Charge controller">
          <p className="text-xs text-slate-500">
            Select the <span className="text-slate-300">Off-grid</span> system type on the Site
            panel to size a charge controller and battery autonomy.
          </p>
        </Section>
      )}
    </PanelBody>
  )
}

// ---------------------------------------------------------------------------

export function EvPanel() {
  const design = useStore((s) => s.design)
  const setEvse = useStore((s) => s.setEvse)
  const updateService = useStore((s) => s.updateService)

  const toggle = (id: string) => {
    const next = design.evse_ids.includes(id)
      ? design.evse_ids.filter((x) => x !== id)
      : [...design.evse_ids, id]
    setEvse(next)
  }

  return (
    <PanelBody>
      <Section
        title="Existing load"
        hint="NEC 220.87 lets you use metered history instead of a calculated load. Pull the highest 15-minute demand from 12 months of utility interval data. The 30-day recording alternative is not available once the service has solar or a peak-shaving battery."
      >
        <NumberField
          label="12-month peak demand"
          unit="kW"
          allowNull
          emphasis
          step={0.1}
          value={design.service.peak_demand_kw}
          onChange={(v) => updateService({ peak_demand_kw: v })}
          nullPlaceholder="not supplied"
          hint="Leave empty if you don't have utility data."
        />
        <NumberField
          label="Conditioned floor area"
          unit="ft²"
          allowNull
          value={design.service.floor_area_sqft}
          onChange={(v) => updateService({ floor_area_sqft: v })}
        />
      </Section>

      <Section title="EV supply equipment">
        {catalog.evse.map((e) => {
          const on = design.evse_ids.includes(e.id)
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => toggle(e.id)}
              className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2 text-left ${
                on ? 'border-brand-500 bg-brand-600/15' : 'border-ink-700 bg-ink-800/50'
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">
                  {e.manufacturer} {e.model}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {e.max_output_a} A · {e.max_output_kw} kW · {e.connector} ·{' '}
                  {e.required_breaker_a} A breaker
                  {e.load_management ? ' · load managed' : ''}
                  <SourceInfo source={e.source} compact />
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-400">{on ? '✓' : '+'}</span>
            </button>
          )
        })}
        <p className="text-xs text-slate-500">
          An EVSE with automatic load management (NEC 625.42) is sized on its managed limit
          rather than nameplate — often the difference between fitting the existing service
          and needing an upgrade.
        </p>
      </Section>
    </PanelBody>
  )
}
