/**
 * NEC calculation engine.
 *
 * Each exported function returns both a numeric result and the CodeCheck
 * records that justify it, so a plan reviewer can follow every step. Nothing
 * rounds silently: intermediate values are reported.
 *
 * Table data comes from ./tables, which carries verification status. Results
 * that lean on an unverified table say so.
 */

import type { CodeCheck, ConductorSpec, PvModule, Inverter } from '../types'
import {
  AMPACITY_310_16,
  CONDUCTOR_SIZES,
  RESISTANCE_OHMS_PER_KFT,
  SMALL_CONDUCTOR_OCPD_LIMIT,
  conduitFillAdjustment,
  egcSize,
  nextStandardOcpd,
  rooftopTempAdder,
  tempCorrectionFactor,
  type ConductorMaterial,
  type ConductorSize,
  type TempRating,
} from './tables'

// ---------------------------------------------------------------------------
// 690.7 — Maximum voltage
// ---------------------------------------------------------------------------

export interface VocCorrectionResult {
  /** Per-module Voc at the record low temperature. */
  corrected_voc_per_module_v: number
  voc_stc_v: number
  record_low_temp_c: number
  /** Ratio of corrected to STC Voc, for sanity checking against Table 690.7(A). */
  correction_factor: number
  checks: CodeCheck[]
}

/**
 * NEC 690.7(A) cold-temperature Voc correction, manufacturer-coefficient
 * method:
 *
 *   Voc(cold) = Voc(STC) x [1 + beta_Voc x (T_min - 25)]
 *
 * where beta_Voc is the module's Voc temperature coefficient in %/degC
 * (negative), and T_min is the ASHRAE extreme annual mean minimum design
 * dry-bulb temperature for the site.
 *
 * We use this rather than Table 690.7(A) because the coefficient comes off the
 * module datasheet and is independently verifiable — see tables.ts for why the
 * table itself is not populated.
 */
export function correctedVoc(
  module: PvModule,
  record_low_temp_c: number,
): VocCorrectionResult {
  const checks: CodeCheck[] = []
  const beta = module.temp_coeff_voc_pct_per_c

  if (beta === null) {
    checks.push({
      id: 'voc-no-coefficient',
      citation: 'NEC 690.7(A)',
      title: 'Module Voc temperature coefficient missing',
      severity: 'unknown',
      detail:
        `No Voc temperature coefficient on file for ${module.manufacturer} ` +
        `${module.model}, so the cold-temperature correction cannot be computed.`,
      remedy:
        'Enter the Voc temperature coefficient (%/degC) from the module ' +
        'datasheet, or supply Table 690.7(A) multipliers from your code book.',
    })
    return {
      corrected_voc_per_module_v: NaN,
      voc_stc_v: module.voc_v,
      record_low_temp_c,
      correction_factor: NaN,
      checks,
    }
  }

  const factor = 1 + (beta / 100) * (record_low_temp_c - 25)
  const corrected = module.voc_v * factor

  checks.push({
    id: 'voc-correction',
    citation: 'NEC 690.7(A)',
    title: 'Cold-temperature Voc correction',
    severity: 'pass',
    detail:
      `Voc ${module.voc_v} V x [1 + (${beta} %/degC / 100) x ` +
      `(${record_low_temp_c} degC - 25 degC)] = ${corrected.toFixed(2)} V per module.`,
    values: {
      voc_stc_v: module.voc_v,
      temp_coeff_pct_per_c: beta,
      record_low_temp_c,
      correction_factor: Number(factor.toFixed(4)),
      corrected_voc_v: Number(corrected.toFixed(2)),
    },
  })

  return {
    corrected_voc_per_module_v: corrected,
    voc_stc_v: module.voc_v,
    record_low_temp_c,
    correction_factor: factor,
    checks,
  }
}

export interface StringSizingResult {
  max_modules_per_string: number
  min_modules_per_string: number
  corrected_voc_per_module_v: number
  vmp_hot_per_module_v: number
  /** System voltage ceiling actually applied, volts. */
  voltage_limit_v: number
  checks: CodeCheck[]
}

export interface StringSizingInput {
  module: PvModule
  inverter: Inverter
  record_low_temp_c: number
  /** Expected max cell temperature; drives the low end of the MPPT window. */
  max_cell_temp_c: number
  /**
   * 600 V for one- and two-family dwellings, 1000 V otherwise (NEC 690.7(B)).
   * The inverter's own max DC input voltage usually governs instead.
   */
  occupancy: 'dwelling' | 'other'
}

/**
 * Longest and shortest permitted series string.
 *
 * Upper bound: corrected Voc x N must stay at or below the *lower* of the
 * inverter's max DC input voltage and the 690.7(B) occupancy ceiling.
 *
 * Lower bound: Vmp at the hottest expected cell temperature x N must stay at
 * or above the inverter's minimum MPPT tracking voltage, otherwise the array
 * drops out of tracking on hot afternoons. This is an operational limit, not a
 * code limit, but leaving it out is the classic way to design a system that
 * passes inspection and underproduces all summer.
 */
