/**
 * Bridge from the design to the shading engine.
 *
 * Converts site objects into occluders and modules into sampled surfaces. The
 * module layout here is the same function the renderer uses, so what you see
 * shaded in the 3D view is exactly what the calculation measured.
 */

import * as THREE from 'three'
import type { Design, PvArray, PvModule, RoofPlane, SiteObject } from '../types'
import { planeSurface, planeFrame } from '../render3d/RoofPlane'
import { catalog } from '../catalog'
import { groundArrayLayout, siteFootprint } from './groundLayout'
import type { BoxOccluder, Occluder, ShadedSurface, Vec3 } from './shading'

const DEG = Math.PI / 180

/** Gap between module frames, metres. Matches the renderer. */
const MODULE_GAP_M = 0.02
/** Standoff above the roof surface, metres. Matches the renderer. */
const STANDOFF_M = 0.12

export interface ModuleFrame {
  row: number
  col: number
  /** Centre of the module face, scene coordinates. */
  position: THREE.Vector3
  /** Orientation basis: x across, y up-slope, z surface normal. */
  basis: THREE.Matrix4
  width_m: number
  height_m: number
}

/**
 * World placement of every enabled module in a roof-mounted array.
 *
 * Shared by the renderer and the shading calculation. Keeping one copy means
 * the picture and the number can never disagree about where the modules are.
 */
export function roofModuleFrames(
  array: PvArray,
  plane: RoofPlane,
  module: PvModule,
): ModuleFrame[] {
  const long = module.length_mm / 1000
  const short = module.width_mm / 1000
  const w = array.layout === 'portrait' ? short : long
  const h = array.layout === 'portrait' ? long : short

  const surface = planeSurface({
    ...plane,
    tilt_deg: array.tilt_deg ?? plane.tilt_deg,
    azimuth_deg: array.azimuth_deg ?? plane.azimuth_deg,
  })
  const { right, upSlope, normal } = surface.frame

  const pitchX = w + MODULE_GAP_M
  const pitchY = h + MODULE_GAP_M
  const offsetX = ((array.cols - 1) * pitchX) / 2
  const offsetY = ((array.rows - 1) * pitchY) / 2

  const basis = new THREE.Matrix4().makeBasis(right, upSlope, normal)
  const out: ModuleFrame[] = []

  for (const pos of array.module_positions) {
    if (!pos.enabled) continue
    const position = surface.centroid
      .clone()
      .addScaledVector(right, pos.col * pitchX - offsetX)
      .addScaledVector(upSlope, pos.row * pitchY - offsetY)
      .addScaledVector(normal, STANDOFF_M)

    out.push({ row: pos.row, col: pos.col, position, basis, width_m: w, height_m: h })
  }

  return out
}

/**
 * Sample points spread across a module face.
 *
 * A 3x3 grid inset slightly from the edges. More points resolve partial
 * shading better; nine is enough to distinguish "clipped corner" from "half
 * covered" without making the calculation sluggish.
 */
