/**
 * Site context: buildings and trees.
 *
 * These are not decoration. A solar site assessment is mostly about what is
 * *around* the array — a barn to the south-west or a mature oak on the south
 * side is usually the reason a given location does not work. Everything here
 * casts a real shadow, so scrubbing the sun shows exactly when a tree crosses
 * the array.
 */

import { useCallback, useMemo } from 'react'
import * as THREE from 'three'
import type { SiteObject } from '../types'
import type { ThreeEvent } from '@react-three/fiber'
import { useStore } from '../store'

const DEG = Math.PI / 180

/** Plan (x, y) to scene (x, z). The scene's -Z is north. */
function toScene(x: number, y: number): [number, number] {
  return [x, -y]
}

const WALL_COLORS: Record<string, string> = {
  house: '#c9c3b6',
  barn: '#8a3b32',
  shed: '#9aa08f',
  garage: '#bfb9ad',
}

const ROOF_COLORS: Record<string, string> = {
  house: '#4a4a4e',
  barn: '#5a5f66',
  shed: '#3f4348',
  garage: '#4a4a4e',
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * A building: box walls with a gable roof.
 *
 * The gable is two tilted slabs meeting at a ridge running along the width,
 * which is what most houses and barns actually look like from the air.
 */
function Building({ obj }: { obj: SiteObject }) {
  const [sx, sz] = toScene(obj.x, obj.y)
  const w = Math.max(0.5, obj.width_m)
  const d = Math.max(0.5, obj.depth_m)
  const h = Math.max(0.5, obj.height_m)
  const pitch = Math.max(0, Math.min(60, obj.roof_pitch_deg))

  // Ridge sits above the eave by half the depth times the pitch.
  const rise = (d / 2) * Math.tan(pitch * DEG)
  const slopeLen = Math.hypot(d / 2, rise)

  const wall = WALL_COLORS[obj.kind] ?? '#bdb7ab'
  const roof = ROOF_COLORS[obj.kind] ?? '#4a4a4e'

  return (
    <group position={[sx, 0, sz]} rotation={[0, -obj.rotation_deg * DEG, 0]}>
      {/* Walls */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={wall} roughness={0.9} />
      </mesh>

      {/* Gable ends, drawn as thin triangular prisms so the roof reads solid */}
      {pitch > 1 ? (
        <>
          <GableEnd w={w} d={d} h={h} rise={rise} z={d / 2} color={wall} />
          <GableEnd w={w} d={d} h={h} rise={rise} z={-d / 2} color={wall} />
        </>
      ) : null}

      {/* Two roof slabs */}
      {pitch > 1 ? (
        <>
          <mesh
            position={[0, h + rise / 2, d / 4]}
            rotation={[-pitch * DEG, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[w * 1.04, 0.12, slopeLen * 1.02]} />
            <meshStandardMaterial color={roof} roughness={0.92} />
          </mesh>
          <mesh
            position={[0, h + rise / 2, -d / 4]}
            rotation={[pitch * DEG, 0, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[w * 1.04, 0.12, slopeLen * 1.02]} />
            <meshStandardMaterial color={roof} roughness={0.92} />
          </mesh>
        </>
      ) : (
        <mesh position={[0, h + 0.06, 0]} castShadow receiveShadow>
          <boxGeometry args={[w * 1.04, 0.12, d * 1.04]} />
          <meshStandardMaterial color={roof} roughness={0.92} />
        </mesh>
      )}
    </group>
  )
}

/** Triangular wall filling the gable at one end of a building. */
function GableEnd({
  w,
  h,
  rise,
  z,
  color,
}: {
  w: number
  d: number
  h: number
  rise: number
  z: number
  color: string
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape()
    shape.moveTo(-w / 2, 0)
    shape.lineTo(w / 2, 0)
    shape.lineTo(0, rise)
    shape.closePath()
    return new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false })
  }, [w, rise])

  return (
    <mesh geometry={geometry} position={[0, h, z]} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * A tree: trunk plus canopy.
 *
 * Deciduous canopies are drawn as overlapping spheres, conifers as a stack of
 * cones. Both are deliberately opaque — for shading purposes a tree in leaf is
 * effectively solid, and showing it as solid keeps the shadow honest.
 */
function Tree({ obj }: { obj: SiteObject }) {
  const [sx, sz] = toScene(obj.x, obj.y)
  const height = Math.max(1, obj.height_m)
  const spread = Math.max(0.5, obj.width_m)
  const conifer = obj.kind === 'tree-conifer'

  const trunkH = conifer ? height * 0.18 : height * 0.42
  const trunkR = Math.max(0.08, spread * 0.045)

  return (
    <group position={[sx, 0, sz]}>
      <mesh position={[0, trunkH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[trunkR * 0.8, trunkR, trunkH, 8]} />
        <meshStandardMaterial color="#5b4636" roughness={0.95} />
      </mesh>

      {conifer ? (
        // Three stacked cones, narrowing toward the top.
        [0, 1, 2].map((i) => {
          const frac = i / 3
          const y = trunkH + (height - trunkH) * frac
          const segH = (height - trunkH) * 0.5
          const r = (spread / 2) * (1 - frac * 0.55)
          return (
            <mesh key={i} position={[0, y + segH / 2, 0]} castShadow receiveShadow>
              <coneGeometry args={[r, segH, 10]} />
              <meshStandardMaterial color="#2f5d3a" roughness={0.95} />
            </mesh>
          )
        })
      ) : (
        // Overlapping spheres give a rounded, slightly irregular canopy.
        [
          { p: [0, trunkH + (height - trunkH) * 0.45, 0], r: spread * 0.5 },
          { p: [spread * 0.18, trunkH + (height - trunkH) * 0.7, spread * 0.1], r: spread * 0.34 },
          { p: [-spread * 0.2, trunkH + (height - trunkH) * 0.62, -spread * 0.12], r: spread * 0.32 },
        ].map((c, i) => (
          <mesh
            key={i}
            position={c.p as [number, number, number]}
            castShadow
            receiveShadow
          >
            <sphereGeometry args={[c.r, 12, 10]} />
            <meshStandardMaterial color="#3d6b34" roughness={0.95} />
          </mesh>
        ))
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------

/**
 * Makes a site object draggable across the ground.
 *
 * Pointer capture keeps the drag alive when the pointer leaves the object's
 * own geometry, which it immediately does once the object starts moving.
 * Works for touch as well as mouse, since these are pointer events.
 */
function Draggable({ id, children }: { id: string; children: React.ReactNode }) {
  const updateSiteObject = useStore((s) => s.updateSiteObject)
  const setDraggingObject = useStore((s) => s.setDraggingObject)
  const dragging = useStore((s) => s.draggingObjectId)
  const armedTool = useStore((s) => s.armedTool)

  const onDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // While a palette tool is armed the click belongs to placement.
      if (armedTool) return
      e.stopPropagation()
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
      setDraggingObject(id)
    },
    [armedTool, id, setDraggingObject],
  )

  const onMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (dragging !== id) return
      e.stopPropagation()
      // e.point is on whatever was hit; project onto the ground instead so the
      // object tracks the pointer rather than its own surface.
      const origin = e.ray.origin
      const dir = e.ray.direction
      if (Math.abs(dir.y) < 1e-6) return
      const t = -origin.y / dir.y
      if (t <= 0) return
      const x = origin.x + dir.x * t
      const z = origin.z + dir.z * t
      updateSiteObject(id, { x, y: -z })
    },
    [dragging, id, updateSiteObject],
  )

  const onUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (dragging !== id) return
      e.stopPropagation()
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
      setDraggingObject(null)
    },
    [dragging, id, setDraggingObject],
  )

  return (
    <group
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {children}
    </group>
  )
}

export function SiteObjects() {
  const objects = useStore((s) => s.design.site_objects)

  return (
    <group>
      {objects.map((o) => (
        <Draggable key={o.id} id={o.id}>
          {o.kind.startsWith('tree-') ? <Tree obj={o} /> : <Building obj={o} />}
        </Draggable>
      ))}
    </group>
  )
}