export function sizeString(input: StringSizingInput): StringSizingResult {
  const { module, inverter, record_low_temp_c, max_cell_temp_c, occupancy } =
    input
  const checks: CodeCheck[] = []

  const voc = correctedVoc(module, record_low_temp_c)
  checks.push(...voc.checks)

  const occupancyLimit = occupancy === 'dwelling' ? 600 : 1000
  const inverterLimit = inverter.max_dc_input_voltage_v ?? Infinity
  const limit = Math.min(occupancyLimit, inverterLimit, module.max_system_voltage_v ?? Infinity)

  checks.push({
    id: 'voltage-ceiling',
    citation: 'NEC 690.7(B)',
    title: 'System voltage ceiling',
    severity: 'pass',
    detail:
      `Applying the lowest of: occupancy limit ${occupancyLimit} V, ` +
      `inverter max DC input ${inverter.max_dc_input_voltage_v ?? 'n/a'} V, ` +
      `module max system voltage ${module.max_system_voltage_v ?? 'n/a'} V ` +
      `= ${limit} V.`,
    values: {
      occupancy_limit_v: occupancyLimit,
      inverter_limit_v: inverter.max_dc_input_voltage_v,
      module_limit_v: module.max_system_voltage_v,
      applied_limit_v: limit,
    },
  })

  const maxModules = Number.isFinite(voc.corrected_voc_per_module_v)
    ? Math.floor(limit / voc.corrected_voc_per_module_v)
    : 0

  // Vmp falls with heat using the Pmax coefficient as a proxy when a dedicated
  // Vmp coefficient is not published (most datasheets omit it).
  const vmpCoeff =
    module.temp_coeff_voc_pct_per_c ?? module.temp_coeff_pmax_pct_per_c ?? null
  const vmpHot =
    vmpCoeff === null
      ? NaN
      : module.vmp_v * (1 + (vmpCoeff / 100) * (max_cell_temp_c - 25))

  const mpptMin = inverter.mppt_start_voltage_v ?? inverter.mppts[0]?.v_min_v ?? null
  const minModules =
    mpptMin === null || !Number.isFinite(vmpHot)
      ? 0
      : Math.ceil(mpptMin / vmpHot)

  if (maxModules > 0) {
    checks.push({
      id: 'string-max',
      citation: 'NEC 690.7',
      title: 'Maximum modules per series string',
      severity: 'pass',
      detail:
        `floor(${limit} V / ${voc.corrected_voc_per_module_v.toFixed(2)} V) = ` +
        `${maxModules} modules. String Voc at record low = ` +
        `${(maxModules * voc.corrected_voc_per_module_v).toFixed(1)} V.`,
      values: {
        max_modules: maxModules,
        string_voc_cold_v: Number(
          (maxModules * voc.corrected_voc_per_module_v).toFixed(1),
        ),
      },
    })
  }

  if (minModules > 0 && maxModules > 0 && minModules > maxModules) {
    checks.push({
      id: 'string-window-empty',
      citation: 'NEC 690.7 / inverter MPPT window',
      title: 'No valid string length',
      severity: 'fail',
      detail:
        `Minimum ${minModules} modules (to stay in the MPPT window at ` +
        `${max_cell_temp_c} degC) exceeds the maximum ${maxModules} modules ` +
        `(voltage ceiling at ${record_low_temp_c} degC).`,
      remedy:
        'Pick a different module/inverter pairing, or an inverter with a ' +
        'wider DC input range.',
    })
  }

  return {
    max_modules_per_string: maxModules,
    min_modules_per_string: minModules,
    corrected_voc_per_module_v: voc.corrected_voc_per_module_v,
    vmp_hot_per_module_v: vmpHot,
    voltage_limit_v: limit,
    checks,
  }
}

// ---------------------------------------------------------------------------
// 690.8 — Circuit current and conductor sizing
// ---------------------------------------------------------------------------

export interface MaxCircuitCurrentResult {
  /** 690.8(A): Isc x 1.25, amps. */
  max_circuit_current_a: number
  /** 690.8(B): a further x 1.25 for continuous duty. Total 156.25% of Isc. */
  minimum_conductor_ampacity_a: number
  checks: CodeCheck[]
}

/**
 * NEC 690.8(A)(1) maximum circuit current for a PV source circuit, and the
 * 690.8(B)(1) conductor ampacity floor.
 *
 * The two 1.25 factors compound: 1.25 x 1.25 = 1.5625, the familiar "156%".
 * The first accounts for irradiance above 1000 W/m^2; the second is the
 * ordinary continuous-load factor.
 */
