/**
 * Sun lighting driven by real solar geometry.
 *
 * Scene convention (right-handed, Y up):
 *   +X = east, +Y = up, -Z = north  (so +Z is south)
 *
 * Solar azimuth is measured clockwise from north, altitude above the horizon:
 *   x = r cos(alt) sin(az)
 *   z = -r cos(alt) cos(az)
 *   y = r sin(alt)
 *
 * Sanity check: at solar noon in the northern hemisphere the sun is due south
 * (az 180), giving x = 0 and z = +r — south of the origin — so shadows point
 * north, which is what you see on a real roof.
 */

import { useMemo } from 'react'
import { useStore } from '../store'
import { sunPositionSolarTime } from '../engine/solar'

const DEG = Math.PI / 180
/** How far away to place the light. Only direction matters for a directional light. */
const SUN_DISTANCE_M = 120
/** Half-extent of the shadow camera frustum, metres. */
const SHADOW_EXTENT_M = 40

export function SunLight() {
  const latitude = useStore((s) => s.design.site.latitude_deg)
  const sunDay = useStore((s) => s.sunDay)
  const sunHour = useStore((s) => s.sunHour)
  const showShadows = useStore((s) => s.showShadows)

  const { position, daylight, altitude } = useMemo(() => {
    const sun = sunPositionSolarTime(latitude, sunDay, sunHour)
    const alt = sun.altitude_deg
    const az = sun.azimuth_deg

    const cosAlt = Math.cos(alt * DEG)
    const p: [number, number, number] = [
      SUN_DISTANCE_M * cosAlt * Math.sin(az * DEG),
      SUN_DISTANCE_M * Math.sin(alt * DEG),
      -SUN_DISTANCE_M * cosAlt * Math.cos(az * DEG),
    ]

    // Fade out through twilight instead of snapping to black at the horizon.
    const day = Math.max(0, Math.min(1, (alt + 4) / 12))
    return { position: p, daylight: day, altitude: alt }
  }, [latitude, sunDay, sunHour])

  const night = daylight <= 0.01

  return (
    <>
      <directionalLight
        position={position}
        intensity={night ? 0 : 3.2 * daylight}
        // Warmer near the horizon, white overhead.
        color={altitude < 12 ? '#ffd2a1' : '#fffaf0'}
        castShadow={showShadows && !night}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0005}
        shadow-normalBias={0.02}
        shadow-camera-near={1}
        shadow-camera-far={SUN_DISTANCE_M * 2}
        shadow-camera-left={-SHADOW_EXTENT_M}
        shadow-camera-right={SHADOW_EXTENT_M}
        shadow-camera-top={SHADOW_EXTENT_M}
        shadow-camera-bottom={-SHADOW_EXTENT_M}
      />

      {/*
        Sky/ground bounce. Deliberately brighter than physically accurate: a low
        winter sun genuinely leaves the model too dark to design against, and
        legibility beats realism here. The directional light still carries the
        shadows, so sun angle stays readable.
      */}
      <hemisphereLight
        args={['#9ec5ff', '#6b5f4a', night ? 0.4 : 1.5 + 0.5 * daylight]}
      />
      <ambientLight intensity={night ? 0.2 : 0.55} />
    </>
  )
}

/** True when the sun is below the horizon at the current scrubber position. */
export function useIsNight(): boolean {
  const latitude = useStore((s) => s.design.site.latitude_deg)
  const sunDay = useStore((s) => s.sunDay)
  const sunHour = useStore((s) => s.sunHour)
  return sunPositionSolarTime(latitude, sunDay, sunHour).altitude_deg <= 0
}
