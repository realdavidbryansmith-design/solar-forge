/**
 * Ground-mounted and tracker arrays, drawn as real structures.
 *
 * A ground array is not one continuous slab of glass. It is a set of discrete
 * tables, each carrying a limited number of modules, standing on posts, spaced
 * far enough apart not to shade each other. Trackers add a torque tube and
 * rotate through the day.
 *
 * Table capacity comes from the mount catalog (`modules_per_table`), so a
 * 24-module array on a 12-module dual-axis pole mount correctly draws as two
 * separate poles rather than one impossible structure.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Mount, PvArray, PvModule } from '../types'
import { backtrackingAngle, minimumRowSpacing, sunPositionSolarTime } from '../engine/solar'
import { useStore } from '../store'
import { planeFrame } from './RoofPlane'

const DEG = Math.PI / 180
const MODULE_GAP_M = 0.02
const MODULE_THICK_M = 0.035
/** Gap between neighbouring tables in the same row, metres. */
const TABLE_GAP_M = 1.0
/** Height of the torque tube / pivot above grade for a tracker, metres. */
const TRACKER_AXIS_HEIGHT_M = 1.8
/** Height of the lowest module edge above grade for a fixed table, metres. */
const FIXED_CLEARANCE_M = 0.6

export interface GroundArrayProps {
  array: PvArray
  module: PvModule
  mount: Mount
}

interface TableLayout {
  /** Modules across the table's width. */
  cols: number
  /** Modules up the table's slope (or across the torque tube). */
  rows: number
}

/**
 * Split a table's module count into a realistic rows x cols shape.
 *
 * Trackers are built one or two modules deep along the tube and long in the
 * other direction. Fixed tables are stacked two to four high.
 */
function tableShape(perTable: number, kind: Mount['kind'], axes: number): TableLayout {
  if (kind === 'tracker' && axes === 1) {
    // Horizontal single-axis: 2-up portrait is the common utility layout.
    const rows = perTable >= 8 ? 2 : 1
    return { rows, cols: Math.ceil(perTable / rows) }
  }
  if (kind === 'pole' || (kind === 'tracker' && axes === 2)) {
    // Pole mounts are roughly square so the mast stays balanced.
    const cols = Math.max(1, Math.round(Math.sqrt(perTable * 1.3)))
    return { cols, rows: Math.max(1, Math.ceil(perTable / cols)) }
  }
  const rows = perTable >= 12 ? 4 : perTable >= 6 ? 3 : 2
  return { rows, cols: Math.max(1, Math.ceil(perTable / rows)) }
}