export function maxCircuitCurrent(
  module: PvModule,
  strings_in_parallel: number,
): MaxCircuitCurrentResult {
  const checks: CodeCheck[] = []

  const arrayIsc = module.isc_a * strings_in_parallel
  const maxCurrent = arrayIsc * 1.25
  const minAmpacity = maxCurrent * 1.25

  checks.push({
    id: 'max-circuit-current',
    citation: 'NEC 690.8(A)(1)',
    title: 'Maximum circuit current',
    severity: 'pass',
    detail:
      `${module.isc_a} A Isc x ${strings_in_parallel} parallel string(s) x 1.25 ` +
      `= ${maxCurrent.toFixed(2)} A.`,
    values: {
      module_isc_a: module.isc_a,
      strings_in_parallel,
      max_circuit_current_a: Number(maxCurrent.toFixed(2)),
    },
  })

  checks.push({
    id: 'conductor-ampacity-floor',
    citation: 'NEC 690.8(B)(1)',
    title: 'Minimum conductor ampacity before derating',
    severity: 'pass',
    detail:
      `${maxCurrent.toFixed(2)} A x 1.25 (continuous duty) = ` +
      `${minAmpacity.toFixed(2)} A. This is 156.25% of array Isc.`,
    values: {
      max_circuit_current_a: Number(maxCurrent.toFixed(2)),
      minimum_ampacity_a: Number(minAmpacity.toFixed(2)),
    },
  })

  return {
    max_circuit_current_a: maxCurrent,
    minimum_conductor_ampacity_a: minAmpacity,
    checks,
  }
}

export interface ConductorSizingInput {
  /** Continuous-duty ampacity the conductor must carry after derates. */
  required_ampacity_a: number
  /** Current used for OCPD selection and voltage drop, amps. */
  circuit_current_a: number
  material: ConductorMaterial
  insulation_rating: TempRating
  insulation_name: string
  ambient_c: number
  current_carrying_conductors: number
  /** One-way circuit length, feet. */
  length_ft: number
  system_voltage_v: number
  phase: 1 | 3
  /** Terminal rating of the equipment at each end (110.14(C)). */
  termination_rating: TempRating
  /** Rooftop conduit adder inputs; omit for non-rooftop runs. */
  rooftop?: {
    edition: '2017' | '2020' | '2023'
    height_above_roof_mm: number
  }
  /** Design target for voltage drop, percent. Not a code limit. */
  max_voltage_drop_pct?: number
}

export interface ConductorSizingResult {
  spec: ConductorSpec | null
  checks: CodeCheck[]
}

/**
 * Pick the smallest conductor that satisfies, in order:
 *   1. 690.8(B)/210.19 ampacity after temperature and fill derates
 *   2. 110.14(C) termination temperature limit
 *   3. the voltage drop design target
 *
 * Returns null when no listed size in the table works.
 */
