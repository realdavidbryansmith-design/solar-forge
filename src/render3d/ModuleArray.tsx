/**
 * Modules laid out on a roof plane.
 *
 * Every module in an array shares one geometry and one material, positioned via
 * an InstancedMesh. A 60-module array is one draw call, which keeps a phone
 * usable while dragging the sun slider.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { PvArray, RoofPlane as RoofPlaneModel } from '../types'
import { catalog } from '../catalog'
import { useStore } from '../store'
import { planeSurface } from './RoofPlane'

/** Gap between adjacent module frames, metres. */
const MODULE_GAP_M = 0.02
/** How far the module sits above the roof surface, metres. */
const STANDOFF_M = 0.12

export interface ModuleArrayProps {
  array: PvArray
  plane: RoofPlaneModel
}

interface Cell {
  row: number
  col: number
  matrix: THREE.Matrix4
}

export function ModuleArray({ array, plane }: ModuleArrayProps) {
  const selectedArrayId = useStore((s) => s.selectedArrayId)
  const selectArray = useStore((s) => s.selectArray)
  const toggleModule = useStore((s) => s.toggleModule)

  const module = catalog.modules.find((m) => m.id === array.module_id)
  const selected = selectedArrayId === array.id

  const { cells, width, height } = useMemo(() => {
    if (!module) return { cells: [] as Cell[], width: 0, height: 0 }

    // Portrait puts the module's long edge up the slope.
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

    // Centre the block of modules on the plane's centroid.
    const offsetX = ((array.cols - 1) * pitchX) / 2
    const offsetY = ((array.rows - 1) * pitchY) / 2

    const basis = new THREE.Matrix4().makeBasis(right, upSlope, normal)
    const out: Cell[] = []

    for (const pos of array.module_positions) {
      if (!pos.enabled) continue

      // Row 0 is the lowest row on the slope.
      const acrossDelta = pos.col * pitchX - offsetX
      const upDelta = pos.row * pitchY - offsetY

      const p = surface.centroid
        .clone()
        .addScaledVector(right, acrossDelta)
        .addScaledVector(upSlope, upDelta)
        .addScaledVector(normal, STANDOFF_M)

      out.push({
        row: pos.row,
        col: pos.col,
        matrix: basis.clone().setPosition(p),
      })
    }

    return { cells: out, width: w, height: h }
  }, [array, plane, module])

  const meshRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    cells.forEach((c, i) => mesh.setMatrixAt(i, c.matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [cells])

  if (!module || cells.length === 0) return null

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (!selected) {
      selectArray(array.id)
      return
    }
    // Once the array is selected, tapping a module toggles it off.
    const cell = e.instanceId !== undefined ? cells[e.instanceId] : undefined
    if (cell) toggleModule(array.id, cell.row, cell.col)
  }

  return (
    <instancedMesh
      ref={meshRef}
      // `key` forces a fresh buffer when the module count changes.
      key={`${array.id}-${cells.length}`}
      args={[undefined, undefined, cells.length]}
      castShadow
      receiveShadow
      onClick={handleClick}
    >
      {/* Thin slab: X across slope, Y up slope, Z out of the plane. */}
      <boxGeometry args={[width, height, 0.035]} />
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
  )
}
