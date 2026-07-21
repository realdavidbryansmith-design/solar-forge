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
import { roofModuleFrames } from '../engine/siteGeometry'

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

  const shading = useStore((s) => s.shading)

  const module = catalog.modules.find((m) => m.id === array.module_id)
  const selected = selectedArrayId === array.id

  /** Per-module annual loss, keyed the same way siteGeometry builds surface ids. */
  const lossById = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of shading?.per_surface ?? []) m.set(p.id, p.loss_pct)
    return m
  }, [shading])

  const { cells, width, height } = useMemo(() => {
    if (!module) return { cells: [] as Cell[], width: 0, height: 0 }

    // Shared with the shading calculation, so the render and the measured
    // loss can never disagree about where the modules are.
    const frames = roofModuleFrames(array, plane, module)
    if (frames.length === 0) return { cells: [] as Cell[], width: 0, height: 0 }

    const out: Cell[] = frames.map((f) => ({
      row: f.row,
      col: f.col,
      matrix: f.basis.clone().setPosition(f.position),
    }))

    return { cells: out, width: frames[0].width_m, height: frames[0].height_m }
  }, [array, plane, module])

  const meshRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    cells.forEach((c, i) => mesh.setMatrixAt(i, c.matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()

    /*
      Tint each module by its own measured shading loss, so the picture and the
      number tell the same story. Unshaded modules keep the normal dark glass;
      losses ramp through amber to red.
    */
    if (!selected) {
      const c = new THREE.Color()
      cells.forEach((cell, i) => {
        const loss = lossById.get(`${array.id}:${cell.row}:${cell.col}`) ?? 0
        if (loss < 1) c.set('#0a0f1c')
        else if (loss < 15) c.set('#0a0f1c').lerp(new THREE.Color('#f59e0b'), loss / 15)
        else c.set('#f59e0b').lerp(new THREE.Color('#e11d48'), Math.min(1, (loss - 15) / 25))
        mesh.setColorAt(i, c)
      })
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
  }, [cells, lossById, array.id, selected])

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
        color={selected ? '#1e3a8a' : '#ffffff'}
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
