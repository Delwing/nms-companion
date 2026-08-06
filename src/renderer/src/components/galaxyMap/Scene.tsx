/**
 * Everything inside the canvas: the region lattice, its stars, a floor grid
 * for orientation, and the core compass.
 *
 * Scene space is cluster-local — the cluster's centroid sits at the origin
 * and one voxel is one unit on every axis. Y is not exaggerated: voxel Y is
 * 8-bit and the galaxy is a disc, so every cluster is a flat slab and
 * stretching it would misrepresent the geometry.
 */
import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { RegionCell, RegionCluster } from '@shared/galaxyMap'
import { RegionCubes } from './RegionCubes'
import { SystemStars } from './SystemStars'
import { CoreArrow } from './CoreArrow'
import { CELL_SIZE } from './theme'

interface SceneProps {
  cluster: RegionCluster
  selectedKey: string | null
  hoveredKey: string | null
  /** Player's region and system, when they're inside this neighbourhood. */
  currentKey: string | null
  currentAddress: string | null
  onHover: (cell: RegionCell | null) => void
  onSelect: (cell: RegionCell) => void
}

export function Scene({
  cluster,
  selectedKey,
  hoveredKey,
  currentKey,
  currentAddress,
  onHover,
  onSelect
}: SceneProps): React.JSX.Element {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null)
  const { camera, invalidate } = useThree()

  const extent = useMemo(() => {
    const span = Math.max(
      cluster.max.x - cluster.min.x,
      cluster.max.y - cluster.min.y,
      cluster.max.z - cluster.min.z
    )
    return (span + 2) * CELL_SIZE
  }, [cluster])

  // Re-frame whenever the cluster changes: a lone outpost and a 34-voxel
  // neighbourhood need very different camera distances.
  useEffect(() => {
    const distance = Math.max(extent * 1.5, 4)
    camera.position.set(distance * 0.75, distance * 0.55, distance * 0.75)
    camera.lookAt(0, 0, 0)
    controlsRef.current?.target.set(0, 0, 0)
    controlsRef.current?.update()
    invalidate()
  }, [cluster, camera, extent, invalidate])

  const grid = useMemo(() => {
    const divisions = Math.max(Math.round(extent), 2)
    const helper = new THREE.GridHelper(extent, divisions, '#334155', '#1e293b')
    const material = helper.material as THREE.Material
    material.transparent = true
    material.opacity = 0.25
    material.depthWrite = false
    return helper
  }, [extent])

  useEffect(() => () => void grid.dispose(), [grid])

  // The grid sits just under the slab's lowest layer, so it reads as a floor
  // rather than slicing through the cubes.
  const floorY = (cluster.min.y - cluster.centroid.y - 0.75) * CELL_SIZE

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        dampingFactor={0.12}
        onChange={() => invalidate()}
      />
      <primitive object={grid} position={[0, floorY, 0]} />
      <RegionCubes
        cluster={cluster}
        origin={cluster.centroid}
        selectedKey={selectedKey}
        hoveredKey={hoveredKey}
        currentKey={currentKey}
        onHover={onHover}
        onSelect={onSelect}
      />
      <SystemStars
        cluster={cluster}
        origin={cluster.centroid}
        currentAddress={currentAddress}
      />
      <CoreArrow direction={cluster.coreDir} length={extent * 0.9} />
    </>
  )
}