export function sizeConductor(
  input: ConductorSizingInput,
): ConductorSizingResult {
  const checks: CodeCheck[] = []
  const {
    required_ampacity_a,
    circuit_current_a,
    material,
    insulation_rating,
    insulation_name,
    ambient_c,
    current_carrying_conductors,
    length_ft,
    system_voltage_v,
    phase,
    termination_rating,
    rooftop,
    max_voltage_drop_pct = 3,
  } = input

  // Rooftop conduit in sunlight runs hotter than the ambient air.
  const adder = rooftop
    ? rooftopTempAdder(
        rooftop.edition,
        rooftop.height_above_roof_mm,
        insulation_name,
      )
    : 0
  const effectiveAmbient = ambient_c + adder

  if (adder > 0) {
    checks.push({
      id: 'rooftop-adder',
      citation: 'NEC 310.15(B)(2)',
      title: 'Rooftop conduit temperature adder',
      severity: 'warn',
      detail:
        `Conduit ${rooftop!.height_above_roof_mm} mm above the roof in sunlight: ` +
        `+${adder} degC applied, giving ${effectiveAmbient} degC design ambient.`,
      remedy:
        'Raise the conduit above 900 mm, or use XHHW-2, to drop the adder. ' +
        'Verify this rule against your AHJ code cycle — see VERIFICATION.md.',
      values: { adder_c: adder, effective_ambient_c: effectiveAmbient },
    })
  }

  const tcf = tempCorrectionFactor(effectiveAmbient, insulation_rating)
  if (tcf === null) {
    checks.push({
      id: 'ambient-too-hot',
      citation: 'NEC Table 310.15(B)(1)(1)',
      title: 'Ambient exceeds insulation rating',
      severity: 'fail',
      detail:
        `${effectiveAmbient} degC is beyond the correction table for ` +
        `${insulation_rating} degC insulation.`,
      remedy: 'Use a higher-temperature insulation, or reroute the conduit.',
    })
    return { spec: null, checks }
  }

  const fillAdj = conduitFillAdjustment(current_carrying_conductors)

  checks.push({
    id: 'derates',
    citation: 'NEC 310.15(B)(1) / 310.15(C)(1)',
    title: 'Ampacity derating factors',
    severity: 'pass',
    detail:
      `Temperature correction ${tcf} at ${effectiveAmbient} degC; ` +
      `fill adjustment ${fillAdj} for ${current_carrying_conductors} ` +
      `current-carrying conductors. Combined ${(tcf * fillAdj).toFixed(3)}.`,
    values: {
      temp_correction: tcf,
      fill_adjustment: fillAdj,
      combined: Number((tcf * fillAdj).toFixed(3)),
    },
  })

  const ocpd = nextStandardOcpd(circuit_current_a)
  if (ocpd === null) {
    checks.push({
      id: 'ocpd-too-large',
      citation: 'NEC 240.6(A)',
      title: 'No standard OCPD large enough',
      severity: 'fail',
      detail: `${circuit_current_a.toFixed(1)} A exceeds the largest tabulated rating.`,
    })
    return { spec: null, checks }
  }

  const ampacityTable = AMPACITY_310_16[material]
  const resistanceTable = RESISTANCE_OHMS_PER_KFT[material]

  for (const size of CONDUCTOR_SIZES) {
    const base = ampacityTable[insulation_rating][size]
    if (base === undefined) continue

    const derated = base * tcf * fillAdj
    if (derated < required_ampacity_a) continue

    // 110.14(C): the conductor may not be loaded beyond what its terminations
    // are rated for, regardless of how good the insulation is.
    const terminationAmpacity = ampacityTable[termination_rating][size]
    if (terminationAmpacity === undefined) continue
    if (terminationAmpacity < circuit_current_a) continue

    // 240.4(D) small-conductor OCPD cap.
    const smallCap = SMALL_CONDUCTOR_OCPD_LIMIT[material]?.[size]
    if (smallCap !== undefined && ocpd > smallCap) continue

    const rPerKft = resistanceTable[size]
    if (rPerKft === undefined) continue

    // Vd = 2 x I x R x L for single phase; sqrt(3) replaces the 2 for 3-phase.
    const multiplier = phase === 3 ? Math.sqrt(3) : 2
    const vd = (multiplier * circuit_current_a * rPerKft * length_ft) / 1000
    const vdPct = (vd / system_voltage_v) * 100
    if (vdPct > max_voltage_drop_pct) continue

    const egc = egcSize(ocpd, material)

    checks.push({
      id: 'conductor-selected',
      citation: 'NEC 310.16 / 110.14(C) / 240.4',
      title: 'Conductor selected',
      severity: 'pass',
      detail:
        `${size} AWG/kcmil ${material} ${insulation_name}: ` +
        `${base} A base x ${tcf} x ${fillAdj} = ${derated.toFixed(1)} A derated ` +
        `(need ${required_ampacity_a.toFixed(1)} A). ` +
        `Termination limit ${terminationAmpacity} A at ${termination_rating} degC. ` +
        `Voltage drop ${vdPct.toFixed(2)}% over ${length_ft} ft.`,
      values: {
        size,
        base_ampacity_a: base,
        derated_ampacity_a: Number(derated.toFixed(1)),
        termination_limit_a: terminationAmpacity,
        ocpd_a: ocpd,
        voltage_drop_pct: Number(vdPct.toFixed(2)),
      },
    })

    if (egc === null) {
      checks.push({
        id: 'egc-unavailable',
        citation: 'NEC Table 250.122',
        title: 'EGC size not tabulated',
        severity: 'warn',
        detail: `No EGC listed for a ${ocpd} A device in ${material}.`,
      })
    }

    return {
      spec: {
        awg: size,
        material,
        insulation: insulation_name,
        derated_ampacity_a: Number(derated.toFixed(1)),
        base_ampacity_a: base,
        temp_correction_factor: tcf,
        fill_adjustment_factor: fillAdj,
        termination_limit_a: terminationAmpacity,
        ocpd_a: ocpd,
        egc_awg: egc ?? 'n/a',
        length_ft,
        voltage_drop_pct: Number(vdPct.toFixed(2)),
        voltage_drop_v: Number(vd.toFixed(2)),
      },
      checks,
    }
  }

  checks.push({
    id: 'no-conductor-fits',
    citation: 'NEC 310.16',
    title: 'No conductor size satisfies all constraints',
    severity: 'fail',
    detail:
      `Needed ${required_ampacity_a.toFixed(1)} A after derates, ` +
      `${max_voltage_drop_pct}% max voltage drop over ${length_ft} ft. ` +
      'Largest tabulated size still falls short.',
    remedy:
      'Shorten the run, use parallel conductor sets, or raise the system voltage.',
  })
  return { spec: null, checks }
}

// ---------------------------------------------------------------------------
// 705.12 — Load-side interconnection (the 120% busbar rule)
// ---------------------------------------------------------------------------

export interface BusbarInput {
  busbar_rating_a: number
  main_breaker_a: number
  /** Sum of all inverter backfeed OCPD ratings, amps. */
  inverter_breaker_a: number
  /** 705.12(B)(3)(2) requires the backfeed breaker opposite the feed. */
  backfeed_at_opposite_end: boolean
}

export interface BusbarResult {
  /** Which 705.12(B)(3) option, if any, the design satisfies. */
  compliant_option: string | null
  allowance_120_a: number
  sum_a: number
  checks: CodeCheck[]
}

