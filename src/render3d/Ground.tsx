/**
 * Ground plane, grid, and a north marker.
 *
 * Orientation has to be readable at a glance — a tilted array looks plausible
 * from any angle, so the compass is the only thing telling you the azimuth is
 * actually right.
 *
 * The cardinal letters are built from boxes rather than drei's <Text>. <Text>
 * fetches a font over the network and suspends until it arrives, which turns
 * the whole scene black when the app is offline — exactly the situation a
 * contractor on a roof will be in.
 */

const GROUND_SIZE_M = 200
const MARKER_RADIUS_M = 14
/** Stroke thickness of the letter glyphs, metres. */
const S = 0.28

type Bar = [x: number, y: number, w: number, h: number]

/** Glyphs drawn in a local 2D frame, later laid flat on the ground. */
const GLYPHS: Record<string, Bar[]> = {
  // Two uprights plus a diagonal, approximated by three short bars.
  N: [
    [-0.7, 0, S, 2],
    [0.7, 0, S, 2],
    [-0.32, 0.45, S, 1],
    [0, 0, S, 1],
    [0.32, -0.45, S, 1],
  ],
  // Three horizontals plus two half-height uprights.
  S: [
    [0, 1, 1.6, S],
    [0, 0, 1.6, S],
    [0, -1, 1.6, S],
    [-0.7, 0.5, S, 1],
    [0.7, -0.5, S, 1],
  ],
  E: [
    [-0.7, 0, S, 2],
    [0.1, 1, 1.4, S],
    [0.1, 0, 1.4, S],
    [0.1, -1, 1.4, S],
  ],
  W: [
    [-0.8, 0, S, 2],
    [0.8, 0, S, 2],
    [-0.35, -0.5, S, 1],
    [0, 0.1, S, 0.9],
    [0.35, -0.5, S, 1],
  ],
}

function Glyph({
  char,
  position,
  color,
}: {
  char: string
  position: [number, number, number]
  color: string
}) {
  const bars = GLYPHS[char] ?? []
  return (
    // Rotate the 2D glyph frame flat onto the ground, readable from above.
    <group position={position} rotation={[-Math.PI / 2, 0, 0]}>
      {bars.map((b, i) => (
        <mesh key={i} position={[b[0], b[1], 0]}>
          <boxGeometry args={[b[2], b[3], 0.06]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </group>
  )
}

export function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[GROUND_SIZE_M, GROUND_SIZE_M]} />
        <meshStandardMaterial color="#5b6b46" roughness={1} />
      </mesh>

      <gridHelper args={[80, 80, '#475569', '#334155']} position={[0, 0.005, 0]} />

      <Compass />
    </group>
  )
}

/** Cardinal markers. -Z is north in this scene. */
function Compass() {
  return (
    <group position={[0, 0.06, 0]}>
      <Glyph char="N" position={[0, 0, -MARKER_RADIUS_M]} color="#f87171" />
      <Glyph char="S" position={[0, 0, MARKER_RADIUS_M]} color="#94a3b8" />
      <Glyph char="E" position={[MARKER_RADIUS_M, 0, 0]} color="#94a3b8" />
      <Glyph char="W" position={[-MARKER_RADIUS_M, 0, 0]} color="#94a3b8" />

      {/* Shaft and head pointing north. */}
      <mesh position={[0, 0, -MARKER_RADIUS_M / 2 - 1]}>
        <boxGeometry args={[0.22, 0.05, MARKER_RADIUS_M - 4]} />
        <meshBasicMaterial color="#f87171" />
      </mesh>
      <mesh position={[0, 0, -MARKER_RADIUS_M + 2.4]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.6, 1.5, 4]} />
        <meshBasicMaterial color="#f87171" />
      </mesh>
    </group>
  )
}
