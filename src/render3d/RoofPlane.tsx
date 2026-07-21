/**
 * Roof plane geometry.
 *
 * Scene convention (shared by every file in this folder):
 *
 *   right-handed, Y up
 *   +X = east      -X = west
 *   +Z = south     -Z = north
 *   +Y = up
 *
 * A `RoofPlane.polygon` is a *plan-view* (map) outline in metres, so plan +x is
 * east and plan +y is north. The map->scene mapping is therefore
 *
 *   scene.x =  plan.x
 *   scene.z = -plan.y
 *
 * The polygon is the horizontal projection of the roof, not its slope length:
 * the tilted surface is the plan outline lifted onto the sloping plane, which
 * is exactly what a plan drawing means. Height above grade is
 *
 *   y(p) = eave_height_m + tan(tilt) * (sMax - dot(p, downhill))
 *
 * where `downhill` is the horizontal unit vector the plane faces (azimuth,
 * clockwise from north) and `sMax` is the largest downhill coordinate of the
 * polygon — i.e. the eave. So the eave sits at eave_height_m and the ridge
 * rises behind it, away from the facing direction.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import type { RoofPlane as RoofPlaneModel } from '../types'

const DEG = Math.PI / 180

/** Slab thickness drawn under the roof surface, metres. */
const ROOF_THICKNESS_M = 0.18

export interface PlaneFrame {
  /** Horizontal unit vector the plane faces (down the slope). */
  downhill: THREE.Vector3
  /** Horizontal unit vector across the slope; forms a right-handed basis. */
  right: THREE.Vector3
  /** Unit vector up the slope, lying in the tilted plane. */
  upSlope: THREE.Vector3
  /** Outward surface normal of the tilted plane. */
  normal: THREE.Vector3
}

/**
 * Orthonormal frame for a tilted plane.
 *
 * `makeBasis(right, upSlope, normal)` is right-handed, so it can be fed
 * straight into a Matrix4 for module placement.
 */
export function planeFrame(azimuth_deg: number, tilt_deg: number): PlaneFrame {
  const a = azimuth_deg * DEG
  const t = tilt_deg * DEG
  const sa = Math.sin(a)
  const ca = Math.cos(a)

  const downhill = new THREE.Vector3(sa, 0, -ca)
  const right = new THREE.Vector3(-ca, 0, -sa)
  const upSlope = new THREE.Vector3(-sa * Math.cos(t), Math.sin(t), ca * Math.cos(t))
  const normal = new THREE.Vector3(sa * Math.sin(t), Math.cos(t), -ca * Math.sin(t))

  return { downhill, right, upSlope, normal }
}

/** Plan-view polygon converted to scene ground coordinates (y omitted). */
export function planePolygonXZ(plane: RoofPlaneModel): Array<{ x: number; z: number }> {
  return plane.polygon.map((p) => ({ x: p.x, z: -p.y }))
}

export interface PlaneSurface {
  frame: PlaneFrame
  /** Height above grade of the tilted surface at a plan position. */
  heightAt: (x: number, z: number) => number
  /** Centre of the plan outline, on the tilted surface. */
  centroid: THREE.Vector3
}

/** Everything needed to put something on a plane's sloping surface. */
export function planeSurface(plane: RoofPlaneModel): PlaneSurface {
  const frame = planeFrame(plane.azimuth_deg, plane.tilt_deg)
  const pts = planePolygonXZ(plane)
  const slope = Math.tan(plane.tilt_deg * DEG)

  let sMax = -Infinity
  let cx = 0
  let cz = 0
  for (const p of pts) {
    const s = p.x * frame.downhill.x + p.z * frame.downhill.z
    if (s > sMax) sMax = s
    cx += p.x
    cz += p.z
  }
  if (!Number.isFinite(sMax)) sMax = 0
  if (pts.length > 0) {
    cx /= pts.length
    cz /= pts.length
  }

  const heightAt = (x: number, z: number) =>
    plane.eave_height_m +
    slope * (sMax - (x * frame.downhill.x + z * frame.downhill.z))

  return { frame, heightAt, centroid: new THREE.Vector3(cx, heightAt(cx, cz), cz) }
}

/**
 * Extruded slab whose top face is the tilted roof surface.
 *
 * The shape is triangulated flat in plan, laid down onto the ground plane, then
 * each vertex is raised to the sloping plane. Shearing vertically like this
 * keeps the plan footprint exactly as drawn.
 */
function buildRoofGeometry(plane: RoofPlaneModel): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  plane.polygon.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, p.y)
    else shape.lineTo(p.x, p.y)
  })
  shape.closePath()

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: ROOF_THICKNESS_M,
    bevelEnabled: false,
  })

  // Shape XY -> scene XZ: (x, y) becomes (x, 0, -y); extrusion depth becomes +Y.
  geom.rotateX(-Math.PI / 2)
  // Drop the slab so its *top* face is the roof surface.
  geom.translate(0, -ROOF_THICKNESS_M, 0)

  const surface = planeSurface(plane)
  const pos = geom.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    pos.setY(i, pos.getY(i) + surface.heightAt(x, z))
  }
  pos.needsUpdate = true
  geom.computeVertexNormals()
  geom.computeBoundingSphere()
  return geom
}

export interface RoofPlaneProps {
  plane: RoofPlaneModel
}

const ROOF_COLORS: Record<string, string> = {
  'comp-shingle': '#4a4a4e',
  tile: '#8a4b32',
  'standing-seam-metal': '#8d949c',
  'corrugated-metal': '#7d848c',
  'flat-membrane': '#b9b6ad',
  ground: '#6f7a5c',
}

export function RoofPlane({ plane }: RoofPlaneProps) {
  const geometry = useMemo(() => buildRoofGeometry(plane), [plane])

  // Dispose the previous geometry when the plane changes.
  useMemo(() => geometry, [geometry])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={ROOF_COLORS[plane.roof_type] ?? '#4a4a4e'}
        roughness={0.92}
        metalness={plane.roof_type.includes('metal') ? 0.5 : 0.02}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
