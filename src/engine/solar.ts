/**
 * Solar geometry and energy production.
 *
 * Algorithms are the standard textbook set (Duffie & Beckman, "Solar
 * Engineering of Thermal Processes", ch. 1) plus the NREL PVWatts v5 module
 * temperature and DC power models. Everything here is pure and unit-tested so
 * the row-spacing and yield numbers can be checked against PVWatts.
 */

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

const sin = (deg: number) => Math.sin(deg * DEG)
const cos = (deg: number) => Math.cos(deg * DEG)
const tan = (deg: number) => Math.tan(deg * DEG)

/** Day of year, 1..366. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  return Math.floor((date.getTime() - start) / 86_400_000)
}

/**
 * Solar declination in degrees (Spencer 1971 Fourier series, ±0.0006 rad).
 * More accurate than Cooper's equation, which errs by up to 1.5 deg.
 */
export function solarDeclination(n: number): number {
  const b = ((n - 1) * 2 * Math.PI) / 365
  return (
    (0.006918 -
      0.399912 * Math.cos(b) +
      0.070257 * Math.sin(b) -
      0.006758 * Math.cos(2 * b) +
      0.000907 * Math.sin(2 * b) -
      0.002697 * Math.cos(3 * b) +
      0.00148 * Math.sin(3 * b)) *
    RAD
  )
}

/** Equation of time in minutes (Spencer 1971). */
export function equationOfTime(n: number): number {
  const b = ((n - 1) * 2 * Math.PI) / 365
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(b) -
      0.032077 * Math.sin(b) -
      0.014615 * Math.cos(2 * b) -
      0.04089 * Math.sin(2 * b))
  )
}

export interface SunPosition {
  /** Degrees above the horizon. Negative means the sun is down. */
  altitude_deg: number
  /** Degrees clockwise from true north. */
  azimuth_deg: number
  /** Degrees from solar noon; negative before noon. */
  hour_angle_deg: number
  declination_deg: number
}

/**
 * Sun position from local *solar* time inputs.
 *
 * @param latitude_deg  positive north
 * @param n             day of year
 * @param solarHour     apparent solar time, 0..24 (12 = solar noon)
 */
export function sunPositionSolarTime(
  latitude_deg: number,
  n: number,
  solarHour: number,
): SunPosition {
  const dec = solarDeclination(n)
  const hourAngle = 15 * (solarHour - 12)

  const sinAlt =
    sin(latitude_deg) * sin(dec) +
    cos(latitude_deg) * cos(dec) * cos(hourAngle)
  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD

  // Azimuth measured clockwise from north, using atan2 so it stays
  // continuous through solar noon and works in both hemispheres.
  const y = -cos(dec) * sin(hourAngle)
  const x =
    sin(dec) * cos(latitude_deg) - cos(dec) * sin(latitude_deg) * cos(hourAngle)
  let azimuth = Math.atan2(y, x) * RAD
  azimuth = (azimuth + 360) % 360

  return {
    altitude_deg: altitude,
    azimuth_deg: azimuth,
    hour_angle_deg: hourAngle,
    declination_deg: dec,
  }
}

/**
 * Sun position from a wall-clock date at a given longitude and standard
 * meridian, applying the equation of time.
 */
export function sunPosition(
  latitude_deg: number,
  longitude_deg: number,
  date: Date,
  utcOffsetHours: number,
): SunPosition {
  const n = dayOfYear(date)
  const standardMeridian = 15 * utcOffsetHours
  const clockHour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    utcOffsetHours

  // 4 min per degree of longitude east of the standard meridian.
  const solarHour =
    clockHour + (4 * (longitude_deg - standardMeridian) + equationOfTime(n)) / 60

  return sunPositionSolarTime(latitude_deg, n, solarHour)
}

/**
 * Cosine of the angle of incidence on a tilted plane.
 * Returns 0 when the sun is behind the plane.
 */
export function cosIncidence(
  tilt_deg: number,
  surfaceAzimuth_deg: number,
  sun: SunPosition,
): number {
  const zenith = 90 - sun.altitude_deg
  const c =
    cos(zenith) * cos(tilt_deg) +
    sin(zenith) * sin(tilt_deg) * cos(sun.azimuth_deg - surfaceAzimuth_deg)
  return Math.max(0, c)
}

// ---------------------------------------------------------------------------
// Row spacing and shading geometry
// ---------------------------------------------------------------------------

