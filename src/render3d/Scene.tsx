/**
 * The 3D view.
 *
 * Renders the roof planes, the modules on them, and the sun at the scrubbed
 * date/time so shadows fall where they really would.
 */

import { Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import { catalog } from '../catalog'
import { useStore } from '../store'
import { RoofPlane } from './RoofPlane'
import { ModuleArray } from './ModuleArray'
import { GroundArray } from './GroundArray'
import { SunLight, useIsNight } from './SunLight'
import { Ground } from './Ground'
import { SiteObjects } from './SiteObjects'
import { GroundImage } from './GroundImage'
import { registerCamera } from './placement'
import { makeSiteObject } from '../siteObjectPresets'

/** Publishes the live camera so DOM drop handlers can project onto the ground. */
function CameraBridge() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  registerCamera(camera, size.width, size.height)
  return null
}

function SceneContents() {
  const planes = useStore((s) => s.design.planes)
  const arrays = useStore((s) => s.design.arrays)
  const selectArray = useStore((s) => s.selectArray)
  const armedTool = useStore((s) => s.armedTool)
  const setArmedTool = useStore((s) => s.setArmedTool)
  const addSiteObject = useStore((s) => s.addSiteObject)
  const siteObjects = useStore((s) => s.design.site_objects)
  const night = useIsNight()

  return (
    <>
      <color attach="background" args={[night ? '#0b1020' : '#8fb7e8']} />
      <fog attach="fog" args={[night ? '#0b1020' : '#8fb7e8', 90, 220]} />

      {!night && <Sky sunPosition={[0.4, 0.25, -1]} turbidity={6} rayleigh={1.2} />}

      <CameraBridge />
      <SunLight />
      <Ground />
      <GroundImage />
      <SiteObjects />

      {planes.map((plane) => (
        <RoofPlane key={plane.id} plane={plane} />
      ))}

      {arrays.map((array) => {
        const mount = catalog.mounts.find((m) => m.id === array.mount_id)
        const module = catalog.modules.find((m) => m.id === array.module_id)

        // Ground, pole and tracker mounts are free-standing structures with
        // their own posts and row spacing — they do not lie on a roof plane.
        if (mount && module && mount.kind !== 'roof') {
          return (
            <GroundArray key={array.id} array={array} module={module} mount={mount} />
          )
        }

        const plane = planes.find((p) => p.id === array.plane_id)
        if (!plane) return null
        return <ModuleArray key={array.id} array={array} plane={plane} />
      })}

      {/*
        Invisible ground catcher. With a palette tool armed it places the
        object where you tapped; otherwise a tap on empty space just clears
        the current selection.
      */}
      <mesh
        position={[0, -0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={(e) => {
          if (armedTool) {
            e.stopPropagation()
            const p = e.point
            addSiteObject(makeSiteObject(armedTool, p.x, -p.z, siteObjects))
            setArmedTool(null)
            return
          }
          selectArray(null)
        }}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </>
  )
}

export function Scene() {
  // Orbiting and dragging an object are the same gesture, so suspend the
  // camera controls while a site object is being moved.
  const dragging = useStore((s) => s.draggingObjectId)

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      // Framed to take in both the building and a ground array standing clear
      // of it to the south, rather than just the roof.
      camera={{ position: [26, 18, 34], fov: 45, near: 0.1, far: 500 }}
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
        enabled={dragging === null}
        enableDamping
        dampingFactor={0.1}
        minDistance={4}
        maxDistance={140}
        // Stop the camera dropping below grade.
        maxPolarAngle={Math.PI / 2 - 0.03}
        target={[6, 2, 4]}
      />
    </Canvas>
  )
}
