/**
 * Domain model for SolarForge.
 *
 * Units are SI unless a field name says otherwise. Electrical fields use the
 * conventional units a datasheet prints: volts, amps, watts, ohms, degrees C.
 *
 * Catalog part specs mirror manufacturer datasheets. Any spec we could not
 * verify from a datasheet is `null` rather than guessed — the NEC engine
 * refuses to calculate on a null and surfaces it to the user instead.
 */

// ---------------------------------------------------------------------------
// Catalog: PV modules
// ---------------------------------------------------------------------------

export type CellTech = 'TOPCon' | 'HJT' | 'PERC' | 'IBC' | 'CdTe' | 'unknown'

export interface PvModule {
  id: string
  manufacturer: string
  model: string
  /** Marketing series name, e.g. "Q.TRON BLK M-G2+". */
  series?: string

  /** Nameplate power at STC, watts. */
  pmax_w: number
  efficiency_pct: number | null

  // STC electrical
  vmp_v: number
  imp_a: number
  voc_v: number
  isc_a: number

  /** Temperature coefficients, percent per degree C. Voc is negative. */
  temp_coeff_pmax_pct_per_c: number | null
  temp_coeff_voc_pct_per_c: number | null
  temp_coeff_isc_pct_per_c: number | null

  /** Nominal operating cell temp (NOCT/NMOT), degrees C. */
  noct_c: number | null

  /** NEC 690.9(B) series overcurrent rating printed on the module label. */
  max_series_fuse_a: number | null
  max_system_voltage_v: number | null

  length_mm: number
  width_mm: number
  thickness_mm: number | null
  weight_kg: number | null

  cell_tech: CellTech
  cell_count: number | null
  bifacial: boolean
  /** Bifaciality factor 0..1, only meaningful when `bifacial`. */
  bifaciality: number | null

  warranty_product_yr: number | null
  warranty_performance_yr: number | null

  price_usd_per_w: number | null

  /** Provenance so the UI can show where a spec came from. */
  source?: SourceRef
}

// ---------------------------------------------------------------------------
// Catalog: inverters
// ---------------------------------------------------------------------------

export type InverterCategory = 'string' | 'micro' | 'hybrid' | 'offgrid'

export interface MpptChannel {
  /** Operating window in which the MPPT will track. */
  v_min_v: number
  v_max_v: number
  max_input_current_a: number | null
  max_short_circuit_current_a: number | null
}

export interface Inverter {
  id: string
  manufacturer: string
  model: string
  category: InverterCategory

  // AC side
  rated_ac_power_w: number
  max_ac_current_a: number | null
  /** Nominal AC service voltages the unit supports, e.g. [240] or [208, 240]. */
  ac_voltage_v: number[]
  phase: 1 | 3

  // DC side
  max_dc_input_power_w: number | null
  /** Absolute ceiling — NEC 690.7 corrected Voc must stay under this. */
  max_dc_input_voltage_v: number | null
  mppt_start_voltage_v: number | null
  mppt_count: number | null
  mppts: MpptChannel[]

  cec_efficiency_pct: number | null
  peak_efficiency_pct: number | null

  // Microinverter-specific
  micro_max_module_pmax_w?: number | null
  micro_module_voc_range_v?: [number, number] | null
  micro_max_units_per_branch?: number | null
  micro_branch_ocpd_a?: number | null

  // Hybrid / storage-specific
  battery_voltage_range_v?: [number, number] | null
  max_charge_current_a?: number | null
  max_discharge_current_a?: number | null
  /** Can it island and back up loads during an outage? */
  backup_capable?: boolean
  /** Max current that can pass through the unit from the grid, amps. */
  pass_through_current_a?: number | null
  ac_coupling_capable?: boolean
  generator_input_capable?: boolean

  // Code / listing
  rapid_shutdown: 'integrated' | 'requires-external' | 'not-applicable' | null
  ul1741_edition: string | null
  integrated_dc_disconnect: boolean | null
  integrated_afci: boolean | null

  warranty_yr: number | null
  price_usd: number | null
  source?: SourceRef
}

// ---------------------------------------------------------------------------
// Catalog: storage
// ---------------------------------------------------------------------------

export type Chemistry = 'LFP' | 'NMC' | 'lead-acid' | 'other'
export type Coupling = 'DC' | 'AC' | 'both'

export interface Battery {
  id: string
  manufacturer: string
  model: string
  chemistry: Chemistry

  nominal_voltage_v: number
  usable_capacity_kwh: number
  total_capacity_kwh: number | null

  max_continuous_discharge_kw: number | null
  max_continuous_discharge_a: number | null
  peak_power_kw: number | null
  peak_duration_s: number | null
  max_charge_current_a: number | null