export interface RowSpacingInput {
  latitude_deg: number
  /** Module tilt above horizontal. */
  tilt_deg: number
  /** Slope length of the module along the tilt direction, metres. */
  module_length_m: number
  /** Height of the module's lower edge above the mounting plane, metres. */
  lower_edge_height_m?: number
  /**
   * Design hour on the winter solstice the array must be shade-free.
   * Industry convention is 9am–3pm solar, so 9 gives the worst case.
   */
  design_hour: number
  /** Array azimuth, degrees clockwise from north. 180 = due south. */
  azimuth_deg: number
}

export interface RowSpacingResult {
  /** Vertical rise of the module above its lower edge, metres. */
  module_rise_m: number
  /** Horizontal run the module occupies, metres. */
  module_run_m: number
  /** Shadow length cast on the ground plane, metres. */
  shadow_length_m: number
  /** Minimum clear gap between the back of one row and the front of the next. */
  minimum_gap_m: number
  /** Centre-to-centre row pitch (run + gap), metres. */
  row_pitch_m: number
  /** Ground coverage ratio = module slope length / row pitch. */
  gcr: number
  solar_altitude_deg: number
  solar_azimuth_deg: number
  /** True when the sun is below the horizon at the design hour. */
  sun_below_horizon: boolean
}

/**
 * Inter-row spacing so that row N does not shade row N+1 at the design hour on
 * the winter solstice (worst-case sun in the northern hemisphere).
 *
 *   rise    = L · sin(tilt)
 *   run     = L · cos(tilt)
 *   shadow  = rise / tan(altitude)          (shadow length along sun azimuth)
 *   gap     = shadow · |cos(azimuth_sun − azimuth_array)|   (projected onto
 *                                                            the row normal)
 *   pitch   = run + gap
 *   GCR     = L / pitch
 *
 * The azimuth-correction term matters: a shadow cast at 9am travels south-east,
 * so only its component perpendicular to the rows eats into the spacing.
 */
export function minimumRowSpacing(input: RowSpacingInput): RowSpacingResult {
  const {
    latitude_deg,
    tilt_deg,
    module_length_m,
    design_hour,
    azimuth_deg,
    lower_edge_height_m = 0,
  } = input

  // Winter solstice in the hemisphere that has the worst sun.
  const n = latitude_deg >= 0 ? 355 : 172
  const sun = sunPositionSolarTime(latitude_deg, n, design_hour)

  const rise = module_length_m * sin(tilt_deg) + lower_edge_height_m
  const run = module_length_m * cos(tilt_deg)

  if (sun.altitude_deg <= 0) {
    return {
      module_rise_m: rise,
      module_run_m: run,
      shadow_length_m: Infinity,
      minimum_gap_m: Infinity,
      row_pitch_m: Infinity,
      gcr: 0,
      solar_altitude_deg: sun.altitude_deg,
      solar_azimuth_deg: sun.azimuth_deg,
      sun_below_horizon: true,
    }
  }

  const shadow = rise / tan(sun.altitude_deg)
  const azimuthCorrection = Math.abs(cos(sun.azimuth_deg - azimuth_deg))
  const gap = shadow * azimuthCorrection
  const pitch = run + gap

  return {
    module_rise_m: rise,
    module_run_m: run,
    shadow_length_m: shadow,
    minimum_gap_m: gap,
    row_pitch_m: pitch,
    gcr: module_length_m / pitch,
    solar_altitude_deg: sun.altitude_deg,
    solar_azimuth_deg: sun.azimuth_deg,
    sun_below_horizon: false,
  }
}

/**
 * Ideal (mechanically unconstrained) tracking rotation for a horizontal
 * single-axis tracker with a N-S axis. Positive = rotated toward the west.
 *
 * Kept separate from the clamped version because backtracking must be derived
 * from the ideal angle: a tracker sitting at its rotation limit can still be
 * shading the next row, and clamping first hides that.
 */
export function idealTrackingAngle(sun: SunPosition): number {
  if (sun.altitude_deg <= 0) return 0
  const zenith = (90 - sun.altitude_deg) * DEG
  // Projection of the sun vector onto the plane normal to the tracker axis.
  const x = Math.sin(zenith) * Math.sin((sun.azimuth_deg - 180) * DEG)
  const z = Math.cos(zenith)
  return Math.atan2(x, z) * RAD
}

const clamp = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v))

/**
 * True-tracking rotation clamped to the tracker's mechanical limit.
 * Positive = rotated toward the west.
 */
export function trueTrackingAngle(sun: SunPosition, maxRotation_deg: number): number {
  return clamp(idealTrackingAngle(sun), maxRotation_deg)
}

