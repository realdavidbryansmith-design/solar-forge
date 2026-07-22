/**
 * DXF export — a plan-view site drawing for AutoCAD and any CAD viewer.
 *
 * Targets R12 (AC1009): the most widely and forgivingly imported DXF flavour.
 * It predates LWPOLYLINE, so polygons are emitted as LINE segments — verbose
 * but universally readable, which matters more than compactness for a file a
 * contractor drops into a permit set.
 *
 * The drawing is a true plan view: +x east, +y north, so the sheet reads the
 * way a site plan should with no rotation. Everything is drawn on named layers
 * so the modules, roof, buildings and trees can be turned on and off.
 */

import * as THREE from 'three'
import type { Design, PvModule } from '../types'
import { catalog } from '../catalog'
import { roofModuleFrames } from './siteGeometry'
import { moduleCount } from '../store'

export type DxfUnit = 'feet' | 'meters'

const M_TO_FT = 3.280839895

/** AutoCAD Color Index values used for the layers. */
const LAYERS: Array<{ name: string; color: number }> = [
  { name: 'PV-MODULES', color: 5 }, // blue
  { name: 'PV-ARRAY', color: 4 }, // cyan
  { name: 'PV-ROOF', color: 8 }, // grey
  { name: 'BUILDINGS', color: 7 }, // white/black
  { name: 'TREES', color: 3 }, // green
  { name: 'ANNOTATION', color: 2 }, // yellow
]

/** One DXF group: a code line and its value line. */
function g(code: number, value: string | number): string {
  return `${code}\n${value}\n`
}

interface Pt {
  x: number
  y: number
}

class DxfWriter {
  private out = ''
  private readonly scale: number

  constructor(unit: DxfUnit) {
    this.scale = unit === 'feet' ? M_TO_FT : 1
  }

  /** Metres in, drawing units out. */
  private c(v: number): number {
    return Number((v * this.scale).toFixed(4))
  }

  line(layer: string, a: Pt, b: Pt) {
    this.out +=
      g(0, 'LINE') +
      g(8, layer) +
      g(10, this.c(a.x)) +
      g(20, this.c(a.y)) +
      g(30, 0) +
      g(11, this.c(b.x)) +
      g(21, this.c(b.y)) +
      g(31, 0)
  }

  /** Closed polygon as a loop of LINE segments. */
  polygon(layer: string, pts: Pt[]) {
    for (let i = 0; i < pts.length; i++) {
      this.line(layer, pts[i], pts[(i + 1) % pts.length])
    }
  }

  circle(layer: string, center: Pt, radius_m: number) {
    this.out +=
      g(0, 'CIRCLE') +
      g(8, layer) +
      g(10, this.c(center.x)) +
      g(20, this.c(center.y)) +
      g(30, 0) +
      g(40, this.c(radius_m))
  }

  text(layer: string, at: Pt, height_m: number, s: string) {
    this.out +=
      g(0, 'TEXT') +
      g(8, layer) +
      g(10, this.c(at.x)) +
      g(20, this.c(at.y)) +
      g(30, 0) +
      g(40, this.c(height_m)) +
      // DXF TEXT cannot hold newlines or control chars.
      g(1, s.replace(/[\n\r]+/g, ' '))
  }

  /** Wrap the accumulated entities in a complete R12 document. */
  finish(): string {
    let layerTable = g(0, 'TABLE') + g(2, 'LAYER') + g(70, LAYERS.length)
    for (const l of LAYERS) {
      layerTable +=
        g(0, 'LAYER') + g(2, l.name) + g(70, 0) + g(62, l.color) + g(6, 'CONTINUOUS')
    }
    layerTable += g(0, 'ENDTAB')

    return (
      g(0, 'SECTION') +
      g(2, 'HEADER') +
      g(9, '$ACADVER') +
      g(1, 'AC1009') +
      g(0, 'ENDSEC') +
      g(0, 'SECTION') +
      g(2, 'TABLES') +
      layerTable +
      g(0, 'ENDSEC') +
      g(0, 'SECTION') +
      g(2, 'ENTITIES') +
      this.out +
      g(0, 'ENDSEC') +
      g(0, 'EOF')
    )
  }
}

/** Plan coordinate for a scene point (scene z is negated plan y). */
function planOf(v: THREE.Vector3): Pt {
  return { x: v.x, y: -v.z }
}

export interface DxfOptions {
  unit: DxfUnit
  /** Draw each module's plan footprint, not just the array outline. */
  includeModules?: boolean
}

/**
 * Build a plan-view DXF of the whole site.
 *
 * Roof-mounted arrays are drawn module by module, each as its true plan-view
 * footprint (a parallelogram, since a tilted module foreshortens up the slope).
 * Buildings become rotated footprint rectangles, trees become canopy circles.
 * A north arrow and a title line carry the system summary.
 */