  round_trip_efficiency_pct: number | null
  coupling: Coupling
  max_units_stackable: number | null

  operating_temp_min_c: number | null
  operating_temp_max_c: number | null

  /** UL 9540 (system), UL 9540A (thermal runaway test), UL 1973 (cell). */
  listings: string[]
  /** NEMA/IP enclosure rating; drives indoor vs outdoor placement. */
  enclosure_rating: string | null
  outdoor_rated: boolean | null

  width_mm: number | null
  height_mm: number | null
  depth_mm: number | null
  weight_kg: number | null

  warranty_yr: number | null
  warranty_throughput_mwh: number | null
  price_usd: number | null
  source?: SourceRef
}

export interface ChargeController {
  id: string
  manufacturer: string
  model: string
  type: 'MPPT' | 'PWM'

  /** NEC 690.7 corrected Voc must stay under this. */
  max_pv_input_voltage_v: number
  max_charge_current_a: number
  /** Max PV array watts keyed by battery bank nominal voltage. */
  max_pv_power_w_by_battery_v: Record<string, number>
  battery_voltages_v: number[]
  efficiency_pct: number | null
  price_usd: number | null
  source?: SourceRef
}

// ---------------------------------------------------------------------------
// Catalog: mounting
// ---------------------------------------------------------------------------

export type RoofType =
  | 'comp-shingle'
  | 'tile'
  | 'standing-seam-metal'
  | 'corrugated-metal'
  | 'flat-membrane'
  | 'ground'

export type MountKind = 'roof' | 'ground-fixed' | 'pole' | 'tracker'

export interface Mount {
  id: string
  manufacturer: string
  product_line: string
  kind: MountKind
  roof_types: RoofType[]

  /** Tracking axes; 0 for fixed tilt. */
  tracking_axes: 0 | 1 | 2
  /** Rotation limit from horizontal for trackers, degrees. */
  tracking_range_deg: number | null
  backtracking: boolean | null

  tilt_min_deg: number | null
  tilt_max_deg: number | null

  max_rail_span_mm: number | null
  max_cantilever_mm: number | null
  /** Which ASCE 7 edition the load tables are based on. */
  load_basis: string | null
  ul2703_listed: boolean | null
  /** Integrated bonding means no separate WEEBs/lugs per module. */
  integrated_bonding: boolean | null

  modules_per_table: number | null
  foundation: string | null

  cost_usd_per_module: number | null
  cost_usd_per_w: number | null
  source?: SourceRef
}

// ---------------------------------------------------------------------------
// Catalog: EV charging
// ---------------------------------------------------------------------------

export type EvConnector = 'NACS' | 'J1772' | 'dual'

export interface Evse {
  id: string
  manufacturer: string
  model: string
  connector: EvConnector

  max_output_a: number
  max_output_kw: number
  /** Amperage settings the installer can dial in via DIP/app. */
  adjustable_output_a: number[]
  /** NEC 625.41: OCPD >= 125% of continuous EVSE rating. */
  required_breaker_a: number

  hardwired: boolean
  plug_type: string | null
  nema_rating: string | null
  indoor_outdoor: 'indoor' | 'outdoor' | 'both'

  /** NEC 625.42/625.43 automatic load management. Lets you skip a service upgrade. */
  load_management: boolean
  bidirectional_v2h: boolean
  solar_excess_charging: boolean

  ul_listed: boolean | null
  price_usd: number | null
  source?: SourceRef
}

// ---------------------------------------------------------------------------
// Catalog: balance of system
// ---------------------------------------------------------------------------

export type BosCategory =
  | 'wire'
  | 'conduit'
  | 'connector'
  | 'combiner'
  | 'disconnect'
  | 'ocpd'
  | 'load-center'
  | 'monitoring'
  | 'grounding'
  | 'rapid-shutdown'
  | 'label'
  | 'misc'

export interface BosPart {
  id: string
  category: BosCategory
  manufacturer: string | null
  model: string | null
  description: string
  /** 'ea' | 'ft' | 'roll' — how the part is purchased and counted. */
  unit: string
  price_usd: number | null
  /** Free-form ratings: ampacity, voltage, NEMA type, AWG, etc. */
  specs: Record<string, string | number | boolean | null>
  source?: SourceRef
}

export interface LoadCenter {
  id: string
  manufacturer: string
  model: string
  /** NEC 705.12(B)(3)(2): the 120% rule is computed against this. */
  busbar_rating_a: number
  main_breaker_a: number | null
  spaces: number | null
  /** 705.12(B)(3)(2) requires the backfeed breaker at the opposite end of the feed. */
  center_fed: boolean
  supports_whole_home_backup: boolean | null
  price_usd: number | null
  source?: SourceRef
}

