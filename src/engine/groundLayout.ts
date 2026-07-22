/**
 * Ground-mount and tracker array layout.
 *
 * Extracted from the renderer so the same placement drives the 3D view, the
 * DXF export and (later) shading — the way roofModuleFrames does for roofs.
 * Nothing here reads the store or React; it is pure geometry.
 *
 * Positions are fixed in the ground; only the module *orientation* changes with
 * a tracker's rotation, so the caller passes the resolved orientation. The
 * renderer derives it from the sun each frame; a plan drawing passes the flat,
 * widest-footprint orientation.
 */

import * as THREE from 'three'
import type { Mount, PvArray, PvModule } from '../types'
import {
  backtrackingAngle,
  minimumRowSpacing,
  type SunPosition,
} from './solar'
import { planeFrame } from '../render3d/RoofPlane'
import type { ModuleFrame } from './siteGeometry'

const DEG = Math.PI / 180

export const GROUND_MODULE_GAP_M = 0.02
export const GROUND_TABLE_GAP_M = 1.0
export const TRACKER_AXIS_HEIGHT_M = 1.8
export const FIXED_CLEARANCE_M = 0.6

interface TableLayout {
  cols: number
  rows: number
}

/** Modules per table, shaped by mount type. Matches the original renderer. */
export function groundTableShape(perTable: number, kind: Mount['kind'], axes: number): TableLayout {
  if (kind === 'tracker' && axes === 1) {
    const rows = perTable >= 8 ? 2 : 1
    return { rows, cols: Math.ceil(perTable / rows) }
  }
  if (kind === 'pole' || (kind === 'tracker' && axes === 2)) {
    const cols = Math.max(1, Math.round(Math.sqrt(perTable * 1.3)))
    return { cols, rows: Math.max(1, Math.ceil(perTable / cols)) }
  }
  const rows = perTable >= 12 ? 4 : perTable >= 6 ? 3 : 2
  return { rows, cols: Math.max(1, Math.ceil(perTable / rows)) }
}

export interface GroundOrientation {
  /** Rotation about the torque tube for a single-axis tracker, degrees. */
  trackAngleDeg: number
  /** Fixed tilt, or a dual-axis tracker's elevation, degrees. */
  tiltDeg: number
}

/** Site footprint the array must stand clear of, in plan coordinates. */
export interface SiteFootprint {
  centreX: number
  centreY: number
  radius: number
}

/**
 * Orientation for the current instant.
 *
 * Trackers follow the sun (with backtracking where the mount supports it);
 * everything else is static at its fixed tilt. Passing a null sun gives the
 * flat, widest-footprint orientation used for plan drawings.
 */
export function resolveGroundOrientation(
  mount: Mount,
  array: PvArray,
  sun: SunPosition | null,
  gcr: number,
): GroundOrientation {
  const isTracker = mount.kind === 'tracker'
  const axes = mount.tracking_axes
  const fixedTilt = array.tilt_deg ?? mount.tilt_max_deg ?? 30
  const range = mount.tracking_range_deg ?? 55

  if (!isTracker || sun === null) {
    return { trackAngleDeg: 0, tiltDeg: isTracker ? 0 : fixedTilt }
  }

  if (axes >= 1 && axes !== 2) {
    const trackAngleDeg = mount.backtracking
      ? backtrackingAngle(sun, gcr, range)
      : Math.max(-range, Math.min(range, sun.altitude_deg > 0 ? sun.azimuth_deg - 180 : 0))
    return { trackAngleDeg, tiltDeg: 0 }
  }

  // Dual-axis: pitch up toward the sun's elevation.
  const tiltDeg =
    sun.altitude_deg > 0 ? Math.max(0, Math.min(mount.tilt_max_deg ?? 60, 90 - sun.altitude_deg)) : fixedTilt
  return { trackAngleDeg: 0, tiltDeg }
}

export interface GroundLayout {
  /** Module placements, in the same shape as roofModuleFrames. */
  modules: ModuleFrame[]
  /** Table centres and orientation, for torque tubes / rails. */
  tables: Array<{ origin: THREE.Vector3; basis: THREE.Matrix4 }>
  /** Post/mast placements: base position and height. */
  posts: Array<{ x: number; z: number; height: number }>
  tableW: number
  tableH: number
  rowPitch: number
  gcr: number
  isTracker: boolean
  axes: number
}

/**
 * Full ground/tracker array geometry for one instant's orientation.
 *
 * The layout (table grid, row pitch, standoff from the building) is
 * orientation-independent; only each module's basis rotates with the tracker.
 */
