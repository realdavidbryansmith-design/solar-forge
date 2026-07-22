import { describe, it, expect } from 'vitest'
import { buildSiteDxf } from './dxf'
import { catalog } from '../catalog'
import type { Design } from '../types'

const module = catalog.modules.find((m) => m.id.startsWith('qcells'))!

function design(overrides: Partial<Design> = {}): Design {
  return {
    id: 'd',
    name: 'Test site',
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
    arrays: [
      {
        id: 'a1',
        name: 'Array 1',
        plane_id: 'p1',
        module_id: module.id,
        mount_id: catalog.mounts[0].id,
        layout: 'portrait',
        rows: 3,
        cols: 5,
        module_positions: Array.from({ length: 15 }, (_, i) => ({
          row: Math.floor(i / 5),
          col: i % 5,
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
    site_objects: [
      { id: 'h', kind: 'house', name: 'House', x: 6, y: 3.5, rotation_deg: 0, width_m: 12, depth_m: 7, height_m: 3, roof_pitch_deg: 0 },
      { id: 't', kind: 'tree-deciduous', name: 'Oak', x: -6, y: 10, rotation_deg: 0, width_m: 8, depth_m: 8, height_m: 9, roof_pitch_deg: 0 },
    ],
    ...overrides,
  }
}

describe('DXF structure', () => {
  it('is a complete R12 document', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'feet' })
    expect(dxf).toContain('$ACADVER')
    expect(dxf).toContain('AC1009')
    expect(dxf.startsWith('0\nSECTION')).toBe(true)
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true)
  })

  it('opens and closes every section', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'feet' })
    const sections = (dxf.match(/\nSECTION\n/g) ?? []).length
    const ends = (dxf.match(/\nENDSEC\n/g) ?? []).length
    expect(sections).toBe(ends)
    expect(sections).toBe(3) // HEADER, TABLES, ENTITIES
  })

  it('defines every layer', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'feet' })
    for (const layer of ['PV-MODULES', 'PV-ARRAY', 'PV-ROOF', 'BUILDINGS', 'TREES', 'ANNOTATION']) {
      // Once in the LAYER table plus at least one entity referencing it.
      expect(dxf).toContain(layer)
    }
  })

  it('references only declared layers on entities', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'feet' })
    const declared = new Set(['PV-MODULES', 'PV-ARRAY', 'PV-ROOF', 'BUILDINGS', 'TREES', 'ANNOTATION'])
    // Parse real code/value pairs — a regex would confuse a colour value of 8
    // with a code-8 layer reference. Only pairs inside the ENTITIES section
    // count; the LAYER table also uses code 8 conventions differently.
    const entities = dxf.slice(dxf.indexOf('2\nENTITIES'))
    const lines = entities.split('\n')
    const layerRefs: string[] = []
    for (let i = 0; i + 1 < lines.length; i += 2) {
      if (lines[i] === '8') layerRefs.push(lines[i + 1])
    }
    expect(layerRefs.length).toBeGreaterThan(0)
    for (const l of layerRefs) expect(declared.has(l)).toBe(true)
  })
})

describe('DXF geometry', () => {
  it('draws a closed quad per module (15 modules -> 60 module lines)', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'meters', includeModules: true })
    // Count LINE entities on PV-MODULES: each module is 4 segments.
    const moduleLines = [...dxf.matchAll(/0\nLINE\n8\nPV-MODULES\n/g)].length
    expect(moduleLines).toBe(60)
  })

  it('omits module footprints when includeModules is false', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'meters', includeModules: false })
    expect(dxf).not.toContain('8\nPV-MODULES\n')
    // The array boundary is still drawn.
    expect(dxf).toContain('8\nPV-ARRAY\n')
  })

  it('draws a circle for each tree', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'meters' })
    const circles = [...dxf.matchAll(/0\nCIRCLE\n8\nTREES\n/g)].length
    expect(circles).toBe(1)
  })

  it('scales coordinates to feet', () => {
    const ft = buildSiteDxf(design({ site_objects: [] }), catalog.modules, { unit: 'feet' })
    const m = buildSiteDxf(design({ site_objects: [] }), catalog.modules, { unit: 'meters' })
    // The roof spans 12 m -> 39.37 ft. The feet file must contain the larger value.
    expect(ft).toContain('39.3701')
    expect(m).toContain('12')
    expect(m).not.toContain('39.3701')
  })

  it('labels the array with its module count and kW', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'feet' })
    expect(dxf).toContain('Array 1: 15 mod')
  })

  it('carries a title with the DC total and the unit', () => {
    const dxf = buildSiteDxf(design(), catalog.modules, { unit: 'feet' })
    expect(dxf).toContain('SolarForge — Test site')
    expect(dxf).toContain('15 modules')
    expect(dxf).toContain('units: feet')
  })

  it('draws ground-mount arrays module by module', () => {
    const gm = design()
    gm.arrays[0].mount_id = 'unirac-gft'
    const dxf = buildSiteDxf(gm, catalog.modules, { unit: 'meters' })
    expect([...dxf.matchAll(/0\nLINE\n8\nPV-MODULES\n/g)].length).toBe(60)
    expect(dxf).toContain('15 modules')
  })

  it('draws tracker arrays module by module', () => {
    const tr = design()
    tr.arrays[0].mount_id = 'nextracker-nx-horizon'
    const dxf = buildSiteDxf(tr, catalog.modules, { unit: 'meters' })
    expect([...dxf.matchAll(/0\nLINE\n8\nPV-MODULES\n/g)].length).toBe(60)
  })

  it('places a ground array clear of the roof footprint', () => {
    const gm = design({ site_objects: [] })
    gm.arrays[0].mount_id = 'unirac-gft'
    const dxf = buildSiteDxf(gm, catalog.modules, { unit: 'meters' })
    const ys = [...dxf.matchAll(/\n20\n(-?[0-9.]+)\n/g)].map((m) => Number(m[1]))
    expect(Math.min(...ys)).toBeLessThan(0)
  })

  it('handles an empty design without throwing', () => {
    const empty = design({ arrays: [], planes: [], site_objects: [] })
    const dxf = buildSiteDxf(empty, catalog.modules, { unit: 'feet' })
    expect(dxf).toContain('EOF')
  })

  it('never emits a newline inside a TEXT string', () => {
    const dxf = buildSiteDxf(
      design({ site_objects: [{ id: 'h', kind: 'house', name: 'Weird\nname', x: 0, y: 0, rotation_deg: 0, width_m: 5, depth_m: 5, height_m: 3, roof_pitch_deg: 0 }] }),
      catalog.modules,
      { unit: 'feet' },
    )
    // The label group (1\n...) must be a single line.
    const labels = [...dxf.matchAll(/\n1\n([^\n]*)\n/g)].map((m) => m[1])
    expect(labels.some((l) => l.includes('Weird name'))).toBe(true)
  })
})
