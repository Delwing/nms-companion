/**
 * A compass needle pointing from the cluster toward the galactic core.
 *
 * Deliberately not to scale: the core is on the order of a thousand voxels
 * away from a cluster a dozen voxels wide, so an honest rendering would put
 * it far off screen. The arrow shows direction only; the distance is stated
 * in the overlay legend beside it.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

interface CoreArrowProps {
  /** Unit vector toward the core, in voxel axes (which map 1:1 to scene axes). */
  direction: [number, number, number]
  /** Arrow length in scene units, sized from the cluster's extent. */
  length: number
}

const CORE_COLOR = '#f8fafc'

export function CoreArrow({ direction, length }: CoreArrowProps): React.JSX.Element | null {
  const shaft = useMemo(() => {
    const end = new THREE.Vector3(...direction).multiplyScalar(length)
    return new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), end])
  }, [direction, length])

  const tip = useMemo(() => {
    const vector = new THREE.Vector3(...direction)
    const position = vector.clone().multiplyScalar(length)
    // Cones point +Y by default; rotate that onto the core direction.
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector)
    return { position, quaternion }
  }, [direction, length])

  useEffect(() => () => void shaft.dispose(), [shaft])

  // A cluster sitting exactly on the core has no direction to point in.
  if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) return null

  return (
    <group>
      {/* lineSegments rather than line: two points make one segment, and it
          dodges the JSX name clash with SVG's <line>. */}
      <lineSegments geometry={shaft}>
        <lineBasicMaterial color={CORE_COLOR} transparent opacity={0.55} toneMapped={false} />
      </lineSegments>
      <mesh position={tip.position} quaternion={tip.quaternion}>
        <coneGeometry args={[0.22, 0.7, 12]} />
        <meshBasicMaterial color={CORE_COLOR} transparent opacity={0.75} toneMapped={false} />
      </mesh>
    </group>
  )
}
