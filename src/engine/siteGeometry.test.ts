import { describe, it, expect } from 'vitest'
import { buildShadingGeometry } from './siteGeometry'
import { computeShading } from './shading'
import { catalog } from '../catalog'
import type { Design, SiteObject } from '../types'

const mod = catalog.modules.find((m) => m.id.startsWith('qcells'))!

/** A ground/tracker array of `rows`×`cols` modules on the given mount. */
function design(mountId: string, objects: SiteObject[] = [], rows = 8, cols = 12): Design {
  const n = rows * cols
  return {
    id: 'd',
    name: 'T',
    created: '',
    modified: '',
    site: {
      label: '',
      latitude_deg: 40,
      longitude_deg: -105,
      elevation_m: 0,
      timezone: '',
      record_low_temp_c: -20,
      design_high_temp_c: 35,
      wind_speed_mph: null,
      ground_snow_load_psf: null,
      nec_edition: '2023',
    },
    planes: [
      {
        id: 'p1',
        name: 'r',
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
    arrays: [
      {
        id: 'a1',
        name: 'A',
        plane_id: 'p1',
        module_id: mod.id,
        mount_id: mountId,
        layout: 'portrait',
        rows,
        cols,
        module_positions: Array.from({ length: n }, (_, i) => ({
          row: Math.floor(i / cols),
          col: i % cols,
          enabled: true,
        })),
        row_pitch_m: null,
        tilt_deg: null,
        azimuth_deg: null,
      },
    ],
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
      floor_area_sqft: null,
    },
    autonomy_days: null,
    system_type: ['grid-tie'],
    circuit: {
      modules_per_string: null,
      strings_in_parallel: null,
      dc_run_ft: null,
      conductors_in_raceway: null,
      termination_rating_c: 75,
    },
    load_profile: null,
    site_image: null,
    site_objects: objects,
  }
}

const treeToSouth: SiteObject = {
  id: 'oak',
  kind: 'tree-deciduous',
  name: 'Oak',
  x: 0,
  y: -30,
  rotation_deg: 0,
  width_m: 10,
  depth_m: 10,
  height_m: 14,
  roof_pitch_deg: 0,
}

const shade = (d: Design) => {
  const g = buildShadingGeometry(d, catalog.modules)
  return { g, r: computeShading({ latitude_deg: 40, surfaces: g.surfaces, occluders: g.occluders }) }
}

const FIXED = 'unirac-gft'
const TRACKER = 'nextracker-nx-horizon'

describe('ground & tracker shading', () => {
  it('hands ground arrays to the shading engine (was silently skipped)', () => {
    // The old bridge only sampled roof arrays; a ground array produced zero
    // surfaces and so could never register any loss.
    const { g } = shade(design(FIXED))
    expect(g.surfaces.length).toBe(96)
  })

  it('models each row of a fixed ground array as one occluder', () => {
    const { g } = shade(design(FIXED))
    const rows = g.occluders.filter((o) => o.id.includes(':row:'))
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.every((o) => o.kind === 'box')).toBe(true)
  })

  it('gives trackers no inter-row occluders and weights them sun-facing', () => {
    const { g, r } = shade(design(TRACKER))
    expect(g.occluders.filter((o) => o.id.includes(':row:'))).toHaveLength(0)
    expect(g.surfaces[0].tracking).toBe(true)
    // Backtracking keeps the rows out of each other's shadow: no self-loss.
    expect(r.annual_loss_pct).toBeCloseTo(0, 3)
  })

  it('does not let a fixed ground module shade itself on its own row', () => {
    // Without the own-row skip, every sample sits inside its table box and the
    // array reads as nearly fully shaded. With it, a well-spaced array is clean.
    const { r } = shade(design(FIXED))
    expect(r.annual_loss_pct).toBeLessThan(3)
    expect(Math.max(...r.per_surface.map((p) => p.loss_pct))).toBeLessThan(20)
  })

  it('puts what inter-row loss there is in winter, not summer', () => {
    // The real north-south inter-row effect is a low-sun, winter problem. An
    // east-west artifact would have shown up in summer instead.
    const { r } = shade(design(FIXED))
    expect(r.monthly[5].loss_pct).toBeLessThanOrEqual(r.monthly[11].loss_pct)
  })

  it('lets external objects shade a ground array', () => {
    const clear = shade(design(FIXED)).r.annual_loss_pct
    const shaded = shade(design(FIXED, [treeToSouth])).r.annual_loss_pct
    expect(shaded).toBeGreaterThan(clear + 2)
    expect(shaded).toBeGreaterThan(3)
  })

  it('lets external objects shade a tracker array', () => {
    const shaded = shade(design(TRACKER, [treeToSouth])).r
    expect(shaded.annual_loss_pct).toBeGreaterThan(0)
    expect(shaded.worst_month_name).toBe('December')
  })

  it('still samples roof arrays as before', () => {
    // Regression guard: the roof path must be untouched by the ground branch.
    const roof = design(catalog.mounts.find((m) => m.kind === 'roof')!.id)
    const { g } = shade(roof)
    expect(g.surfaces.length).toBe(96)
    expect(g.surfaces.every((s) => !s.tracking)).toBe(true)
    expect(g.occluders.filter((o) => o.id.includes(':row:'))).toHaveLength(0)
  })
})
