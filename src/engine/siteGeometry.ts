/**
 * Bridge from the design to the shading engine.
 *
 * Converts site objects into occluders and modules into sampled surfaces. The
 * module layout here is the same function the renderer uses, so what you see
 * shaded in the 3D view is exactly what the calculation measured.
 */

import * as THREE from 'three'
import type { Design, PvArray, PvModule, RoofPlane, SiteObject } from '../types'
import { planeSurface } from '../render3d/RoofPlane'
import type { Occluder, ShadedSurface, Vec3 } from './shading'

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
 * Build everything the shading engine needs from a design.
 *
 * Only roof-mounted arrays are sampled today; ground and tracker arrays are
 * laid out by a different code path and are not yet wired in.
 */
export function buildShadingGeometry(
  design: Design,
  modules: readonly PvModule[],
): SiteShadingGeometry {
  const surfaces: ShadedSurface[] = []

  for (const array of design.arrays) {
    const plane = design.planes.find((p) => p.id === array.plane_id)
    const module = modules.find((m) => m.id === array.module_id)
    if (!plane || !module) continue

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
  }

  /*
    Roof planes are deliberately NOT occluders. A module cannot be shaded by
    the roof it is mounted on, and adding the plane as a solid meant every
    module sat inside its own obstruction and read as permanently shaded.
    Cross-shading between separate roof planes would need per-surface
    exclusion of the module's own plane; not modelled today.
  */
  const occluders: Occluder[] = design.site_objects.flatMap(siteObjectToOccluders)

  return { surfaces, occluders }
}
