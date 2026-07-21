/**
 * Application state.
 *
 * One Zustand store holds the whole design. Derived values (code checks,
 * production, BOM) are computed by selectors rather than stored, so they can
 * never drift out of sync with the design.
 */

import { create } from 'zustand'
import type {
  Design,
  PvArray,
  RoofPlane,
  SiteConditions,
  StringConfig,
  SystemType,
} from './types'
import { catalog } from './catalog'

export type PanelId =
  | 'wizard'
  | 'site'
  | 'array'
  | 'electrical'
  | 'storage'
  | 'ev'
  | 'compliance'
  | 'bom'

function defaultSite(): SiteConditions {
  return {
    label: 'New site',
    latitude_deg: 39.74,
    longitude_deg: -104.99,
    elevation_m: 1609,
    timezone: 'America/Denver',
    // ASHRAE extreme minimum for Denver. Must be set per site — it drives
    // the 690.7 string voltage limit more than any other input.
    record_low_temp_c: -22,
    design_high_temp_c: 35,
    wind_speed_mph: 115,
    ground_snow_load_psf: 30,
    nec_edition: '2023',
  }
}

function defaultDesign(): Design {
  const now = new Date().toISOString()
  return {
    id: 'design-1',
    name: 'Untitled design',
    created: now,
    modified: now,
    site: defaultSite(),
    planes: [
      {
        id: 'plane-1',
        name: 'South roof',
        roof_type: 'comp-shingle',
        tilt_deg: 25,
        azimuth_deg: 180,
        polygon: [
          { x: 0, y: 0 },
          { x: 12, y: 0 },
          { x: 12, y: 7 },
          { x: 0, y: 7 },
        ],
        eave_height_m: 3,
      },
    ],
    arrays: [],
    strings: [],
    inverter_ids: [],
    battery_id: null,
    battery_qty: 0,
    charge_controller_id: null,
    charge_controller_qty: 0,
    evse_ids: [],
    service: {
      load_center_id: null,
      service_rating_a: 200,
      busbar_rating_a: 200,
      main_breaker_a: 200,
      backfeed_at_opposite_end: true,
      interconnection: 'load-side-breaker',
      peak_demand_kw: null,
      floor_area_sqft: 2200,
    },
    autonomy_days: null,
    system_type: ['grid-tie'],
  }
}

interface AppState {
  design: Design
  activePanel: PanelId
  selectedArrayId: string | null
  /** Hour of day (solar) driving the 3D sun position. */
  sunHour: number
  /** Day of year driving the 3D sun position. */
  sunDay: number
  showShadows: boolean
  showWiring: boolean

  setPanel: (p: PanelId) => void
  selectArray: (id: string | null) => void
  setSun: (day: number, hour: number) => void
  toggleShadows: () => void
  toggleWiring: () => void

  updateSite: (patch: Partial<SiteConditions>) => void
  updateService: (patch: Partial<Design['service']>) => void
  setSystemTypes: (types: SystemType[]) => void

  addPlane: (plane: RoofPlane) => void
  updatePlane: (id: string, patch: Partial<RoofPlane>) => void
  removePlane: (id: string) => void

  addArray: (array: PvArray) => void
  updateArray: (id: string, patch: Partial<PvArray>) => void
  removeArray: (id: string) => void
  toggleModule: (arrayId: string, row: number, col: number) => void

  setInverters: (ids: string[]) => void
  setStrings: (strings: StringConfig[]) => void
  setBattery: (id: string | null, qty: number) => void
  setChargeController: (id: string | null, qty: number) => void
  setEvse: (ids: string[]) => void

  loadDesign: (d: Design) => void
  resetDesign: () => void
}

const touch = (d: Design): Design => ({ ...d, modified: new Date().toISOString() })

