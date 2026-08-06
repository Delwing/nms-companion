/**
 * A point per catalogued system, placed inside its region cube.
 *
 * Positions come from `starPositionIn`, which seeds off the system's real
 * solar-system index — so placement is stable across re-syncs and a region
 * holding 36 systems visibly reads as denser than one holding a single
 * waypoint, without the count being written anywhere.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { starPositionIn, type RegionCluster, type Voxel } from '@shared/galaxyMap'
import { createStarTexture, scenePosition } from './geometry'
import { CUBE_SCALE, CURRENT_COLOR } from './theme'

interface SystemStarsProps {
  cluster: RegionCluster
  origin: Voxel
  /** The system the player is in, singled out from the cloud. */
  currentAddress: string | null
}

export function SystemStars({
  cluster,
  origin,
  currentAddress
}: SystemStarsProps): React.JSX.Element {
  const { geometry, currentPos } = useMemo(() => {
    const positions: number[] = []
    let currentPos: [number, number, number] | null = null
    for (const cell of cluster.cells) {
      const [cx, cy, cz] = scenePosition(cell, origin)
      for (const system of cell.systems) {
        const [fx, fy, fz] = starPositionIn(system)
        const point: [number, number, number] = [
          cx + (fx - 0.5) * CUBE_SCALE,
          cy + (fy - 0.5) * CUBE_SCALE,
          cz + (fz - 0.5) * CUBE_SCALE
        ]
        positions.push(...point)
        if (system.universalAddress === currentAddress) currentPos = point
      }
    }
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return { geometry: buffer, currentPos }
  }, [cluster, origin, currentAddress])

  const texture = useMemo(() => createStarTexture(), [])

  useEffect(() => () => void geometry.dispose(), [geometry])
  useEffect(() => () => void texture.dispose(), [texture])

  return (
    <>
      <points geometry={geometry}>
        <pointsMaterial
          map={texture}
          size={0.11}
          sizeAttenuation
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>

      {/* The player's own star, over the top of its point in the cloud. */}
      {currentPos && (
        <group position={currentPos}>
          <sprite scale={[0.42, 0.42, 0.42]}>
            <spriteMaterial
              map={texture}
              color={CURRENT_COLOR}
              transparent
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </sprite>
          <mesh>
            <sphereGeometry args={[0.075, 12, 8]} />
            <meshBasicMaterial color={CURRENT_COLOR} toneMapped={false} />
          </mesh>
        </group>
      )}
    </>
  )
}
