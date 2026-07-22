/**
 * Ground-mounted and tracker arrays, drawn as real structures.
 *
 * A ground array is not one continuous slab of glass. It is a set of discrete
 * tables, each carrying a limited number of modules, standing on posts, spaced
 * far enough apart not to shade each other. Trackers add a torque tube and
 * rotate through the day.
 *
 * The placement itself lives in `groundArrayLayout` so the same geometry drives
 * this view and the DXF export; here we only turn it into meshes.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Mount, PvArray, PvModule } from '../types'
import { groundArrayLayout, siteFootprint } from '../engine/groundLayout'
import { sunPositionSolarTime } from '../engine/solar'
import { useStore } from '../store'

const MODULE_THICK_M = 0.035

export interface GroundArrayProps {
  array: PvArray
  module: PvModule
  mount: Mount
}

export function GroundArray({ array, module, mount }: GroundArrayProps) {
  const sunDay = useStore((s) => s.sunDay)
  const sunHour = useStore((s) => s.sunHour)
  const latitude = useStore((s) => s.design.site.latitude_deg)
  const planes = useStore((s) => s.design.planes)
  const selectedArrayId = useStore((s) => s.selectedArrayId)
  const selectArray = useStore((s) => s.selectArray)

  const shading = useStore((s) => s.shading)

  const selected = selectedArrayId === array.id

  const footprint = useMemo(() => siteFootprint(planes), [planes])

  /** Per-module annual loss, keyed the same way siteGeometry builds surface ids. */
  const lossById = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of shading?.per_surface ?? []) m.set(p.id, p.loss_pct)
    return m
  }, [shading])

  // The tracker follows the current sun; fixed/pole mounts ignore it.
  const built = useMemo(() => {
    const sun = sunPositionSolarTime(latitude, sunDay, sunHour)
    return groundArrayLayout(array, mount, module, footprint, latitude, sun)
  }, [array, mount, module, footprint, latitude, sunDay, sunHour])

  const moduleRef = useRef<THREE.InstancedMesh>(null)
  const postRef = useRef<THREE.InstancedMesh>(null)
  const tubeRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    if (!built) return

    const mm = moduleRef.current
    if (mm) {
      built.modules.forEach((f, i) =>
        mm.setMatrixAt(i, f.basis.clone().setPosition(f.position)),
      )
      mm.instanceMatrix.needsUpdate = true
      mm.computeBoundingSphere()

      // Tint each module by its own measured shading loss — the same ramp the
      // roof arrays use, keyed the same way siteGeometry ids the surfaces.
      if (!selected) {
        const c = new THREE.Color()
        built.modules.forEach((f, i) => {
          const loss = lossById.get(`${array.id}:${f.row}:${f.col}:${i}`) ?? 0
          if (loss < 1) c.set('#0a0f1c')
          else if (loss < 15) c.set('#0a0f1c').lerp(new THREE.Color('#f59e0b'), loss / 15)
          else c.set('#f59e0b').lerp(new THREE.Color('#e11d48'), Math.min(1, (loss - 15) / 25))
          mm.setColorAt(i, c)
        })
        if (mm.instanceColor) mm.instanceColor.needsUpdate = true
      }
    }

    const pm = postRef.current
    if (pm) {
      const m = new THREE.Matrix4()
      built.posts.forEach((p, i) => {
        m.makeTranslation(p.x, p.height / 2, p.z)
        m.scale(new THREE.Vector3(1, p.height, 1))
        pm.setMatrixAt(i, m)
      })
      pm.instanceMatrix.needsUpdate = true
      pm.computeBoundingSphere()
    }

    const tm = tubeRef.current
    if (tm) {
      built.tables.forEach((t, i) => tm.setMatrixAt(i, t.basis))
      tm.instanceMatrix.needsUpdate = true
      tm.computeBoundingSphere()
    }
  }, [built, lossById, array.id, selected])

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
          // White base so the per-instance loss tint shows true; selection wins.
          color={selected ? '#1e3a8a' : '#ffffff'}
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
