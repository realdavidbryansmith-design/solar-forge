/**
 * The 3D view.
 *
 * Renders the roof planes, the modules on them, and the sun at the scrubbed
 * date/time so shadows fall where they really would.
 */

import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import { useStore } from '../store'
import { RoofPlane } from './RoofPlane'
import { ModuleArray } from './ModuleArray'
import { SunLight, useIsNight } from './SunLight'
import { Ground } from './Ground'

function SceneContents() {
  const planes = useStore((s) => s.design.planes)
  const arrays = useStore((s) => s.design.arrays)
  const selectArray = useStore((s) => s.selectArray)
  const night = useIsNight()

  return (
    <>
      <color attach="background" args={[night ? '#0b1020' : '#8fb7e8']} />
      <fog attach="fog" args={[night ? '#0b1020' : '#8fb7e8', 90, 220]} />

      {!night && <Sky sunPosition={[0.4, 0.25, -1]} turbidity={6} rayleigh={1.2} />}

      <SunLight />
      <Ground />

      {planes.map((plane) => (
        <RoofPlane key={plane.id} plane={plane} />
      ))}

      {arrays.map((array) => {
        const plane = planes.find((p) => p.id === array.plane_id)
        if (!plane) return null
        return <ModuleArray key={array.id} array={array} plane={plane} />
      })}

      {/* Tapping empty space clears the selection. */}
      <mesh
        position={[0, -0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={() => selectArray(null)}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </>
  )
}

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [16, 13, 20], fov: 45, near: 0.1, far: 500 }}
      // ACES tone mapping crushes the midtones that roof and module materials
      // live in; lift the exposure so surfaces stay readable.
      gl={{ toneMappingExposure: 1.35 }}
      // Let the page scroll when the gesture starts outside the canvas.
      style={{ touchAction: 'none' }}
    >
      <Suspense fallback={null}>
        <SceneContents />
      </Suspense>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minDistance={4}
        maxDistance={140}
        // Stop the camera dropping below grade.
        maxPolarAngle={Math.PI / 2 - 0.03}
        target={[0, 2, 0]}
      />
    </Canvas>
  )
}
