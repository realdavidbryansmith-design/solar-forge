/**
 * Load estimation and whole-system sizing.
 *
 * Two ways in: itemise the appliances, or pick a lifestyle preset and let the
 * tool guess. The guess is deliberately rough and says so — it exists because
 * most people genuinely do not know their daily kWh, and a rough number they
 * can then refine beats a blank field they abandon.
 *
 * IMPORTANT: appliance wattages here are *typical* figures, not datasheet
 * values. Real draw varies enormously by model, age and duty cycle — a chest
 * freezer in a hot shed can double its book figure. Treat the output as a
 * starting point to validate against a real meter reading.
 */

import { cosIncidence, sunPositionSolarTime } from './solar'

// ---------------------------------------------------------------------------
// Appliance library
// ---------------------------------------------------------------------------

export type LoadCategory =
  | 'lighting'
  | 'refrigeration'
  | 'kitchen'
  | 'water'
  | 'climate'
  | 'electronics'
  | 'laundry'
  | 'tools'

export interface Appliance {
  id: string
  name: string
  category: LoadCategory
  /** Typical running draw, watts. */
  watts: number
  /** Typical hours of *running* time per day (duty cycle already applied). */
  hours_per_day: number
  /**
   * Motor start surge, watts. Drives inverter selection, not energy.
   * Null where the load has no meaningful inrush.
   */
  surge_watts: number | null
  /**
   * True for loads that are usually a bad idea on an off-grid system — they
   * dominate the budget and are almost always cheaper to run on propane,
   * wood, or a generator.
   */
  offgrid_warning?: string
}

export const APPLIANCES: Appliance[] = [
  // Lighting
  { id: 'led-lights', name: 'LED lighting (whole cabin)', category: 'lighting', watts: 60, hours_per_day: 5, surge_watts: null },

  // Refrigeration — usually the biggest honest load in a cabin
  { id: 'fridge-standard', name: 'Refrigerator (standard)', category: 'refrigeration', watts: 150, hours_per_day: 8, surge_watts: 900 },
  { id: 'fridge-efficient', name: 'Refrigerator (high-efficiency DC)', category: 'refrigeration', watts: 60, hours_per_day: 8, surge_watts: 300 },
  { id: 'chest-freezer', name: 'Chest freezer', category: 'refrigeration', watts: 120, hours_per_day: 8, surge_watts: 800 },

  // Kitchen
  { id: 'microwave', name: 'Microwave', category: 'kitchen', watts: 1000, hours_per_day: 0.25, surge_watts: null },
  { id: 'coffee-maker', name: 'Coffee maker', category: 'kitchen', watts: 900, hours_per_day: 0.25, surge_watts: null },
  { id: 'toaster', name: 'Toaster', category: 'kitchen', watts: 1100, hours_per_day: 0.1, surge_watts: null },
  { id: 'dishwasher', name: 'Dishwasher', category: 'kitchen', watts: 1200, hours_per_day: 0.75, surge_watts: null },
  { id: 'electric-range', name: 'Electric range / oven', category: 'kitchen', watts: 3000, hours_per_day: 1, surge_watts: null, offgrid_warning: 'Electric cooking is a very large off-grid load. Propane is usually far cheaper than the extra panels and battery needed to support it.' },

  // Water
  { id: 'well-pump', name: 'Well pump (1/2 HP)', category: 'water', watts: 750, hours_per_day: 1, surge_watts: 2500 },
  { id: 'pressure-pump', name: 'RV / pressure pump', category: 'water', watts: 100, hours_per_day: 0.5, surge_watts: 300 },
  { id: 'water-heater-electric', name: 'Electric water heater', category: 'water', watts: 4500, hours_per_day: 3, surge_watts: null, offgrid_warning: 'Electric water heating is typically the single largest off-grid load and rarely worth it. Propane, or a heat-pump water heater on a much larger system, are the usual answers.' },

  // Climate
  { id: 'ceiling-fan', name: 'Ceiling / box fan', category: 'climate', watts: 60, hours_per_day: 6, surge_watts: 150 },
  { id: 'furnace-blower', name: 'Furnace blower (propane/wood furnace)', category: 'climate', watts: 400, hours_per_day: 4, surge_watts: 1200 },
  { id: 'mini-split', name: 'Mini-split heat pump (12k BTU)', category: 'climate', watts: 900, hours_per_day: 6, surge_watts: 1800 },
  { id: 'space-heater', name: 'Electric space heater', category: 'climate', watts: 1500, hours_per_day: 5, surge_watts: null, offgrid_warning: 'Resistance heating is the most expensive way to use solar power. Wood or propane heat is dramatically cheaper than sizing an array for this.' },

  // Electronics
  { id: 'laptop', name: 'Laptop / tablet charging', category: 'electronics', watts: 60, hours_per_day: 4, surge_watts: null },
  { id: 'phone-charging', name: 'Phone charging', category: 'electronics', watts: 10, hours_per_day: 3, surge_watts: null },
  { id: 'tv', name: 'TV', category: 'electronics', watts: 100, hours_per_day: 4, surge_watts: null },
  { id: 'starlink', name: 'Satellite internet (Starlink)', category: 'electronics', watts: 50, hours_per_day: 24, surge_watts: null },
  { id: 'wifi-router', name: 'Wi-Fi router / networking', category: 'electronics', watts: 15, hours_per_day: 24, surge_watts: null },

  // Laundry
  { id: 'washing-machine', name: 'Washing machine', category: 'laundry', watts: 500, hours_per_day: 0.5, surge_watts: 1500 },
  { id: 'dryer-electric', name: 'Electric clothes dryer', category: 'laundry', watts: 3000, hours_per_day: 1, surge_watts: null, offgrid_warning: 'An electric dryer is a very large off-grid load. A line, or a propane dryer, avoids several thousand dollars of array and battery.' },

  // Tools
  { id: 'power-tools', name: 'Power tools (occasional)', category: 'tools', watts: 900, hours_per_day: 0.5, surge_watts: 2200 },
  { id: 'well-known-misc', name: 'Misc outlets / phantom loads', category: 'tools', watts: 30, hours_per_day: 24, surge_watts: null },
]