export const useStore = create<AppState>((set) => ({
  design: defaultDesign(),
  // Land on the guided sizing flow — most people arrive not knowing what they
  // need, and an empty design with seven expert tabs is a dead end.
  activePanel: 'wizard',
  selectedArrayId: null,
  sunHour: 12,
  sunDay: 172,
  showShadows: true,
  showWiring: false,

  setPanel: (p) => set({ activePanel: p }),
  selectArray: (id) => set({ selectedArrayId: id }),
  setSun: (sunDay, sunHour) => set({ sunDay, sunHour }),
  toggleShadows: () => set((s) => ({ showShadows: !s.showShadows })),
  toggleWiring: () => set((s) => ({ showWiring: !s.showWiring })),

  updateSite: (patch) =>
    set((s) => ({ design: touch({ ...s.design, site: { ...s.design.site, ...patch } }) })),

  updateService: (patch) =>
    set((s) => ({
      design: touch({ ...s.design, service: { ...s.design.service, ...patch } }),
    })),

  setSystemTypes: (system_type) =>
    set((s) => ({ design: touch({ ...s.design, system_type }) })),

  addPlane: (plane) =>
    set((s) => ({ design: touch({ ...s.design, planes: [...s.design.planes, plane] }) })),

  updatePlane: (id, patch) =>
    set((s) => ({
      design: touch({
        ...s.design,
        planes: s.design.planes.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }),
    })),

  removePlane: (id) =>
    set((s) => ({
      design: touch({
        ...s.design,
        planes: s.design.planes.filter((p) => p.id !== id),
        // Arrays are meaningless without their plane.
        arrays: s.design.arrays.filter((a) => a.plane_id !== id),
        strings: s.design.strings.filter((st) =>
          s.design.arrays.some((a) => a.id === st.array_id && a.plane_id !== id),
        ),
      }),
    })),

  addArray: (array) =>
    set((s) => ({ design: touch({ ...s.design, arrays: [...s.design.arrays, array] }) })),

  updateArray: (id, patch) =>
    set((s) => ({
      design: touch({
        ...s.design,
        arrays: s.design.arrays.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }),
    })),

  removeArray: (id) =>
    set((s) => ({
      design: touch({
        ...s.design,
        arrays: s.design.arrays.filter((a) => a.id !== id),
        strings: s.design.strings.filter((st) => st.array_id !== id),
      }),
    })),

  toggleModule: (arrayId, row, col) =>
    set((s) => ({
      design: touch({
        ...s.design,
        arrays: s.design.arrays.map((a) =>
          a.id !== arrayId
            ? a
            : {
                ...a,
                module_positions: a.module_positions.map((m) =>
                  m.row === row && m.col === col ? { ...m, enabled: !m.enabled } : m,
                ),
              },
        ),
      }),
    })),

  setInverters: (inverter_ids) =>
    set((s) => ({ design: touch({ ...s.design, inverter_ids }) })),

  setStrings: (strings) => set((s) => ({ design: touch({ ...s.design, strings }) })),

  setBattery: (battery_id, battery_qty) =>
    set((s) => ({ design: touch({ ...s.design, battery_id, battery_qty }) })),

  setChargeController: (charge_controller_id, charge_controller_qty) =>
    set((s) => ({
      design: touch({ ...s.design, charge_controller_id, charge_controller_qty }),
    })),

  setEvse: (evse_ids) => set((s) => ({ design: touch({ ...s.design, evse_ids }) })),

  loadDesign: (design) => set({ design }),
  resetDesign: () => set({ design: defaultDesign(), selectedArrayId: null }),
}))

// ---------------------------------------------------------------------------
// Derived helpers used across panels
// ---------------------------------------------------------------------------

/** Count of enabled modules in an array. */
export function moduleCount(array: PvArray): number {
  return array.module_positions.filter((m) => m.enabled).length
}

/** Array DC nameplate in watts. */
export function arrayDcWatts(array: PvArray): number {
  const mod = catalog.modules.find((m) => m.id === array.module_id)
  return mod ? mod.pmax_w * moduleCount(array) : 0
}

/** Whole-system DC nameplate in watts. */
export function systemDcWatts(design: Design): number {
  return design.arrays.reduce((sum, a) => sum + arrayDcWatts(a), 0)
}

/** Whole-system AC nameplate in watts. */
export function systemAcWatts(design: Design): number {
  return design.inverter_ids.reduce((sum, id) => {
    const inv = catalog.inverters.find((i) => i.id === id)
    return sum + (inv?.rated_ac_power_w ?? 0)
  }, 0)
}

/** Build a full grid of module positions for a new array. */
export function makeModulePositions(rows: number, cols: number) {
  const out: PvArray['module_positions'] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) out.push({ row, col, enabled: true })
  }
  return out
}
