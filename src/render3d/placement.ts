/**
 * Turning a screen position into a spot on the ground.
 *
 * Placement happens in the DOM (a drag from an HTML palette, or a tap), but
 * lands in the 3D scene. This module keeps a reference to the live camera so
 * DOM handlers outside the Canvas can project a pointer position onto the
 * ground plane.
 */

import * as THREE from 'three'

interface CameraRegistry {
  camera: THREE.Camera | null
  /** Canvas size in CSS pixels. */
  width: number
  height: number
}

const registry: CameraRegistry = { camera: null, width: 0, height: 0 }

/** Called from inside the Canvas whenever the camera or viewport changes. */
export function registerCamera(camera: THREE.Camera, width: number, height: number) {
  registry.camera = camera
  registry.width = width
  registry.height = height
}

const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hit = new THREE.Vector3()
const ndc = new THREE.Vector2()

/**
 * Project a client (viewport) position onto the ground plane.
 *
 * Returns plan-view coordinates in metres — the same frame RoofPlane.polygon
 * and SiteObject.x/y use, where +y is north and the scene's z is -y.
 *
 * Returns null when the ray misses the ground, which happens when the pointer
 * is above the horizon.
 */
export function screenToGround(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } | null {
  const { camera } = registry
  if (!camera) return null

  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1

  raycaster.setFromCamera(ndc, camera)
  const point = raycaster.ray.intersectPlane(groundPlane, hit)
  if (!point) return null

  // Scene z is negated plan y.
  return { x: point.x, y: -point.z }
}

/** Drag payload key used between the palette and the canvas. */
export const DRAG_MIME = 'application/x-solarforge-object'
