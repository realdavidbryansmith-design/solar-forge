/**
 * Shading loss.
 *
 * Casts a ray from sample points on each module toward the sun at many times
 * through the year, and asks whether anything is in the way. Losses are
 * weighted by the irradiance available at that moment, so an hour of shading
 * at midday in June counts for far more than an hour at dawn in December.
 *
 * Obstructions are reduced to spheres and boxes. That is deliberate: a tree
 * canopy is a fuzzy, seasonal thing and a sphere is as defensible as anything
 * more elaborate, while staying fast enough to recompute interactively.
 *
 * ── What this does NOT model ────────────────────────────────────────────────
 * Geometric shading only. The *electrical* consequence is usually worse: a
 * shaded cell drags down its whole series string, so a module that is 20%
 * geometrically shaded can lose far more than 20% of its output, depending on
 * bypass diodes and string topology. Module-level electronics change this
 * again. Treat the number here as a lower bound on the real loss.
 */

import { clearSkyIrradiance } from './loads'
import { sunPositionSolarTime, type SunPosition } from './solar'

const DEG = Math.PI / 180

export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Sphere obstruction — tree canopies. */
export interface SphereOccluder {
  kind: 'sphere'
  id: string
  label: string
  center: Vec3
  radius: number
}

/** Rotated box obstruction — buildings and array tables. */
export interface BoxOccluder {
  kind: 'box'
  id: string
  label: string
  center: Vec3
  /** Half sizes along the box's own x, y, z axes. */
  half: Vec3
  /** Rotation about the vertical axis, degrees. */
  rotation_deg: number
}

export type Occluder = SphereOccluder | BoxOccluder

// ---------------------------------------------------------------------------
// Ray intersection
// ---------------------------------------------------------------------------

/**
 * Does the ray from `origin` along unit `dir` hit the sphere at positive t?
 *
 * Standard quadratic form. Only forward hits count — an obstruction behind the
 * module cannot shade it.
 */
export function rayHitsSphere(origin: Vec3, dir: Vec3, s: SphereOccluder): boolean {
  const ox = origin.x - s.center.x
  const oy = origin.y - s.center.y
  const oz = origin.z - s.center.z

  const b = ox * dir.x + oy * dir.y + oz * dir.z
  const c = ox * ox + oy * oy + oz * oz - s.radius * s.radius

  // Origin inside the sphere counts as blocked.
  if (c <= 0) return true
  // Sphere centre is behind the ray.
  if (b > 0) return false

  return b * b - c >= 0
}

/**
 * Does the ray hit the rotated box at positive t?
 *
 * The ray is rotated into the box's local frame, then tested with the standard
 * slab method.
 */
export function rayHitsBox(origin: Vec3, dir: Vec3, b: BoxOccluder): boolean {
  const a = -b.rotation_deg * DEG
  const ca = Math.cos(a)
  const sa = Math.sin(a)

  // Translate, then rotate into local space about Y.
  const px = origin.x - b.center.x
  const pz = origin.z - b.center.z
  const lx = px * ca - pz * sa
  const lz = px * sa + pz * ca
  const ly = origin.y - b.center.y

  const dx = dir.x * ca - dir.z * sa
  const dz = dir.x * sa + dir.z * ca
  const dy = dir.y

  let tMin = 0
  let tMax = Infinity

  const slab = (o: number, d: number, h: number): boolean => {
    if (Math.abs(d) < 1e-9) {
      // Ray runs parallel to this pair of planes.
      return o >= -h && o <= h
    }
    let t1 = (-h - o) / d
    let t2 = (h - o) / d
    if (t1 > t2) [t1, t2] = [t2, t1]
    tMin = Math.max(tMin, t1)
    tMax = Math.min(tMax, t2)
    return tMax >= tMin
  }

  if (!slab(lx, dx, b.half.x)) return false
  if (!slab(ly, dy, b.half.y)) return false
  if (!slab(lz, dz, b.half.z)) return false

  return tMax >= Math.max(tMin, 0)
}

function rayHits(origin: Vec3, dir: Vec3, o: Occluder): boolean {
  return o.kind === 'sphere' ? rayHitsSphere(origin, dir, o) : rayHitsBox(origin, dir, o)
}

/** First occluder blocking the ray, or null if the sun is visible. */
export function firstBlocker(
  origin: Vec3,
  dir: Vec3,
  occluders: readonly Occluder[],
): Occluder | null {
  for (const o of occluders) if (rayHits(origin, dir, o)) return o
  return null
}

// ---------------------------------------------------------------------------
// Sun vector
// ---------------------------------------------------------------------------

/**
 * Unit vector pointing from the site toward the sun, in scene coordinates
 * (+x east, +y up, -z north).
 */
export function sunVector(sun: SunPosition): Vec3 {
  const cosAlt = Math.cos(sun.altitude_deg * DEG)
  return {
    x: cosAlt * Math.sin(sun.azimuth_deg * DEG),
    y: Math.sin(sun.altitude_deg * DEG),
    z: -cosAlt * Math.cos(sun.azimuth_deg * DEG),
  }
}

// ---------------------------------------------------------------------------
// Annual calculation
// ---------------------------------------------------------------------------

/** A module to be tested, described by sample points on its face. */
export interface ShadedSurface {
  id: string
  /** Points spread across the module face, in scene coordinates. */
  samples: Vec3[]
  tilt_deg: number
  azimuth_deg: number
}

export interface ShadingInput {
  latitude_deg: number
  surfaces: readonly ShadedSurface[]
  occluders: readonly Occluder[]
  /**
   * Minutes between samples through the day. Smaller is slower but smoother.
   * Clamped to 30 minutes or finer — an hourly step measurably under-reports
   * loss (about 2 percentage points in testing) because it skips straight over
   * short shading events near sunrise and sunset.
   */
  step_minutes?: number
}