export function sampleModuleFace(frame: ModuleFrame): Vec3[] {
  const right = new THREE.Vector3().setFromMatrixColumn(frame.basis, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(frame.basis, 1)

  const out: Vec3[] = []
  for (const fx of [-0.35, 0, 0.35]) {
    for (const fy of [-0.35, 0, 0.35]) {
      const p = frame.position
        .clone()
        .addScaledVector(right, fx * frame.width_m)
        .addScaledVector(up, fy * frame.height_m)
      out.push({ x: p.x, y: p.y, z: p.z })
    }
  }
  return out
}

/**
 * Occluders for one site object.
 *
 * Trees become a sphere sized to the canopy. Conifers get a slightly smaller
 * effective radius, since a cone occupies less of its bounding sphere than a
 * rounded canopy does.
 *
 * Buildings become a single box spanning walls plus roof — close enough at the
 * scale shading matters, and much cheaper than a gable-accurate solid.
 */
export function siteObjectToOccluders(obj: SiteObject): Occluder[] {
  const cx = obj.x
  const cz = -obj.y

  if (obj.kind.startsWith('tree-')) {
    const conifer = obj.kind === 'tree-conifer'
    const height = Math.max(1, obj.height_m)
    const spread = Math.max(0.5, obj.width_m)
    const trunkH = conifer ? height * 0.18 : height * 0.42
    // Centre of the canopy mass, and a radius that covers most of it.
    const canopyCentre = trunkH + (height - trunkH) * (conifer ? 0.45 : 0.5)
    const radius = conifer ? spread * 0.42 : spread * 0.52

    return [
      {
        kind: 'sphere',
        id: obj.id,
        label: obj.name,
        center: { x: cx, y: canopyCentre, z: cz },
        radius,
      },
    ]
  }

  const w = Math.max(0.5, obj.width_m)
  const d = Math.max(0.5, obj.depth_m)
  const h = Math.max(0.5, obj.height_m)
  const rise = (d / 2) * Math.tan(Math.max(0, Math.min(60, obj.roof_pitch_deg)) * DEG)
  const total = h + rise

  return [
    {
      kind: 'box',
      id: obj.id,
      label: obj.name,
      center: { x: cx, y: total / 2, z: cz },
      half: { x: w / 2, y: total / 2, z: d / 2 },
      rotation_deg: obj.rotation_deg,
    },
  ]
}

export interface SiteShadingGeometry {
  surfaces: ShadedSurface[]
  occluders: Occluder[]
}

/**
 * Surfaces and inter-row occluders for one ground, pole or tracker array.
 *
 * Fixed and pole arrays are laid out at their real tilt. Each *row* of tables
 * becomes one box occluder so the front rows shade the rows behind them — the
 * shading question that actually decides ground-array spacing. A module ignores
 * its own row (`skip_occluder_id`): its sample points sit inside that box, and a
 * south-tilted panel presents only a thin edge to its east-west neighbours, so
 * modelling within-row blocking would invent a summer loss that is not there.
 * The remaining loss is the real north-south inter-row shading, worst in winter.
 *
 * Trackers are laid out flat and marked `tracking`, so the irradiance weighting
 * treats them as sun-facing. They get NO inter-row occluders: backtracking is
 * designed to keep the rows out of each other's shadow, so modelling the tables
 * as solid blockers would invent a loss the mount exists to prevent. External
 * objects (trees, buildings) still shade them.
 */
function groundArrayShading(
  array: PvArray,
  module: PvModule,
  mount: (typeof catalog.mounts)[number],
  footprint: ReturnType<typeof siteFootprint>,
  latitude_deg: number,
): SiteShadingGeometry {
  const layout = groundArrayLayout(array, mount, module, footprint, latitude_deg, null)
  if (!layout) return { surfaces: [], occluders: [] }

  const isTracker = mount.kind === 'tracker'
  const tilt = array.tilt_deg ?? mount.tilt_max_deg ?? 30
  const azimuth = array.azimuth_deg ?? 180

  // Axes in plan: `back` runs down the rows (north–south for a south array),
  // `across` runs along a row. A row is one bucket of `back` projection.
  const back = planeFrame(azimuth, 0).downhill
  const across = planeFrame(azimuth, 0).right
  const backProj = (p: THREE.Vector3) => p.x * back.x + p.z * back.z
  const rowBucket = (p: THREE.Vector3) => Math.round(backProj(p) / layout.rowPitch)

  // Group tables into rows and give each row a single occluder box.
  const occluders: BoxOccluder[] = []
  const rowIdById = new Map<number, string>()
  if (!isTracker) {
    const rows = new Map<number, THREE.Vector3[]>()
    for (const t of layout.tables) {
      const b = rowBucket(t.origin)
      ;(rows.get(b) ?? rows.set(b, []).get(b)!).push(t.origin)
    }
    for (const [bucket, origins] of rows) {
      const acrossVals = origins.map((o) => o.x * across.x + o.z * across.z)
      const halfAcross = (Math.max(...acrossVals) - Math.min(...acrossVals)) / 2 + layout.tableW / 2
      const cx = origins.reduce((s, o) => s + o.x, 0) / origins.length
      const cz = origins.reduce((s, o) => s + o.z, 0) / origins.length
      const id = `${array.id}:row:${bucket}`
      rowIdById.set(bucket, id)
      occluders.push({
        kind: 'box',
        id,
        label: `${array.name} row`,
        center: { x: cx, y: origins[0].y, z: cz },
        half: {
          x: halfAcross,
          y: Math.max(0.05, (layout.tableH / 2) * Math.sin(tilt * DEG)),
          z: Math.max(0.05, (layout.tableH / 2) * Math.cos(tilt * DEG)),
        },
        rotation_deg: azimuth - 180,
      })
    }
  }

  const surfaces: ShadedSurface[] = layout.modules.map((frame, i) => ({
    id: `${array.id}:${frame.row}:${frame.col}:${i}`,
    samples: sampleModuleFace(frame),
    tilt_deg: isTracker ? 0 : tilt,
    azimuth_deg: azimuth,
    tracking: isTracker || undefined,
    skip_occluder_id: isTracker ? undefined : rowIdById.get(rowBucket(frame.position)),
  }))

  return { surfaces, occluders }
}

/**
 * Build everything the shading engine needs from a design.
 *
 * Roof arrays are sampled on their plane; ground, pole and tracker arrays are
 * laid out by the shared ground layout and sampled there. Inter-row shading is
 * modelled for fixed ground arrays; trackers rely on backtracking.
 */
export function buildShadingGeometry(
  design: Design,
  modules: readonly PvModule[],
): SiteShadingGeometry {
  const surfaces: ShadedSurface[] = []
  const arrayOccluders: Occluder[] = []
  const footprint = siteFootprint(design.planes)

  for (const array of design.arrays) {
    const module = modules.find((m) => m.id === array.module_id)
    if (!module) continue
    const mount = catalog.mounts.find((m) => m.id === array.mount_id)

    if (!mount || mount.kind === 'roof') {
      const plane = design.planes.find((p) => p.id === array.plane_id)
      if (!plane) continue
      const tilt = array.tilt_deg ?? plane.tilt_deg
      const azimuth = array.azimuth_deg ?? plane.azimuth_deg
      for (const frame of roofModuleFrames(array, plane, module)) {
        surfaces.push({
          id: `${array.id}:${frame.row}:${frame.col}`,
          samples: sampleModuleFace(frame),
          tilt_deg: tilt,
          azimuth_deg: azimuth,
        })
      }
    } else {
      const g = groundArrayShading(array, module, mount, footprint, design.site.latitude_deg)
      surfaces.push(...g.surfaces)
      arrayOccluders.push(...g.occluders)
    }
  }

  /*
    Roof planes are deliberately NOT occluders. A module cannot be shaded by
    the roof it is mounted on, and adding the plane as a solid meant every
    module sat inside its own obstruction and read as permanently shaded.
    Cross-shading between separate roof planes would need per-surface
    exclusion of the module's own plane; not modelled today.

    Ground-array tables ARE occluders (inter-row shading), but each module
    skips its own table via skip_occluder_id — see groundArrayShading.
  */
  const occluders: Occluder[] = [
    ...design.site_objects.flatMap(siteObjectToOccluders),
    ...arrayOccluders,
  ]

  return { surfaces, occluders }
}