/**
 * NEC 705.12(B)(3) load-side connection.
 *
 * Option (1), the sum rule: main + inverter breakers <= busbar rating.
 * Option (2), the 120% rule: main + inverter breakers <= 120% of busbar
 *   rating, and the inverter breaker must sit at the opposite end of the
 *   busbar from the main.
 *
 * Options (3)-(6) (center-fed, feeder taps, engineering supervision, and the
 * 705.13 power control system path) are not auto-evaluated — they need
 * judgement or a PE stamp, so the engine names them as next steps instead of
 * silently claiming compliance.
 */
export function checkBusbar(input: BusbarInput): BusbarResult {
  const { busbar_rating_a, main_breaker_a, inverter_breaker_a, backfeed_at_opposite_end } =
    input
  const checks: CodeCheck[] = []

  const sum = main_breaker_a + inverter_breaker_a
  const allowance = busbar_rating_a * 1.2

  if (sum <= busbar_rating_a) {
    checks.push({
      id: 'busbar-sum-rule',
      citation: 'NEC 705.12(B)(3)(1)',
      title: 'Sum rule satisfied',
      severity: 'pass',
      detail:
        `${main_breaker_a} A main + ${inverter_breaker_a} A inverter = ${sum} A, ` +
        `at or below the ${busbar_rating_a} A busbar rating. ` +
        'Breaker position on the busbar is unrestricted under this option.',
      values: { sum_a: sum, busbar_rating_a },
    })
    return { compliant_option: '705.12(B)(3)(1) sum rule', allowance_120_a: allowance, sum_a: sum, checks }
  }

  if (sum <= allowance) {
    if (backfeed_at_opposite_end) {
      checks.push({
        id: 'busbar-120-rule',
        citation: 'NEC 705.12(B)(3)(2)',
        title: '120% rule satisfied',
        severity: 'pass',
        detail:
          `${main_breaker_a} A + ${inverter_breaker_a} A = ${sum} A, at or below ` +
          `120% x ${busbar_rating_a} A = ${allowance} A, with the backfeed ` +
          'breaker at the opposite end of the busbar from the main.',
        values: { sum_a: sum, allowance_a: allowance, busbar_rating_a },
      })
      return {
        compliant_option: '705.12(B)(3)(2) 120% rule',
        allowance_120_a: allowance,
        sum_a: sum,
        checks,
      }
    }

    checks.push({
      id: 'busbar-120-position',
      citation: 'NEC 705.12(B)(3)(2)',
      title: 'Backfeed breaker is in the wrong position',
      severity: 'fail',
      detail:
        `${sum} A is within the ${allowance} A allowance, but the 120% rule ` +
        'only applies when the backfeed breaker is at the opposite end of the ' +
        'busbar from the primary supply.',
      remedy:
        'Relocate the inverter breaker to the far end of the busbar, or use ' +
        'another 705.12(B)(3) option.',
      values: { sum_a: sum, allowance_a: allowance },
    })
    return { compliant_option: null, allowance_120_a: allowance, sum_a: sum, checks }
  }

  checks.push({
    id: 'busbar-exceeded',
    citation: 'NEC 705.12(B)(3)',
    title: 'Busbar allowance exceeded',
    severity: 'fail',
    detail:
      `${main_breaker_a} A main + ${inverter_breaker_a} A inverter = ${sum} A, ` +
      `over the ${allowance} A (120% of ${busbar_rating_a} A) ceiling.`,
    remedy:
      'Options: derate the main breaker; use a supply-side tap per 705.11; ' +
      'install a power control system per 705.13; upsize the panel; or use a ' +
      'feeder tap or engineering-supervision option under 705.12(B)(3).',
    values: { sum_a: sum, allowance_a: allowance, over_by_a: Number((sum - allowance).toFixed(1)) },
  })

  // Show how far the main would have to come down to make the 120% rule work.
  const maxMain = allowance - inverter_breaker_a
  if (maxMain > 0) {
    checks.push({
      id: 'busbar-derate-hint',
      citation: 'NEC 705.12(B)(3)(2)',
      title: 'Main breaker derate needed',
      severity: 'warn',
      detail:
        `Derating the main to ${Math.floor(maxMain)} A or less would bring the ` +
        'design under the 120% allowance. Confirm the derated main still ' +
        'carries the calculated service load (Article 220).',
      values: { max_main_breaker_a: Math.floor(maxMain) },
    })
  }

  return { compliant_option: null, allowance_120_a: allowance, sum_a: sum, checks }
}

// ---------------------------------------------------------------------------
// 625 / 220 — EV charging and service load
// ---------------------------------------------------------------------------