export const CATEGORY_LABELS: Record<LoadCategory, string> = {
  lighting: 'Lighting',
  refrigeration: 'Refrigeration',
  kitchen: 'Kitchen',
  water: 'Water',
  climate: 'Heating & cooling',
  electronics: 'Electronics',
  laundry: 'Laundry',
  tools: 'Tools & misc',
}

// ---------------------------------------------------------------------------
// "I don't know" presets
// ---------------------------------------------------------------------------

export interface LoadPreset {
  id: string
  name: string
  description: string
  /** Rough daily energy, kWh. */
  daily_kwh: number
  /** Rough largest simultaneous draw, watts. */
  peak_watts: number
  /** Rough worst-case motor start, watts. */
  surge_watts: number
  /** Appliances this preset assumes, so the guess can be opened up and edited. */
  implies: string[]
}

/**
 * Deliberately coarse. These are starting points for people who do not know
 * their consumption, chosen to be a little conservative (better to oversize a
 * design that gets refined than to undersize one that gets built).
 */
export const LOAD_PRESETS: LoadPreset[] = [
  {
    id: 'weekend-cabin',
    name: 'Weekend cabin',
    description: 'Lights, phone charging, a few outlets. No refrigeration left running. Occupied a few days at a time.',
    daily_kwh: 1.5,
    peak_watts: 900,
    surge_watts: 1200,
    // A coffee maker is included on purpose: even a minimal cabin has one
    // high-draw kitchen appliance, and it — not the lighting — sets the
    // inverter size.
    implies: ['led-lights', 'phone-charging', 'laptop', 'coffee-maker', 'well-known-misc'],
  },
  {
    id: 'basic-cabin',
    name: 'Basic full-time cabin',
    description: 'Lights, fridge, water pump, internet, TV. Cooking and heat on propane or wood.',
    daily_kwh: 4,
    peak_watts: 2000,
    surge_watts: 3500,
    implies: ['led-lights', 'fridge-efficient', 'pressure-pump', 'starlink', 'tv', 'laptop', 'phone-charging', 'microwave', 'coffee-maker', 'well-known-misc'],
  },
  {
    id: 'comfortable-cabin',
    name: 'Comfortable off-grid home',
    description: 'Full fridge and freezer, well pump, washing machine, full electronics. Cooking, heat and hot water still on propane or wood.',
    daily_kwh: 8,
    peak_watts: 3500,
    surge_watts: 5000,
    implies: ['led-lights', 'fridge-standard', 'chest-freezer', 'well-pump', 'washing-machine', 'starlink', 'tv', 'laptop', 'phone-charging', 'microwave', 'furnace-blower', 'well-known-misc'],
  },
  {
    id: 'all-electric-home',
    name: 'All-electric home',
    description: 'Everything on electricity including cooking and a heat pump. A large and expensive off-grid system — worth a hard look at propane for cooking and heat first.',
    daily_kwh: 25,
    peak_watts: 8000,
    surge_watts: 12000,
    implies: ['led-lights', 'fridge-standard', 'chest-freezer', 'well-pump', 'washing-machine', 'dryer-electric', 'electric-range', 'mini-split', 'starlink', 'tv', 'laptop', 'dishwasher', 'well-known-misc'],
  },
]