export function buildSiteDxf(
  design: Design,
  modules: readonly PvModule[],
  options: DxfOptions,
): string {
  const w = new DxfWriter(options.unit)
  const includeModules = options.includeModules ?? true

  // Track the drawing extents so the title and north arrow can be placed clear.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (p: Pt) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  // --- roof planes --------------------------------------------------------
  for (const plane of design.planes) {
    const poly = plane.polygon.map((pt) => ({ x: pt.x, y: pt.y }))
    if (poly.length >= 2) {
      w.polygon('PV-ROOF', poly)
      poly.forEach(grow)
    }
  }

  // --- arrays -------------------------------------------------------------
  // The system summary counts every module; the drawing only lays out roof
  // arrays module by module, since ground and tracker arrays are placed by a
  // different code path not yet mirrored here.
  let totalModules = 0
  for (const ar of design.arrays) totalModules += moduleCount(ar)

  for (const array of design.arrays) {
    const plane = design.planes.find((p) => p.id === array.plane_id)
    const module = modules.find((m) => m.id === array.module_id)
    const mount = catalog.mounts.find((m) => m.id === array.mount_id)
    if (!plane || !module) continue
    // Only roof-mounted arrays are drawn to plan here.
    if (mount && mount.kind !== 'roof') continue

    const frames = roofModuleFrames(array, plane, module)
    if (frames.length === 0) continue

    let aMinX = Infinity
    let aMinY = Infinity
    let aMaxX = -Infinity
    let aMaxY = -Infinity

    for (const f of frames) {
      const right = new THREE.Vector3().setFromMatrixColumn(f.basis, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(f.basis, 1)
      const corners: Pt[] = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([a, b]) => {
        const c = f.position
          .clone()
          .addScaledVector(right, (a * f.width_m) / 2)
          .addScaledVector(up, (b * f.height_m) / 2)
        return planOf(c)
      })
      if (includeModules) w.polygon('PV-MODULES', corners)
      corners.forEach((p) => {
        grow(p)
        aMinX = Math.min(aMinX, p.x)
        aMinY = Math.min(aMinY, p.y)
        aMaxX = Math.max(aMaxX, p.x)
        aMaxY = Math.max(aMaxY, p.y)
      })
    }

    // Array boundary rectangle plus a label.
    w.polygon('PV-ARRAY', [
      { x: aMinX, y: aMinY },
      { x: aMaxX, y: aMinY },
      { x: aMaxX, y: aMaxY },
      { x: aMinX, y: aMaxY },
    ])
    const kw = (module.pmax_w * frames.length) / 1000
    w.text('ANNOTATION', { x: aMinX, y: aMaxY + 0.3 }, 0.4, `${array.name}: ${frames.length} mod, ${kw.toFixed(2)} kW`)
  }

  // --- buildings and trees ------------------------------------------------
  for (const o of design.site_objects) {
    if (o.kind.startsWith('tree-')) {
      w.circle('TREES', { x: o.x, y: o.y }, Math.max(0.3, o.width_m / 2))
      grow({ x: o.x - o.width_m / 2, y: o.y - o.width_m / 2 })
      grow({ x: o.x + o.width_m / 2, y: o.y + o.width_m / 2 })
      continue
    }
    // Rotated footprint rectangle.
    const hw = o.width_m / 2
    const hd = o.depth_m / 2
    const a = (o.rotation_deg * Math.PI) / 180
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const corners: Pt[] = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ].map(([lx, ly]) => ({ x: o.x + lx * ca - ly * sa, y: o.y + lx * sa + ly * ca }))
    w.polygon('BUILDINGS', corners)
    corners.forEach(grow)
    w.text('ANNOTATION', { x: o.x - hw, y: o.y }, 0.35, o.name)
  }

  // --- north arrow and title ---------------------------------------------
  if (Number.isFinite(minX)) {
    const span = Math.max(maxX - minX, maxY - minY, 1)
    const arrowLen = span * 0.12
    const ax = minX - span * 0.12
    const ay = minY
    w.line('ANNOTATION', { x: ax, y: ay }, { x: ax, y: ay + arrowLen })
    w.line('ANNOTATION', { x: ax, y: ay + arrowLen }, { x: ax - arrowLen * 0.15, y: ay + arrowLen * 0.8 })
    w.line('ANNOTATION', { x: ax, y: ay + arrowLen }, { x: ax + arrowLen * 0.15, y: ay + arrowLen * 0.8 })
    w.text('ANNOTATION', { x: ax - arrowLen * 0.2, y: ay + arrowLen * 1.1 }, arrowLen * 0.35, 'N')

    const dc = design.arrays.reduce((sum, ar) => {
      const m = modules.find((mm) => mm.id === ar.module_id)
      return sum + (m ? (m.pmax_w * moduleCount(ar)) / 1000 : 0)
    }, 0)
    w.text(
      'ANNOTATION',
      { x: minX, y: minY - span * 0.1 },
      Math.max(0.4, span * 0.02),
      `SolarForge — ${design.name} | ${totalModules} modules | ${dc.toFixed(2)} kW DC | units: ${options.unit}`,
    )
  }

  return w.finish()
}