export interface EvseLoadInput {
  /** Continuous EVSE output rating, amps. */
  evse_output_a: number
  service_rating_a: number
  /**
   * NEC 220.87: highest 15-minute demand recorded over the last 12 months, kW.
   * Null forces the 220.83 method.
   */
  peak_demand_kw: number | null
  service_voltage_v: number
  /** NEC 625.42: does the EVSE or an EMS limit the load automatically? */
  load_management: boolean
  /** Amperage the load-management system limits the EVSE to. */
  managed_limit_a: number | null
  /**
   * Where the demand figure came from. The 220.87 exception permitting a
   * 30-day recording in place of 12 months of utility data is NOT available
   * when the service has a renewable source or any peak-shaving — which
   * describes nearly every design this tool produces.
   */
  demand_source?: '12-month-utility' | '30-day-recording'
  /** True when the site has PV, wind, or a peak-shaving battery. */
  has_renewable_or_peak_shaving?: boolean
  /** NEC edition the AHJ enforces; 220.57 only exists from 2023. */
  nec_edition?: '2017' | '2020' | '2023'
}

/**
 * NEC 220.57 (new in the 2023 edition): for service and feeder load
 * calculations the EVSE load is the larger of 7200 VA or the nameplate
 * rating. This is a *service calculation* floor and does not replace the
 * 625.41 branch-circuit sizing, which still uses 125% of the actual rating.
 */
export const EVSE_SERVICE_LOAD_FLOOR_VA = 7200

export interface EvseLoadResult {
  method: '220.87' | 'load-management' | 'none'
  existing_demand_a: number | null
  evse_demand_a: number
  total_demand_a: number | null
  fits_existing_service: boolean | null
  required_breaker_a: number | null
  checks: CodeCheck[]
}

/**
 * Whether an EVSE fits on the existing service.
 *
 * NEC 220.87 lets you use metered history instead of a calculated load:
 *   existing demand = highest 15-min demand over 12 months x 1.25
 * then add the new continuous EVSE load at 125% (625.41). If the total stays
 * under the service rating, no service upgrade is needed.
 *
 * NEC 625.42/625.43 gives the other lever: an energy management system that
 * throttles the EVSE means you size for the *managed* current, not nameplate.
 */
export function checkEvseLoad(input: EvseLoadInput): EvseLoadResult {
  const {
    evse_output_a,
    service_rating_a,
    peak_demand_kw,
    service_voltage_v,
    load_management,
    managed_limit_a,
    demand_source = '12-month-utility',
    has_renewable_or_peak_shaving = false,
    nec_edition = '2023',
  } = input
  const checks: CodeCheck[] = []

  // The 30-day recording exception is off the table once there is PV or a
  // peak-shaving battery on the service — the recorded demand would reflect
  // the solar offset rather than the true load.
  if (demand_source === '30-day-recording' && has_renewable_or_peak_shaving) {
    checks.push({
      id: 'evse-220-87-exception-barred',
      citation: 'NEC 220.87 Exception',
      title: '30-day demand recording not permitted on this service',
      severity: 'fail',
      detail:
        'The 220.87 exception allowing a 30-day recording in place of 12 ' +
        'months of utility data does not apply where the service has a ' +
        'renewable energy system or any form of peak load shaving. This ' +
        'design has one or both.',
      remedy:
        'Obtain 12 months of interval demand data from the utility, or run a ' +
        'full calculated load under 220.82 / 220.83 instead.',
    })
  }

  // 625.41: EVSE is a continuous load, so branch circuit and OCPD are 125%.
  const effectiveEvseA =
    load_management && managed_limit_a !== null ? managed_limit_a : evse_output_a
  const evseDemand = effectiveEvseA * 1.25
  const breaker = nextStandardOcpd(evseDemand)

  checks.push({
    id: 'evse-continuous',
    citation: 'NEC 625.41',
    title: 'EVSE branch circuit rating',
    severity: 'pass',
    detail:
      `${effectiveEvseA} A continuous x 1.25 = ${evseDemand.toFixed(1)} A. ` +
      `Smallest standard OCPD: ${breaker ?? 'none available'} A.`,
    values: { evse_output_a: effectiveEvseA, demand_a: Number(evseDemand.toFixed(1)), breaker_a: breaker },
  })

  if (load_management && managed_limit_a !== null) {
    checks.push({
      id: 'evse-alms',
      citation: 'NEC 625.42 / 625.43',
      title: 'Automatic load management in use',
      severity: 'pass',
      detail:
        `Load management limits the EVSE to ${managed_limit_a} A, so the ` +
        `service calculation uses that instead of the ${evse_output_a} A nameplate.`,
      values: { nameplate_a: evse_output_a, managed_limit_a },
    })
  }

  if (peak_demand_kw === null) {
    checks.push({
      id: 'evse-no-demand-data',
      citation: 'NEC 220.87',
      title: '12-month demand history not supplied',
      severity: 'unknown',
      detail:
        'Without the highest 15-minute demand from the last 12 months, the ' +
        '220.87 maximum-demand method cannot be used.',
      remedy:
        'Pull 12 months of interval data from the utility, or run a full ' +
        '220.82/220.83 calculated load instead.',
    })
    return {
      method: 'none',
      existing_demand_a: null,
      evse_demand_a: evseDemand,
      total_demand_a: null,
      fits_existing_service: null,
      required_breaker_a: breaker,
      checks,
    }
  }

  // 220.87: 125% of the recorded peak demand.
  const existingA = ((peak_demand_kw * 1000) / service_voltage_v) * 1.25

  // NEC 220.57 (2023+): the service-level EVSE load is the larger of 7200 VA
  // or nameplate. On a 240 V service that is 30 A, which exceeds the
  // branch-circuit demand for anything smaller than a 24 A charger — so for
  // small EVSE the service calculation is governed by the floor, not by 625.41.
  const serviceFloorA = EVSE_SERVICE_LOAD_FLOOR_VA / service_voltage_v
  const evseServiceLoad =
    nec_edition === '2023' ? Math.max(evseDemand, serviceFloorA) : evseDemand

  if (nec_edition === '2023' && serviceFloorA > evseDemand) {
    checks.push({
      id: 'evse-220-57-floor',
      citation: 'NEC 220.57',
      title: 'EVSE service load set by the 7200 VA floor',
      severity: 'pass',
      detail:
        `7200 VA / ${service_voltage_v} V = ${serviceFloorA.toFixed(1)} A, which ` +
        `exceeds the ${evseDemand.toFixed(1)} A branch-circuit demand, so the ` +
        'service calculation uses the floor.',
      values: {
        floor_va: EVSE_SERVICE_LOAD_FLOOR_VA,
        floor_a: Number(serviceFloorA.toFixed(1)),
        branch_demand_a: Number(evseDemand.toFixed(1)),
      },
    })
  }

  const total = existingA + evseServiceLoad
  const fits = total <= service_rating_a

  checks.push({
    id: 'evse-220-87',
    citation: 'NEC 220.87',
    title: 'Existing load by maximum demand',
    severity: 'pass',
    detail:
      `${peak_demand_kw} kW peak / ${service_voltage_v} V x 1.25 = ` +
      `${existingA.toFixed(1)} A existing demand.`,
    values: {
      peak_demand_kw,
      existing_demand_a: Number(existingA.toFixed(1)),
    },
  })

  checks.push({
    id: 'evse-service-capacity',
    citation: 'NEC 220.87 / 625.41',
    title: fits ? 'EVSE fits the existing service' : 'Service upgrade required',
    severity: fits ? 'pass' : 'fail',
    detail:
      `${existingA.toFixed(1)} A existing + ${evseServiceLoad.toFixed(1)} A EVSE = ` +
      `${total.toFixed(1)} A against a ${service_rating_a} A service.`,
    remedy: fits
      ? undefined
      : 'Add an automatic load management system per 625.42, reduce the EVSE ' +
        'output setting, or upgrade the service.',
    values: {
      total_demand_a: Number(total.toFixed(1)),
      service_rating_a,
      headroom_a: Number((service_rating_a - total).toFixed(1)),
    },
  })

  return {
    method: load_management && managed_limit_a !== null ? 'load-management' : '220.87',
    existing_demand_a: existingA,
    evse_demand_a: evseServiceLoad,
    total_demand_a: total,
    fits_existing_service: fits,
    required_breaker_a: breaker,
    checks,
  }
}