export interface SourceRef {
  url: string
  retrieved: string
  /** How much we trust the numbers we pulled. Shown in the UI. */
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

// ---------------------------------------------------------------------------
// Project / design model
// ---------------------------------------------------------------------------

export interface SiteConditions {
  label: string
  latitude_deg: number
  longitude_deg: number
  /** Degrees from true north the array faces; 180 = due south. */
  elevation_m: number
  timezone: string

  /**
   * NEC 690.7: extreme minimum design dry-bulb temperature (ASHRAE 0.4%).
   * Drives the cold-temperature Voc correction. This is the single most
   * important site input for string sizing.
   */
  record_low_temp_c: number
  /** ASHRAE 2% design dry-bulb, used for ampacity correction (310.15(B)(1)). */
  design_high_temp_c: number

  /** Structural design inputs for mount selection. */
  wind_speed_mph: number | null
  ground_snow_load_psf: number | null

  /** Which code cycle the AHJ enforces. Changes several rules. */
  nec_edition: '2017' | '2020' | '2023'
}

export interface RoofPlane {
  id: string
  name: string
  roof_type: RoofType
  /** Degrees from horizontal. */
  tilt_deg: number
  /** Degrees clockwise from true north; 180 = due south. */
  azimuth_deg: number
  /** Plan-view outline in metres, local site coordinates. */
  polygon: Array<{ x: number; y: number }>
  /** Height of the plane's low edge above grade, metres. */
  eave_height_m: number
}

export type ArrayLayoutMode = 'portrait' | 'landscape'

export interface PvArray {
  id: string
  name: string
  plane_id: string
  module_id: string
  mount_id: string
  layout: ArrayLayoutMode
  rows: number
  cols: number
  /** Module positions in plane-local metres, so deleted modules leave gaps. */
  module_positions: Array<{ row: number; col: number; enabled: boolean }>
  /** Centre-to-centre row pitch for ground mounts, metres. */
  row_pitch_m: number | null
  /** Fixed-tilt override for ground mounts. */
  tilt_deg: number | null
  azimuth_deg: number | null
}

export interface StringConfig {
  id: string
  array_id: string
  inverter_id: string
  mppt_index: number
  modules_per_string: number
  strings_in_parallel: number
}

export interface Design {
  id: string
  name: string
  created: string
  modified: string
  site: SiteConditions
  planes: RoofPlane[]
  arrays: PvArray[]
  strings: StringConfig[]
  inverter_ids: string[]
  battery_id: string | null
  battery_qty: number
  charge_controller_id: string | null
  charge_controller_qty: number
  evse_ids: string[]
  service: ServiceEquipment
  /** Off-grid autonomy target; null for grid-tied designs. */
  autonomy_days: number | null
  system_type: SystemType[]
}

export type SystemType =
  | 'grid-tie'
  | 'hybrid-storage'
  | 'off-grid'
  | 'ground-mount'
  | 'tracker'
  | 'ev-charging'

export interface ServiceEquipment {
  load_center_id: string | null
  /** Utility service rating, amps. */
  service_rating_a: number
  busbar_rating_a: number
  main_breaker_a: number
  /** NEC 705.12(B)(3)(2) requires opposite-end backfeed on a 120% design. */
  backfeed_at_opposite_end: boolean
  interconnection: 'load-side-breaker' | 'supply-side-tap' | 'pcs' | 'feeder-tap'
  /**
   * Existing-dwelling load calc input: highest 15-min demand over the last
   * 12 months in kW (NEC 220.87). Null forces the 220.83 method instead.
   */
  peak_demand_kw: number | null
  /** Conditioned floor area, ft^2 — NEC 220.82/220.83 general lighting load. */
  floor_area_sqft: number | null
}

// ---------------------------------------------------------------------------
// Calculation results
// ---------------------------------------------------------------------------

export type Severity = 'pass' | 'warn' | 'fail' | 'unknown'

/** One code check, with the citation that backs it. */
export interface CodeCheck {
  id: string
  /** e.g. "NEC 690.7(A)" */
  citation: string
  title: string
  severity: Severity
  /** Human-readable statement of what was computed. */
  detail: string
  /** Shown when severity is warn/fail. */
  remedy?: string
  /** Intermediate values, so a plan reviewer can follow the arithmetic. */
  values?: Record<string, number | string | null>
}

export interface ConductorSpec {
  awg: string
  material: 'Cu' | 'Al'
  insulation: string
  /** Ampacity after temperature and conduit-fill derates. */
  derated_ampacity_a: number
  base_ampacity_a: number
  temp_correction_factor: number
  fill_adjustment_factor: number
  /** Termination-limited ampacity per 110.14(C). */
  termination_limit_a: number
  ocpd_a: number
  egc_awg: string
  length_ft: number
  voltage_drop_pct: number
  voltage_drop_v: number
}
