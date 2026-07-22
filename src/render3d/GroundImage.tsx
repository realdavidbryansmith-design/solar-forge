/**
 * An aerial photo laid flat on the ground as a tracing underlay.
 *
 * Sits just above the grass and below everything else, unlit so it reads as a
 * reference image rather than a surface in the scene. Buildings and trees are
 * traced on top of it with the normal drag-and-drop.
 */

import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../store'

export function GroundImage() {
  const image = useStore((s) => s.design.site_image)
  const [texture, setTexture] = useState<THREE.Texture | null>(null)

  // Build (and dispose) the texture when the source image changes.
  useEffect(() => {
    if (!image) {
      setTexture(null)
      return
    }
    let disposed = false
    const loader = new THREE.TextureLoader()
    loader.load(image.data_url, (t) => {
      if (disposed) {
        t.dispose()
        return
      }
      t.colorSpace = THREE.SRGBColorSpace
      setTexture(t)
    })
    return () => {
      disposed = true
    }
  }, [image?.data_url])

  // Dispose the previous texture when it is replaced or the component unmounts.
  useEffect(() => {
    return () => {
      texture?.dispose()
    }
  }, [texture])

  const geometry = useMemo(() => {
    if (!image) return null
    const h = image.width_m / Math.max(0.01, image.aspect)
    return { w: image.width_m, h }
  }, [image?.width_m, image?.aspect])

  if (!image || !image.visible || !texture || !geometry) return null

  return (
    <mesh
      // Plan (x, y) -> scene (x, -y); lie flat, then rotate about vertical.
      position={[image.x, 0.03, -image.y]}
      rotation={[-Math.PI / 2, 0, (image.rotation_deg * Math.PI) / 180]}
      // Not raycast — clicks and drags should reach the ground plane beneath.
      raycast={() => null}
    >
      <planeGeometry args={[geometry.w, geometry.h]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={image.opacity}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  )
}