/**
 * Backtracking angle for a horizontal single-axis tracker.
 *
 * At low sun angles a true-tracking row shades its neighbour, so the tracker
 * rotates *back* toward horizontal to keep rows unshaded. The standard
 * formulation (NREL/Lorenzo) is:
 *
 *   if |cos(θ_true)| < GCR:   θ = θ_true − sign(θ_true)·acos(GCR / |cos θ_true|)
 *
 * @param gcr ground coverage ratio, module width / row pitch
 */
export function backtrackingAngle(
  sun: SunPosition,
  gcr: number,
  maxRotation_deg: number,
): number {
  if (sun.altitude_deg <= 0) return 0

  // Derive from the ideal angle, then clamp — clamping first would mask
  // shading that occurs while the tracker is parked at its rotation limit.
  const ideal = idealTrackingAngle(sun)
  const c = Math.abs(cos(ideal))

  // cos(theta) >= GCR means the rows are not shading each other yet.
  if (c === 0 || c >= gcr) return clamp(ideal, maxRotation_deg)

  const correction = Math.acos(Math.min(1, c / gcr)) * RAD
  const backtracked = ideal - Math.sign(ideal) * correction
  return clamp(backtracked, maxRotation_deg)
}

/**
 * Rule-of-thumb optimal fixed tilt for annual yield.
 * Latitude-based; within ~1% of the true optimum for most US latitudes.
 */
export function optimalFixedTilt(latitude_deg: number): number {
  const lat = Math.abs(latitude_deg)
  if (lat <= 25) return lat * 0.87
  return lat * 0.76 + 3.1
}

// ---------------------------------------------------------------------------
// Production model (PVWatts v5)
// ---------------------------------------------------------------------------

/**
 * Sandia module temperature model as used by PVWatts v5.
 * Coefficients are for a standard glass/cell/polymer module on an open rack.
 */
export function cellTemperature(
  poa_wm2: number,
  ambient_c: number,
  windSpeed_ms: number,
  mounting: 'open-rack' | 'roof-mount' = 'open-rack',
): number {
  // Sandia a/b/deltaT for glass/cell/polymer.
  const { a, b, dT } =
    mounting === 'roof-mount'
      ? { a: -2.98, b: -0.0471, dT: 1 }
      : { a: -3.56, b: -0.075, dT: 3 }

  const backSurface = poa_wm2 * Math.exp(a + b * windSpeed_ms) + ambient_c
  return backSurface + (poa_wm2 / 1000) * dT
}

export interface DcPowerInput {
  /** Plane-of-array irradiance, W/m^2. */
  poa_wm2: number
  cell_temp_c: number
  /** Array nameplate DC at STC, watts. */
  nameplate_dc_w: number
  /** Module Pmax temperature coefficient, %/degC (negative). */
  temp_coeff_pmax_pct_per_c: number
  /** Combined losses (soiling, wiring, mismatch, LID...), percent. */
  system_losses_pct: number
}

/** PVWatts v5 DC array power, watts. */
export function dcPower(input: DcPowerInput): number {
  const {
    poa_wm2,
    cell_temp_c,
    nameplate_dc_w,
    temp_coeff_pmax_pct_per_c,
    system_losses_pct,
  } = input
  if (poa_wm2 <= 0) return 0

  const gamma = temp_coeff_pmax_pct_per_c / 100
  const raw =
    (poa_wm2 / 1000) * nameplate_dc_w * (1 + gamma * (cell_temp_c - 25))
  return Math.max(0, raw * (1 - system_losses_pct / 100))
}

/**
 * PVWatts v5 inverter efficiency curve, normalised to the unit's nominal
 * efficiency. Falls off sharply below ~10% load, which is why oversized
 * inverters underperform on cloudy days.
 */
export function inverterAcPower(
  dc_w: number,
  inverterRatedAc_w: number,
  nominalEfficiency = 0.96,
): number {
  if (dc_w <= 0) return 0
  const pdc0 = inverterRatedAc_w / nominalEfficiency
  const zeta = dc_w / pdc0
  if (zeta <= 0) return 0

  const C0 = -0.0162
  const C1 = -0.0059
  const C2 = 0.9858
  const eta = (nominalEfficiency / C2) * (C0 * zeta + C1 / zeta + C2)

  return Math.min(inverterRatedAc_w, Math.max(0, dc_w * eta))
}

/** DC-to-AC ratio, the headline sizing number for an inverter selection. */
export function dcAcRatio(arrayDc_w: number, inverterAc_w: number): number {
  return inverterAc_w > 0 ? arrayDc_w / inverterAc_w : Infinity
}