// ---------------------------------------------------------------------------
// Charge controller sizing (off-grid)
// ---------------------------------------------------------------------------

export interface ChargeControllerInput {
  module: PvModule
  modules_in_series: number
  strings_in_parallel: number
  record_low_temp_c: number
  controller_max_pv_voltage_v: number
  controller_max_charge_current_a: number
  battery_nominal_v: number
}

export interface ChargeControllerResult {
  string_voc_cold_v: number
  array_isc_a: number
  /** 690.8: Isc x 1.25 x 1.25. */
  design_current_a: number
  array_stc_w: number
  /** Array watts the controller can actually deliver at this battery voltage. */
  controller_capacity_w: number
  checks: CodeCheck[]
}

/**
 * Off-grid MPPT controller sizing.
 *
 * Two independent limits: the cold-temperature string Voc must stay under the
 * controller's max PV input voltage (exceeding it destroys the controller —
 * this is the single most common off-grid failure), and the array's output
 * current must not exceed the controller's charge current rating.
 */
export function sizeChargeController(
  input: ChargeControllerInput,
): ChargeControllerResult {
  const {
    module,
    modules_in_series,
    strings_in_parallel,
    record_low_temp_c,
    controller_max_pv_voltage_v,
    controller_max_charge_current_a,
    battery_nominal_v,
  } = input
  const checks: CodeCheck[] = []

  const voc = correctedVoc(module, record_low_temp_c)
  checks.push(...voc.checks)

  const stringVoc = voc.corrected_voc_per_module_v * modules_in_series
  const arrayIsc = module.isc_a * strings_in_parallel
  const designCurrent = arrayIsc * 1.25 * 1.25
  const arrayW = module.pmax_w * modules_in_series * strings_in_parallel
  const controllerW = controller_max_charge_current_a * battery_nominal_v

  const voltageOk = stringVoc <= controller_max_pv_voltage_v
  checks.push({
    id: 'cc-voltage',
    citation: 'NEC 690.7 / controller rating',
    title: voltageOk
      ? 'String voltage within controller limit'
      : 'String voltage exceeds controller limit',
    severity: voltageOk ? 'pass' : 'fail',
    detail:
      `${modules_in_series} modules x ${voc.corrected_voc_per_module_v.toFixed(2)} V ` +
      `at ${record_low_temp_c} degC = ${stringVoc.toFixed(1)} V against a ` +
      `${controller_max_pv_voltage_v} V controller limit.`,
    remedy: voltageOk
      ? undefined
      : `Shorten the string to ${Math.floor(controller_max_pv_voltage_v / voc.corrected_voc_per_module_v)} modules or fewer, or use a higher-voltage controller.`,
    values: {
      string_voc_cold_v: Number(stringVoc.toFixed(1)),
      controller_limit_v: controller_max_pv_voltage_v,
    },
  })

  const currentOk = controllerW >= arrayW
  checks.push({
    id: 'cc-power',
    citation: 'Controller rating',
    title: currentOk ? 'Controller can pass full array power' : 'Controller will clip the array',
    severity: currentOk ? 'pass' : 'warn',
    detail:
      `${controller_max_charge_current_a} A x ${battery_nominal_v} V nominal = ` +
      `${controllerW} W controller capacity against a ${arrayW} W array.`,
    remedy: currentOk
      ? undefined
      : 'Clipping is acceptable if intentional; otherwise add a second ' +
        'controller or raise the battery bank voltage.',
    values: { controller_capacity_w: controllerW, array_stc_w: arrayW },
  })

  return {
    string_voc_cold_v: stringVoc,
    array_isc_a: arrayIsc,
    design_current_a: designCurrent,
    array_stc_w: arrayW,
    controller_capacity_w: controllerW,
    checks,
  }
}

