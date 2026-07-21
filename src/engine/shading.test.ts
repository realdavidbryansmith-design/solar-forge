import { describe, it, expect } from 'vitest'
import {
  computeShading,
  firstBlocker,
  rayHitsBox,
  rayHitsSphere,
  sunVector,
  type BoxOccluder,
  type Occluder,
  type ShadedSurface,
  type SphereOccluder,
} from './shading'
import { sunPositionSolarTime } from './solar'

const UP = { x: 0, y: 1, z: 0 }
const ORIGIN = { x: 0, y: 0, z: 0 }

const sphere = (
  x: number,
  y: number,
  z: number,
  r: number,
  id = 's',
): SphereOccluder => ({ kind: 'sphere', id, label: id, center: { x, y, z }, radius: r })

const box = (
  x: number,
  y: number,
  z: number,
  hx: number,
  hy: number,
  hz: number,
  rot = 0,
  id = 'b',
): BoxOccluder => ({
  kind: 'box',
  id,
  label: id,
  center: { x, y, z },
  half: { x: hx, y: hy, z: hz },
  rotation_deg: rot,
})

describe('ray / sphere', () => {
  it('hits a sphere directly overhead', () => {
    expect(rayHitsSphere(ORIGIN, UP, sphere(0, 10, 0, 2))).toBe(true)
  })

  it('misses a sphere off to the side', () => {
    expect(rayHitsSphere(ORIGIN, UP, sphere(20, 10, 0, 2))).toBe(false)
  })

  it('misses a sphere behind the ray', () => {
    // Sphere below, ray pointing up.
    expect(rayHitsSphere(ORIGIN, UP, sphere(0, -10, 0, 2))).toBe(false)
  })

  it('grazes at exactly the radius', () => {
    expect(rayHitsSphere(ORIGIN, UP, sphere(1.99, 10, 0, 2))).toBe(true)
    expect(rayHitsSphere(ORIGIN, UP, sphere(2.01, 10, 0, 2))).toBe(false)
  })

  it('counts an origin inside the sphere as blocked', () => {
    expect(rayHitsSphere(ORIGIN, UP, sphere(0, 0, 0, 5))).toBe(true)
  })

  it('hits along a slanted direction', () => {
    const d = Math.SQRT1_2
    expect(rayHitsSphere(ORIGIN, { x: d, y: d, z: 0 }, sphere(10, 10, 0, 1.5))).toBe(true)
    expect(rayHitsSphere(ORIGIN, { x: -d, y: d, z: 0 }, sphere(10, 10, 0, 1.5))).toBe(false)
  })
})

describe('ray / box', () => {
  it('hits a box directly overhead', () => {
    expect(rayHitsBox(ORIGIN, UP, box(0, 10, 0, 2, 2, 2))).toBe(true)
  })

  it('misses a box off to the side', () => {
    expect(rayHitsBox(ORIGIN, UP, box(20, 10, 0, 2, 2, 2))).toBe(false)
  })

  it('misses a box behind the ray', () => {
    expect(rayHitsBox(ORIGIN, UP, box(0, -10, 0, 2, 2, 2))).toBe(false)
  })

  it('respects the box half extents', () => {
    expect(rayHitsBox(ORIGIN, UP, box(1.9, 10, 0, 2, 2, 2))).toBe(true)
    expect(rayHitsBox(ORIGIN, UP, box(2.1, 10, 0, 2, 2, 2))).toBe(false)
  })

  it('accounts for rotation', () => {
    // A long thin box running east-west, offset north. Unrotated it does not
    // cover the origin's upward ray; rotated 90 degrees it does.
    const thin = (rot: number) => box(0, 10, 6, 12, 1, 0.5, rot)
    expect(rayHitsBox(ORIGIN, UP, thin(0))).toBe(false)
    expect(rayHitsBox(ORIGIN, UP, thin(90))).toBe(true)
  })

  it('hits along a slanted direction', () => {
    const d = Math.SQRT1_2
    expect(rayHitsBox(ORIGIN, { x: d, y: d, z: 0 }, box(10, 10, 0, 1, 1, 1))).toBe(true)
  })
})