// ---------------------------------------------------------------------------
// Load rollup
// ---------------------------------------------------------------------------

export interface LoadItem {
  appliance_id: string
  quantity: number
}

export interface LoadEstimate {
  daily_kwh: number
  /** Sum of running watts — a worst case where everything runs at once. */
  connected_watts: number
  /**
   * Realistic simultaneous draw. Everything never runs at once, so this
   * applies a diversity factor to the connected load.
   */
  peak_watts: number
  /** Largest single motor start added to the running load. */
  surge_watts: number
  warnings: string[]
  breakdown: Array<{ name: string; daily_kwh: number; watts: number; quantity: number }>
}

/**
 * Diversity factor. Real installations never see every load at once; 0.6 is a
 * common rule of thumb for a dwelling and keeps the inverter from being
 * absurdly oversized.
 */
const DIVERSITY = 0.6

export function estimateLoads(items: LoadItem[]): LoadEstimate {
  let daily = 0
  let connected = 0
  let largestSurge = 0
  let largestSingle = 0
  const warnings: string[] = []
  const breakdown: LoadEstimate['breakdown'] = []

  for (const item of items) {
    if (item.quantity <= 0) continue
    const a = APPLIANCES.find((x) => x.id === item.appliance_id)
    if (!a) continue

    const kwh = (a.watts * a.hours_per_day * item.quantity) / 1000
    daily += kwh
    connected += a.watts * item.quantity
    largestSingle = Math.max(largestSingle, a.watts)

    // Only the single largest inrush matters — motors rarely start together.
    if (a.surge_watts !== null) {
      largestSurge = Math.max(largestSurge, a.surge_watts)
    }
    if (a.offgrid_warning && !warnings.includes(a.offgrid_warning)) {
      warnings.push(a.offgrid_warning)
    }

    breakdown.push({ name: a.name, daily_kwh: kwh, watts: a.watts, quantity: item.quantity })
  }

  breakdown.sort((x, y) => y.daily_kwh - x.daily_kwh)

  /*
    Diversity cannot take the inverter below the largest single appliance —
    a 1000 W microwave still needs 1000 W even if it is the only thing on.
    Without this floor, a list of small always-on loads produces an absurdly
    undersized inverter.
  */
  const peak = Math.max(connected * DIVERSITY, largestSingle)
  return {
    daily_kwh: daily,
    connected_watts: connected,
    peak_watts: peak,
    surge_watts: peak + largestSurge,
    warnings,
    breakdown,
  }
}

// ---------------------------------------------------------------------------
// Clear-sky insolation
// ---------------------------------------------------------------------------

/**
 * Clear-sky plane-of-array insolation for one day, kWh/m^2.
 *
 * Numerically equal to "peak sun hours", since 1000 W/m^2 is one sun.
 *
 * Uses the Meinel clear-sky beam model with a simple isotropic diffuse term.
 * This is a *clear-sky* figure with no weather data behind it — real sites lose
 * meaningful production to cloud, so the sizing function applies a separate
 * weather derate on top. See VERIFICATION.md.
 */