// ---------------------------------------------------------------------------
// Off-grid battery bank sizing
// ---------------------------------------------------------------------------

export interface BatteryBankInput {
  daily_load_kwh: number
  autonomy_days: number
  /** Fraction of nameplate you are willing to use, 0..1. */
  depth_of_discharge: number
  /** Round-trip efficiency, 0..1. */
  round_trip_efficiency: number
  /** Capacity derate for cold operation, 0..1. 1.0 = no derate. */
  temperature_derate: number
  /** Largest simultaneous load, kW — drives inverter and discharge rating. */
  peak_load_kw: number
}

export interface BatteryBankResult {
  required_nameplate_kwh: number
  required_usable_kwh: number
  required_discharge_kw: number
  checks: CodeCheck[]
}

/**
 * Off-grid bank sizing:
 *
 *   usable  = daily load x autonomy days / round-trip efficiency
 *   nameplate = usable / (DoD x temperature derate)
 *
 * Temperature derate matters more than people expect — LFP loses meaningful
 * usable capacity below freezing, and most banks live in an unheated garage.
 */
export function sizeBatteryBank(input: BatteryBankInput): BatteryBankResult {
  const {
    daily_load_kwh,
    autonomy_days,
    depth_of_discharge,
    round_trip_efficiency,
    temperature_derate,
    peak_load_kw,
  } = input
  const checks: CodeCheck[] = []

  const usable = (daily_load_kwh * autonomy_days) / round_trip_efficiency
  const nameplate = usable / (depth_of_discharge * temperature_derate)

  checks.push({
    id: 'bank-sizing',
    citation: 'Design practice (not a code rule)',
    title: 'Battery bank capacity',
    severity: 'pass',
    detail:
      `${daily_load_kwh} kWh/day x ${autonomy_days} days / ` +
      `${round_trip_efficiency} efficiency = ${usable.toFixed(1)} kWh usable; ` +
      `/ (${depth_of_discharge} DoD x ${temperature_derate} temp derate) = ` +
      `${nameplate.toFixed(1)} kWh nameplate.`,
    values: {
      usable_kwh: Number(usable.toFixed(1)),
      nameplate_kwh: Number(nameplate.toFixed(1)),
    },
  })

  checks.push({
    id: 'bank-power',
    citation: 'Design practice (not a code rule)',
    title: 'Discharge power requirement',
    severity: 'pass',
    detail:
      `Bank and inverter must sustain the ${peak_load_kw} kW peak load, ` +
      'plus motor starting surge for well pumps, compressors and similar.',
    values: { peak_load_kw },
  })

  return {
    required_nameplate_kwh: nameplate,
    required_usable_kwh: usable,
    required_discharge_kw: peak_load_kw,
    checks,
  }
}

/** Roll a set of checks up to the worst severity present. */
export function worstSeverity(checks: CodeCheck[]): CodeCheck['severity'] {
  if (checks.some((c) => c.severity === 'fail')) return 'fail'
  if (checks.some((c) => c.severity === 'unknown')) return 'unknown'
  if (checks.some((c) => c.severity === 'warn')) return 'warn'
  return 'pass'
}