describe('firstBlocker', () => {
  const occluders: Occluder[] = [sphere(0, 10, 0, 2, 'tree'), box(0, 20, 0, 3, 3, 3, 0, 'barn')]

  it('returns null when nothing blocks', () => {
    expect(firstBlocker(ORIGIN, { x: 1, y: 0.01, z: 0 }, occluders)).toBeNull()
  })

  it('names the obstruction that blocks', () => {
    expect(firstBlocker(ORIGIN, UP, occluders)?.id).toBe('tree')
  })

  it('returns null with no occluders at all', () => {
    expect(firstBlocker(ORIGIN, UP, [])).toBeNull()
  })
})

describe('sun vector', () => {
  it('points straight up at the zenith', () => {
    const v = sunVector({ altitude_deg: 90, azimuth_deg: 180, hour_angle_deg: 0, declination_deg: 0 })
    expect(v.y).toBeCloseTo(1, 6)
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0, 6)
  })

  it('points south (+z) when the sun is due south on the horizon', () => {
    const v = sunVector({ altitude_deg: 0, azimuth_deg: 180, hour_angle_deg: 0, declination_deg: 0 })
    expect(v.z).toBeCloseTo(1, 6)
    expect(v.x).toBeCloseTo(0, 6)
  })

  it('points east (+x) when the sun is due east', () => {
    const v = sunVector({ altitude_deg: 0, azimuth_deg: 90, hour_angle_deg: 0, declination_deg: 0 })
    expect(v.x).toBeCloseTo(1, 6)
  })

  it('is a unit vector', () => {
    const v = sunVector(sunPositionSolarTime(40, 172, 10))
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9)
  })
})

// ---------------------------------------------------------------------------

/** One module at the origin, sampled at a single point, facing south. */
function surfaceAt(x: number, y: number, z: number, id = 'm1'): ShadedSurface {
  return { id, samples: [{ x, y, z }], tilt_deg: 25, azimuth_deg: 180 }
}