export function groundArrayLayout(
  array: PvArray,
  mount: Mount,
  module: PvModule,
  footprint: SiteFootprint,
  latitude_deg: number,
  sun: SunPosition | null,
): GroundLayout | null {
  const enabled = array.module_positions.filter((m) => m.enabled).length
  if (enabled === 0) return null

  const long = module.length_mm / 1000
  const short = module.width_mm / 1000
  const isPortrait = array.layout === 'portrait'
  const modW = isPortrait ? short : long
  const modH = isPortrait ? long : short

  const azimuth = array.azimuth_deg ?? 180
  const isTracker = mount.kind === 'tracker'
  const axes = mount.tracking_axes

  const perTable = Math.max(1, mount.modules_per_table ?? 20)
  const shape = groundTableShape(perTable, mount.kind, axes)
  const tableCount = Math.ceil(enabled / perTable)

  const tableW = shape.cols * modW + (shape.cols - 1) * GROUND_MODULE_GAP_M
  const tableH = shape.rows * modH + (shape.rows - 1) * GROUND_MODULE_GAP_M

  const fixedTilt = array.tilt_deg ?? mount.tilt_max_deg ?? 30
  const spacing = minimumRowSpacing({
    latitude_deg,
    tilt_deg: isTracker ? 30 : fixedTilt,
    module_length_m: tableH,
    design_hour: 9,
    azimuth_deg: azimuth,
  })
  const rowPitch = Number.isFinite(spacing.row_pitch_m)
    ? Math.max(spacing.row_pitch_m, tableH * 1.2)
    : tableH * 2.5
  const gcr = tableH / rowPitch

  const orient = resolveGroundOrientation(mount, array, sun, gcr)

  // Orientation basis for a table.
  let basis: THREE.Matrix4
  let axisHeight: number
  if (isTracker && axes === 1) {
    const axis = new THREE.Vector3(0, 0, -1)
    const q = new THREE.Quaternion().setFromAxisAngle(axis, orient.trackAngleDeg * DEG)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
    const up = new THREE.Vector3(0, 0, -1)
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
    basis = new THREE.Matrix4().makeBasis(right, up, normal)
    axisHeight = TRACKER_AXIS_HEIGHT_M
  } else {
    const f = planeFrame(azimuth, orient.tiltDeg)
    basis = new THREE.Matrix4().makeBasis(f.right, f.upSlope, f.normal)
    axisHeight =
      mount.kind === 'pole' || (isTracker && axes === 2)
        ? TRACKER_AXIS_HEIGHT_M + tableH / 2
        : FIXED_CLEARANCE_M + (tableH / 2) * Math.sin(fixedTilt * DEG)
  }

  const across =
    isTracker && axes === 1
      ? new THREE.Vector3(1, 0, 0)
      : planeFrame(azimuth, 0).right.clone()
  const back =
    isTracker && axes === 1
      ? new THREE.Vector3(0, 0, -1)
      : planeFrame(azimuth, 0).downhill.clone().negate()
  const siteOffsetDir = planeFrame(azimuth, 0).downhill.clone()

  const perRow = Math.max(1, Math.min(tableCount, Math.ceil(Math.sqrt(tableCount * 1.6))))
  const rowsOfTables = Math.ceil(tableCount / perRow)

  const tables: GroundLayout['tables'] = []
  const modules: ModuleFrame[] = []
  const posts: GroundLayout['posts'] = []

  const right = new THREE.Vector3().setFromMatrixColumn(basis, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(basis, 1)

  let placed = 0
  for (let t = 0; t < tableCount; t++) {
    const rowIdx = Math.floor(t / perRow)
    const colIdx = t % perRow
    const acrossOffset = (colIdx - (perRow - 1) / 2) * (tableW + GROUND_TABLE_GAP_M)
    const backOffset = (rowIdx - (rowsOfTables - 1) / 2) * rowPitch

    const origin = new THREE.Vector3()
      .addScaledVector(across, acrossOffset)
      .addScaledVector(back, backOffset)
      .add(new THREE.Vector3(footprint.centreX, 0, -footprint.centreY))
      .addScaledVector(siteOffsetDir, footprint.radius + 7)
    origin.y = axisHeight

    tables.push({ origin: origin.clone(), basis: basis.clone().setPosition(origin) })

    const remaining = Math.min(perTable, enabled - placed)
    for (let i = 0; i < remaining; i++) {
      const r = Math.floor(i / shape.cols)
      const c = i % shape.cols
      const dx = (c - (shape.cols - 1) / 2) * (modW + GROUND_MODULE_GAP_M)
      const dy = (r - (shape.rows - 1) / 2) * (modH + GROUND_MODULE_GAP_M)
      const position = origin
        .clone()
        .addScaledVector(right, dx)
        .addScaledVector(up, dy)
      modules.push({ row: r, col: c, position, basis, width_m: modW, height_m: modH })
    }
    placed += remaining

    if (mount.kind === 'pole' || isTracker) {
      posts.push({ x: origin.x, z: origin.z, height: axisHeight })
    } else {
      const nPosts = Math.max(2, Math.round(tableW / 3))
      for (let p = 0; p < nPosts; p++) {
        const dx = (p - (nPosts - 1) / 2) * (tableW / Math.max(1, nPosts - 1))
        const pos = origin.clone().addScaledVector(across, dx)
        posts.push({ x: pos.x, z: pos.z, height: FIXED_CLEARANCE_M + tableH * 0.25 })
      }
    }
  }

  return { modules, tables, posts, tableW, tableH, rowPitch, gcr, isTracker, axes }
}

/** Compute the site footprint the array stands clear of, from the roof planes. */
export function siteFootprint(planes: ReadonlyArray<{ polygon: Array<{ x: number; y: number }> }>): SiteFootprint {
  const pts = planes.flatMap((p) => p.polygon)
  if (pts.length === 0) return { centreX: 0, centreY: 0, radius: 0 }
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return { centreX: cx, centreY: cy, radius: Math.max(Math.max(...xs) - cx, Math.max(...ys) - cy, 0) }
}