/** Coarser than this and the answer is not trustworthy. See `step_minutes`. */
const MAX_STEP_MINUTES = 30

export interface MonthlyShading {
  month: number
  month_name: string
  loss_pct: number
}

export interface BlameEntry {
  id: string
  label: string
  /** Share of all shading loss attributable to this obstruction, percent. */
  share_pct: number
  /** Loss this obstruction causes, as a percentage of total annual yield. */
  loss_pct: number
}

export interface ShadingResult {
  /** Annual energy lost to shading, percent of the unshaded clear-sky total. */
  annual_loss_pct: number
  monthly: MonthlyShading[]
  worst_month_name: string
  worst_month_loss_pct: number
  /** Obstructions ranked by how much loss they cause. */
  blame: BlameEntry[]
  /** Per-surface annual loss, for colouring the 3D view. */
  per_surface: Array<{ id: string; loss_pct: number }>
  /** Number of ray tests performed — useful for spotting runaway inputs. */
  rays_cast: number
}

const MONTH_MID_DAYS = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Annual shading loss.
 *
 * One representative day per month is stepped through daylight hours. At each
 * step the beam component is tested per sample point; blocked samples lose
 * their share of the beam. Diffuse light is left intact — an obstruction does
 * reduce the diffuse a little, but attributing that properly needs a sky-view
 * calculation, and pretending otherwise would overstate the loss.
 */
export function computeShading(input: ShadingInput): ShadingResult {
  const { latitude_deg, surfaces, occluders, step_minutes = 30 } = input
  const stepH = Math.min(step_minutes, MAX_STEP_MINUTES) / 60

  let raysCast = 0

  // Energy accumulators, in arbitrary consistent units.
  let totalAvailable = 0
  let totalLost = 0
  const monthlyAvailable = new Array(12).fill(0)
  const monthlyLost = new Array(12).fill(0)
  const blameLost = new Map<string, number>()
  const perSurfaceAvailable = new Map<string, number>()
  const perSurfaceLost = new Map<string, number>()

  for (const s of surfaces) {
    perSurfaceAvailable.set(s.id, 0)
    perSurfaceLost.set(s.id, 0)
  }

  for (let m = 0; m < 12; m++) {
    const day = MONTH_MID_DAYS[m]
    // Each representative day stands in for its whole month.
    const daysInMonth = new Date(Date.UTC(2001, m + 1, 0)).getUTCDate()

    for (let hour = 0; hour < 24; hour += stepH) {
      const sun = sunPositionSolarTime(latitude_deg, day, hour)
      if (sun.altitude_deg <= 3) continue
      const dir = sunVector(sun)

      for (const surf of surfaces) {
        const irr = clearSkyIrradiance(sun, surf.tilt_deg, surf.azimuth_deg)
        if (irr.poa_wm2 <= 0) continue

        const available = irr.poa_wm2 * stepH * daysInMonth
        const beamShare = irr.beam_wm2 * stepH * daysInMonth

        totalAvailable += available
        monthlyAvailable[m] += available
        perSurfaceAvailable.set(surf.id, (perSurfaceAvailable.get(surf.id) ?? 0) + available)

        if (beamShare <= 0 || occluders.length === 0) continue

        // Fraction of the module's face that cannot see the sun.
        let blocked = 0
        const blameHere = new Map<string, number>()
        for (const point of surf.samples) {
          raysCast++
          const hitBy = firstBlocker(point, dir, occluders)
          if (hitBy) {
            blocked++
            blameHere.set(hitBy.id, (blameHere.get(hitBy.id) ?? 0) + 1)
          }
        }
        if (blocked === 0) continue

        const lostHere = beamShare * (blocked / surf.samples.length)
        totalLost += lostHere
        monthlyLost[m] += lostHere
        perSurfaceLost.set(surf.id, (perSurfaceLost.get(surf.id) ?? 0) + lostHere)

        // Split this loss between whichever obstructions caused it.
        for (const [id, count] of blameHere) {
          blameLost.set(id, (blameLost.get(id) ?? 0) + (beamShare * count) / surf.samples.length)
        }
      }
    }
  }

  const pct = (lost: number, avail: number) => (avail > 0 ? (lost / avail) * 100 : 0)

  const monthly: MonthlyShading[] = MONTH_NAMES.map((name, i) => ({
    month: i + 1,
    month_name: name,
    loss_pct: pct(monthlyLost[i], monthlyAvailable[i]),
  }))

  let worst = monthly[0]
  for (const mth of monthly) if (mth.loss_pct > worst.loss_pct) worst = mth

  const blame: BlameEntry[] = [...blameLost.entries()]
    .map(([id, lost]) => ({
      id,
      label: occluders.find((o) => o.id === id)?.label ?? id,
      share_pct: totalLost > 0 ? (lost / totalLost) * 100 : 0,
      loss_pct: pct(lost, totalAvailable),
    }))
    .sort((a, b) => b.loss_pct - a.loss_pct)

  const per_surface = surfaces.map((s) => ({
    id: s.id,
    loss_pct: pct(perSurfaceLost.get(s.id) ?? 0, perSurfaceAvailable.get(s.id) ?? 0),
  }))

  return {
    annual_loss_pct: pct(totalLost, totalAvailable),
    monthly,
    worst_month_name: worst.month_name,
    worst_month_loss_pct: worst.loss_pct,
    blame,
    per_surface,
    rays_cast: raysCast,
  }
}