describe('annual shading', () => {
  const lat = 40

  it('reports zero loss with no obstructions', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 3, 0)],
      occluders: [],
    })
    expect(r.annual_loss_pct).toBe(0)
    expect(r.blame).toHaveLength(0)
  })

  it('reports heavy loss when fully enclosed', () => {
    // A large sphere centred on the module blocks every direction.
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 3, 0)],
      occluders: [sphere(0, 3, 0, 50, 'dome')],
    })
    expect(r.annual_loss_pct).toBeGreaterThan(80)
  })

  it('loses nothing to an obstruction on the shaded (north) side', () => {
    // At 40N the sun is always in the southern sky, so a tree due north
    // cannot cast onto the module.
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 6, -12, 4, 'north-tree')],
    })
    expect(r.annual_loss_pct).toBeCloseTo(0, 5)
  })

  it('loses meaningfully to a tall tree due south', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 8, 10, 5, 'south-tree')],
    })
    expect(r.annual_loss_pct).toBeGreaterThan(5)
  })

  it('blames the obstruction that actually causes the loss', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [
        sphere(0, 8, 10, 5, 'oak'),
        sphere(0, 6, -30, 4, 'irrelevant-north-tree'),
      ],
    })
    expect(r.blame[0].id).toBe('oak')
    expect(r.blame[0].share_pct).toBeGreaterThan(90)
  })

  it('blame shares add up to about 100%', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(-6, 8, 9, 4, 'a'), sphere(6, 8, 9, 4, 'b')],
    })
    const total = r.blame.reduce((s, b) => s + b.share_pct, 0)
    expect(total).toBeGreaterThan(99)
    expect(total).toBeLessThan(101)
  })

  it('hurts more in winter, when the sun is low', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 7, 12, 4, 'south-tree')],
    })
    const dec = r.monthly[11].loss_pct
    const jun = r.monthly[5].loss_pct
    expect(dec).toBeGreaterThan(jun)
    expect(['November', 'December', 'January']).toContain(r.worst_month_name)
  })

  it('hurts more the closer the obstruction is', () => {
    const near = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 8, 8, 4, 't')],
    })
    const far = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 8, 40, 4, 't')],
    })
    expect(near.annual_loss_pct).toBeGreaterThan(far.annual_loss_pct)
  })

  it('hurts more the taller the obstruction', () => {
    const tall = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 12, 12, 5, 't')],
    })
    const short = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 4, 12, 2, 't')],
    })
    expect(tall.annual_loss_pct).toBeGreaterThan(short.annual_loss_pct)
  })

  it('reports per-surface losses, so a partly shaded array is visible', () => {
    // Two modules far apart; only the southern one has a tree in front of it.
    const shaded = surfaceAt(0, 2, 0, 'shaded')
    const clear = surfaceAt(60, 2, 0, 'clear')
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [shaded, clear],
      occluders: [sphere(0, 8, 10, 5, 'oak')],
    })
    const byId = Object.fromEntries(r.per_surface.map((p) => [p.id, p.loss_pct]))
    expect(byId.shaded).toBeGreaterThan(5)
    // Not exactly zero: from 60 m away the tree still subtends ~12 degrees, so
    // it clips the very low setting sun. That is real, and tiny.
    expect(byId.clear).toBeLessThan(0.1)
  })

  it('partial shading falls between none and full', () => {
    // Four samples across a wide module, tree covering roughly half of them.
    const wide: ShadedSurface = {
      id: 'wide',
      tilt_deg: 25,
      azimuth_deg: 180,
      samples: [
        { x: -3, y: 2, z: 0 },
        { x: -1, y: 2, z: 0 },
        { x: 1, y: 2, z: 0 },
        { x: 3, y: 2, z: 0 },
      ],
    }
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [wide],
      occluders: [sphere(-2, 8, 8, 3, 'oak')],
    })
    expect(r.annual_loss_pct).toBeGreaterThan(0)
    expect(r.annual_loss_pct).toBeLessThan(60)
  })

  it('never reports more than 100% loss', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 1, 0)],
      occluders: [sphere(0, 1, 0, 80, 'dome'), sphere(0, 5, 5, 30, 'another')],
    })
    expect(r.annual_loss_pct).toBeLessThanOrEqual(100)
  })

  it('counts the rays it casts', () => {
    const r = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 8, 10, 4)],
      step_minutes: 60,
    })
    expect(r.rays_cast).toBeGreaterThan(0)
  })

  it('gives a stable answer as the time step is refined', () => {
    const run = (step: number) =>
      computeShading({
        latitude_deg: lat,
        surfaces: [surfaceAt(0, 2, 0)],
        occluders: [sphere(0, 8, 10, 5, 't')],
        step_minutes: step,
      }).annual_loss_pct

    // Everything from the 30-minute default down agrees closely.
    expect(Math.abs(run(30) - run(10))).toBeLessThan(1.5)
    expect(Math.abs(run(15) - run(5))).toBeLessThan(1.5)
  })

  it('clamps a too-coarse step rather than returning a wrong answer', () => {
    // An hourly step under-reports by ~2 points, so asking for it must not
    // silently produce that number.
    const asked = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 8, 10, 5, 't')],
      step_minutes: 60,
    })
    const capped = computeShading({
      latitude_deg: lat,
      surfaces: [surfaceAt(0, 2, 0)],
      occluders: [sphere(0, 8, 10, 5, 't')],
      step_minutes: 30,
    })
    expect(asked.annual_loss_pct).toBeCloseTo(capped.annual_loss_pct, 9)
  })

  it('runs a realistic array quickly', () => {
    const surfaces: ShadedSurface[] = []
    for (let i = 0; i < 24; i++) {
      surfaces.push({
        id: `m${i}`,
        tilt_deg: 25,
        azimuth_deg: 180,
        samples: [
          { x: i * 1.2 - 14, y: 3, z: 0 },
          { x: i * 1.2 - 13.5, y: 3.5, z: 0 },
        ],
      })
    }
    const t0 = performance.now()
    const r = computeShading({
      latitude_deg: lat,
      surfaces,
      occluders: [sphere(0, 9, 11, 5, 'oak'), box(-14, 3, 9, 7, 3, 4, 0, 'barn')],
    })
    const ms = performance.now() - t0
    expect(r.annual_loss_pct).toBeGreaterThanOrEqual(0)
    // Interactive recompute has to stay well under a second.
    expect(ms).toBeLessThan(800)
  })
})