export function GroundArray({ array, module, mount }: GroundArrayProps) {
  const sunDay = useStore((s) => s.sunDay)
  const sunHour = useStore((s) => s.sunHour)
  const latitude = useStore((s) => s.design.site.latitude_deg)
  const planes = useStore((s) => s.design.planes)
  const selectedArrayId = useStore((s) => s.selectedArrayId)
  const selectArray = useStore((s) => s.selectArray)

  const selected = selectedArrayId === array.id

  /*
    Ground arrays are separate structures from the building, so stand them
    clear of the roof footprint instead of drawing them through the house.
    Set in front of the building (on the equator-facing side) where they would
    actually go.
  */
  const footprint = useMemo(() => {
    // Roof polygons are plan-view (x, y); scene coordinates use z = -y.
    const pts: Array<{ x: number; z: number }> = []
    for (const p of planes) for (const pt of p.polygon) pts.push({ x: pt.x, z: -pt.y })
    if (pts.length === 0) return { centre: new THREE.Vector3(), radius: 0 }

    const xs = pts.map((p) => p.x)
    const zs = pts.map((p) => p.z)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2
    const radius =
      Math.max(Math.max(...xs) - cx, Math.max(...zs) - cz, 0)
    return { centre: new THREE.Vector3(cx, 0, cz), radius }
  }, [planes])

  const built = useMemo(() => {
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

    // How many modules one physical structure can carry.
    const perTable = Math.max(1, mount.modules_per_table ?? 20)
    const shape = tableShape(perTable, mount.kind, axes)
    const tableCount = Math.ceil(enabled / perTable)

    const tableW = shape.cols * modW + (shape.cols - 1) * MODULE_GAP_M
    const tableH = shape.rows * modH + (shape.rows - 1) * MODULE_GAP_M

    // --- tilt --------------------------------------------------------------
    const sun = sunPositionSolarTime(latitude, sunDay, sunHour)
    const fixedTilt = array.tilt_deg ?? mount.tilt_max_deg ?? 30

    // Ground coverage ratio drives how hard a tracker has to backtrack.
    const spacing = minimumRowSpacing({
      latitude_deg: latitude,
      tilt_deg: isTracker ? 30 : fixedTilt,
      module_length_m: tableH,
      design_hour: 9,
      azimuth_deg: azimuth,
    })
    const rowPitch = Number.isFinite(spacing.row_pitch_m)
      ? Math.max(spacing.row_pitch_m, tableH * 1.2)
      : tableH * 2.5
    const gcr = tableH / rowPitch

    // A tracker's rotation follows the sun; everything else is static.
    const trackAngle =
      isTracker && axes >= 1
        ? (mount.backtracking
            ? backtrackingAngle(sun, gcr, mount.tracking_range_deg ?? 55)
            : Math.max(
                -(mount.tracking_range_deg ?? 55),
                Math.min(mount.tracking_range_deg ?? 55, sun.altitude_deg > 0 ? sun.azimuth_deg - 180 : 0),
              ))
        : 0

    // Dual-axis also pitches up toward the sun's elevation.
    const elevationTilt =
      isTracker && axes === 2 && sun.altitude_deg > 0
        ? Math.max(0, Math.min(mount.tilt_max_deg ?? 60, 90 - sun.altitude_deg))
        : fixedTilt

    // --- orientation of one table ------------------------------------------
    let basis: THREE.Matrix4
    let axisHeight: number

    if (isTracker && axes === 1) {
      // Torque tube runs north-south; modules rotate about it east-west.
      const axis = new THREE.Vector3(0, 0, -1)
      const q = new THREE.Quaternion().setFromAxisAngle(axis, trackAngle * DEG)
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q)
      const up = new THREE.Vector3(0, 0, -1)
      const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q)
      basis = new THREE.Matrix4().makeBasis(right, up, normal)
      axisHeight = TRACKER_AXIS_HEIGHT_M
    } else {
      // Fixed tilt, pole, or dual-axis: a plane facing the array azimuth.
      const f = planeFrame(azimuth, isTracker && axes === 2 ? elevationTilt : fixedTilt)
      basis = new THREE.Matrix4().makeBasis(f.right, f.upSlope, f.normal)
      axisHeight =
        mount.kind === 'pole' || (isTracker && axes === 2)
          ? TRACKER_AXIS_HEIGHT_M + tableH / 2
          : FIXED_CLEARANCE_M + (tableH / 2) * Math.sin(fixedTilt * DEG)
    }

    // --- lay the tables out on the ground ----------------------------------
    // Rows step away from the sun's side; tables sit shoulder to shoulder.
    const across =
      isTracker && axes === 1
        ? new THREE.Vector3(1, 0, 0) // trackers are spaced east-west
        : planeFrame(azimuth, 0).right.clone()
    const back =
      isTracker && axes === 1
        ? new THREE.Vector3(0, 0, -1)
        : planeFrame(azimuth, 0).downhill.clone().negate()

    // Push away from the house toward the sun-facing side.
    const siteOffsetDir = planeFrame(azimuth, 0).downhill.clone()

    const perRow = Math.max(1, Math.min(tableCount, Math.ceil(Math.sqrt(tableCount * 1.6))))
    const rowsOfTables = Math.ceil(tableCount / perRow)

    const tables: Array<{ matrix: THREE.Matrix4; origin: THREE.Vector3 }> = []
    const modules: THREE.Matrix4[] = []
    const posts: THREE.Matrix4[] = []

    let placed = 0
    for (let t = 0; t < tableCount; t++) {
      const rowIdx = Math.floor(t / perRow)
      const colIdx = t % perRow

      const acrossOffset =
        (colIdx - (perRow - 1) / 2) *
        ((isTracker && axes === 1 ? tableW : tableW) + TABLE_GAP_M)
      const backOffset = (rowIdx - (rowsOfTables - 1) / 2) * rowPitch

      const origin = new THREE.Vector3()
        .addScaledVector(across, acrossOffset)
        .addScaledVector(back, backOffset)
        // Stand the whole block clear of the building footprint.
        .add(footprint.centre)
        .addScaledVector(siteOffsetDir, footprint.radius + 7)
      origin.y = axisHeight

      tables.push({ matrix: basis.clone().setPosition(origin), origin: origin.clone() })

      // Modules on this table.
      const right = new THREE.Vector3().setFromMatrixColumn(basis, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(basis, 1)
      const remaining = Math.min(perTable, enabled - placed)
      for (let i = 0; i < remaining; i++) {
        const r = Math.floor(i / shape.cols)
        const c = i % shape.cols
        const dx = (c - (shape.cols - 1) / 2) * (modW + MODULE_GAP_M)
        const dy = (r - (shape.rows - 1) / 2) * (modH + MODULE_GAP_M)
        const p = origin
          .clone()
          .addScaledVector(right, dx)
          .addScaledVector(up, dy)
        modules.push(basis.clone().setPosition(p))
      }
      placed += remaining

      // Posts: one pair per fixed table, one mast for a pole/tracker.
      if (mount.kind === 'pole' || isTracker) {
        const m = new THREE.Matrix4().makeTranslation(
          origin.x,
          axisHeight / 2,
          origin.z,
        )
        m.scale(new THREE.Vector3(1, axisHeight, 1))
        posts.push(m)
      } else {
        const nPosts = Math.max(2, Math.round(tableW / 3))
        for (let p = 0; p < nPosts; p++) {
          const dx = (p - (nPosts - 1) / 2) * (tableW / Math.max(1, nPosts - 1))
          const pos = origin.clone().addScaledVector(across, dx)
          const h = FIXED_CLEARANCE_M + tableH * 0.25
          const m = new THREE.Matrix4().makeTranslation(pos.x, h / 2, pos.z)
          m.scale(new THREE.Vector3(1, h, 1))
          posts.push(m)
        }
      }
    }

    return {
      modules,
      posts,
      tables,
      tableW,
      tableH,
      isTracker,
      axes,
      trackAngle,
      rowPitch,
      gcr,
    }
  }, [array, module, mount, latitude, sunDay, sunHour, footprint])

  const moduleRef = useRef<THREE.InstancedMesh>(null)
  const postRef = useRef<THREE.InstancedMesh>(null)
  const tubeRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    if (!built) return
    const mm = moduleRef.current
    if (mm) {
      built.modules.forEach((m, i) => mm.setMatrixAt(i, m))
      mm.instanceMatrix.needsUpdate = true
      mm.computeBoundingSphere()
    }
    const pm = postRef.current
    if (pm) {
      built.posts.forEach((m, i) => pm.setMatrixAt(i, m))
      pm.instanceMatrix.needsUpdate = true
      pm.computeBoundingSphere()
    }
    const tm = tubeRef.current
    if (tm) {
      built.tables.forEach((t, i) => tm.setMatrixAt(i, t.matrix))
      tm.instanceMatrix.needsUpdate = true
      tm.computeBoundingSphere()
    }
  }, [built])

  if (!built) return null

  const modLong = module.length_mm / 1000
  const modShort = module.width_mm / 1000
  const isPortrait = array.layout === 'portrait'
  const modW = isPortrait ? modShort : modLong
  const modH = isPortrait ? modLong : modShort

  return (
    <group onClick={(e) => { e.stopPropagation(); selectArray(array.id) }}>
      {/* Modules */}
      <instancedMesh
        ref={moduleRef}
        key={`mod-${built.modules.length}`}
        args={[undefined, undefined, built.modules.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[modW, modH, MODULE_THICK_M]} />
        <meshStandardMaterial
          color={selected ? '#1e3a8a' : '#0a0f1c'}
          // PV glass reads dark and only faintly glossy in real light. Low
          // roughness here blew out to white under a grazing sun.
          roughness={0.62}
          metalness={0.04}
          emissive={selected ? '#1d4ed8' : '#000000'}
          emissiveIntensity={selected ? 0.25 : 0}
        />
      </instancedMesh>

      {/* Posts / masts — unit-height boxes scaled per instance */}
      <instancedMesh
        ref={postRef}
        key={`post-${built.posts.length}`}
        args={[undefined, undefined, built.posts.length]}
        castShadow
      >
        <boxGeometry args={[0.12, 1, 0.12]} />
        <meshStandardMaterial color="#9aa3ad" roughness={0.6} metalness={0.7} />
      </instancedMesh>

      {/* Torque tube (trackers) or mounting rail (fixed) along each table */}
      <instancedMesh
        ref={tubeRef}
        key={`tube-${built.tables.length}-${built.isTracker}`}
        args={[undefined, undefined, built.tables.length]}
        castShadow
      >
        {built.isTracker && built.axes === 1 ? (
          // Runs the length of the tube, i.e. along the table's "up" axis.
          <boxGeometry args={[0.14, built.tableH * 1.02, 0.14]} />
        ) : (
          <boxGeometry args={[built.tableW * 1.02, 0.08, 0.08]} />
        )}
        <meshStandardMaterial color="#8b939d" roughness={0.55} metalness={0.75} />
      </instancedMesh>
    </group>
  )
}