export interface ClearSkyIrradiance {
  /** Direct normal irradiance, W/m^2. */
  dni_wm2: number
  /** Beam component landing on the tilted plane, W/m^2. */
  beam_wm2: number
  /** Isotropic diffuse on the tilted plane, W/m^2. */
  diffuse_wm2: number
  /** Total plane-of-array irradiance, W/m^2. */
  poa_wm2: number
}

/**
 * Clear-sky irradiance on a tilted plane for one instant.
 *
 * Meinel beam attenuation through air mass, plus an isotropic diffuse term.
 * Shared by the yield estimate and the shading calculation so the two cannot
 * disagree about how much light is available.
 *
 * Beam and diffuse are returned separately because shading treats them
 * differently: an obstruction blocks the beam outright, but only reduces the
 * diffuse component in proportion to the sky it covers.
 */
export function clearSkyIrradiance(
  sun: { altitude_deg: number; azimuth_deg: number; hour_angle_deg: number; declination_deg: number },
  tilt_deg: number,
  azimuth_deg: number,
): ClearSkyIrradiance {
  if (sun.altitude_deg <= 3) {
    return { dni_wm2: 0, beam_wm2: 0, diffuse_wm2: 0, poa_wm2: 0 }
  }

  const am = 1 / Math.sin((sun.altitude_deg * Math.PI) / 180)
  const dni = 1353 * Math.pow(0.7, Math.pow(am, 0.678))

  const beam = dni * cosIncidence(tilt_deg, azimuth_deg, sun)

  // Isotropic diffuse: roughly 10% of DNI on the horizontal, view-factored
  // onto the tilted plane.
  const viewFactor = (1 + Math.cos((tilt_deg * Math.PI) / 180)) / 2
  const diffuse = 0.1 * dni * Math.sin((sun.altitude_deg * Math.PI) / 180) * viewFactor

  return { dni_wm2: dni, beam_wm2: beam, diffuse_wm2: diffuse, poa_wm2: beam + diffuse }
}

export function dailyInsolationKwhM2(
  latitude_deg: number,
  tilt_deg: number,
  azimuth_deg: number,
  dayOfYear: number,
): number {
  const STEP_H = 0.25
  let total = 0

  for (let hour = 0; hour < 24; hour += STEP_H) {
    const sun = sunPositionSolarTime(latitude_deg, dayOfYear, hour)
    total += clearSkyIrradiance(sun, tilt_deg, azimuth_deg).poa_wm2 * STEP_H
  }

  return total / 1000
}

/** Day-of-year at the middle of each month, for worst-month searches. */
const MONTH_MID_DAYS = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface InsolationSummary {
  worst_month_kwh_m2: number
  worst_month_name: string
  best_month_kwh_m2: number
  annual_average_kwh_m2: number
}

/**
 * Monthly insolation summary.
 *
 * Off-grid systems are sized on the *worst* month — an array that carries the
 * annual average leaves you running a generator every December.
 */
export function insolationSummary(
  latitude_deg: number,
  tilt_deg: number,
  azimuth_deg: number,
): InsolationSummary {
  const monthly = MONTH_MID_DAYS.map((d) =>
    dailyInsolationKwhM2(latitude_deg, tilt_deg, azimuth_deg, d),
  )

  let worstIdx = 0
  let bestIdx = 0
  for (let i = 1; i < monthly.length; i++) {
    if (monthly[i] < monthly[worstIdx]) worstIdx = i
    if (monthly[i] > monthly[bestIdx]) bestIdx = i
  }

  return {
    worst_month_kwh_m2: monthly[worstIdx],
    worst_month_name: MONTH_NAMES[worstIdx],
    best_month_kwh_m2: monthly[bestIdx],
    annual_average_kwh_m2: monthly.reduce((a, b) => a + b, 0) / monthly.length,
  }
}

// ---------------------------------------------------------------------------
// System sizing
// ---------------------------------------------------------------------------

export type SystemGoal = 'off-grid' | 'backup' | 'grid-offset'

export interface SizingInput {
  goal: SystemGoal
  daily_kwh: number
  peak_watts: number
  surge_watts: number
  latitude_deg: number
  tilt_deg: number
  azimuth_deg: number
  /** Days the bank must carry the loads with no meaningful sun. */
  autonomy_days: number
  /**
   * Fraction of the clear-sky figure the site actually sees, accounting for
   * cloud. 0.7 is a reasonable default for much of the US; a genuinely sunny
   * high-desert site is higher, the Pacific Northwest in winter much lower.
   */
  weather_factor: number
}

export interface SizingResult {
  /** Recommended array DC nameplate, watts. */
  array_w: number
  /** Recommended usable battery capacity, kWh. */
  battery_usable_kwh: number
  /** Recommended battery nameplate before depth-of-discharge, kWh. */
  battery_nameplate_kwh: number
  /** Recommended continuous inverter rating, watts. */
  inverter_w: number
  /** Surge the inverter must tolerate, watts. */
  inverter_surge_w: number
  insolation: InsolationSummary
  /** Effective sun hours used for the array calculation. */
  design_sun_hours: number
  notes: string[]
}

/**
 * System-level DC-to-load efficiency for an off-grid chain: module soiling and
 * mismatch, wiring, MPPT conversion, and battery round-trip. Grid-tied systems
 * skip the battery leg and so lose less.
 */
const OFFGRID_SYSTEM_EFFICIENCY = 0.65
const GRIDTIE_SYSTEM_EFFICIENCY = 0.8

/** Usable fraction of a lithium bank. Conservative for cycle life. */
const DEPTH_OF_DISCHARGE = 0.8

export function sizeSystem(input: SizingInput): SizingResult {
  const {
    goal,
    daily_kwh,
    peak_watts,
    surge_watts,
    latitude_deg,
    tilt_deg,
    azimuth_deg,
    autonomy_days,
    weather_factor,
  } = input

  const insolation = insolationSummary(latitude_deg, tilt_deg, azimuth_deg)
  const notes: string[] = []

  // Off-grid must survive the worst month. Grid-tied can average across the
  // year, because the grid covers the shortfall.
  const baseSunHours =
    goal === 'off-grid' ? insolation.worst_month_kwh_m2 : insolation.annual_average_kwh_m2

  if (goal === 'off-grid') {
    notes.push(
      `Sized on ${insolation.worst_month_name} (${insolation.worst_month_kwh_m2.toFixed(1)} sun hours), ` +
        `not the annual average of ${insolation.annual_average_kwh_m2.toFixed(1)}. Sizing an off-grid ` +
        'array on the average means running a generator all winter.',
    )
  }

  const designSunHours = baseSunHours * weather_factor
  const efficiency = goal === 'off-grid' ? OFFGRID_SYSTEM_EFFICIENCY : GRIDTIE_SYSTEM_EFFICIENCY

  const arrayW =
    designSunHours > 0 ? (daily_kwh * 1000) / (designSunHours * efficiency) : Infinity

  // Battery: carry the load through the autonomy period, then allow for the
  // fact that you only use part of the nameplate.
  const usableKwh = goal === 'grid-offset' ? 0 : daily_kwh * autonomy_days
  const nameplateKwh = usableKwh / DEPTH_OF_DISCHARGE

  // Inverter carries the realistic simultaneous load with headroom.
  const inverterW = peak_watts * 1.25

  if (goal === 'off-grid' && autonomy_days < 2) {
    notes.push(
      'Fewer than two days of autonomy leaves no margin for a cloudy stretch. ' +
        'Most off-grid designs use two to three days, or pair a smaller bank with a generator.',
    )
  }

  if (Number.isFinite(arrayW) && arrayW > 20000) {
    notes.push(
      'This array is very large for a residential site. Cutting the biggest loads — ' +
        'electric heat, hot water, cooking — usually saves more money than adding panels.',
    )
  }

  return {
    array_w: Math.round(arrayW),
    battery_usable_kwh: usableKwh,
    battery_nameplate_kwh: nameplateKwh,
    inverter_w: Math.round(inverterW),
    inverter_surge_w: Math.round(surge_watts),
    insolation,
    design_sun_hours: designSunHours,
    notes,
  }
}
