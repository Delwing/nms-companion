/**
 * The overview: every neighbourhood as a marker, at true relative position,
 * around the galactic core.
 *
 * No compression is applied. A catalogue's neighbourhoods straddle the core
 * — they sit at similar radii on opposite sides of it — so real coordinates
 * already fit one view. Rings on the floor give the distance scale, and the
 * only liberty taken is marker *size*, which encodes system count rather than
 * any physical extent.
 */
import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import type { RegionCluster } from '@shared/galaxyMap'
import { buildRings, buildSegments, createStarTexture } from './geometry'
import {
  CORE_COLOR,
  CURRENT_COLOR,
  MARKER_BASE,
  MARKER_COLOR,
  MARKER_GROWTH,
  OVERVIEW_SCALE,
  RING_STEP_LY
} from './theme'

const LY_PER_VOXEL = 400

interface OverviewSceneProps {
  clusters: RegionCluster[]
  activeId: string | null
  /** Neighbourhood holding the player's current system, if it's on the map. */
  currentId: string | null
  idOf: (cluster: RegionCluster) => string
  onHover: (cluster: RegionCluster | null) => void
  onSelect: (cluster: RegionCluster) => void
}

function markerRadius(systemCount: number): number {
  return MARKER_BASE + Math.log10(systemCount + 1) * MARKER_GROWTH
}

function scenePos(cluster: RegionCluster): [number, number, number] {
  return [
    cluster.centroid.x * OVERVIEW_SCALE,
    cluster.centroid.y * OVERVIEW_SCALE,
    cluster.centroid.z * OVERVIEW_SCALE
  ]
}

export function OverviewScene({
  clusters,
  activeId,
  currentId,
  idOf,
  onHover,
  onSelect
}: OverviewSceneProps): React.JSX.Element {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null)
  const markersRef = useRef<THREE.InstancedMesh>(null)
  const { camera, invalidate } = useThree()

  // Everything is framed off the furthest neighbourhood from the core, so a
  // tightly-clustered catalogue and a galaxy-spanning one both fill the view.
  const reach = useMemo(() => {
    const furthest = clusters.reduce((max, c) => Math.max(max, c.coreLy), 0)
    return Math.max(furthest, RING_STEP_LY) / LY_PER_VOXEL
  }, [clusters])

  const ringRadii = useMemo(() => {
    const radii: number[] = []
    const steps = Math.ceil((reach * LY_PER_VOXEL) / RING_STEP_LY)
    for (let i = 1; i <= steps; i++) {
      radii.push(((i * RING_STEP_LY) / LY_PER_VOXEL) * OVERVIEW_SCALE)
    }
    return radii
  }, [reach])

  const rings = useMemo(() => buildRings(ringRadii), [ringRadii])

  // A spoke from the core to each marker, plus a drop line to the floor. The
  // spokes make "everything sits at the same radius" legible; the drops show
  // how little vertical spread there is, since voxel Y is only 8-bit.
  const spokes = useMemo(
    () =>
      buildSegments(
        clusters.map((c) => [[0, 0, 0], scenePos(c)] as [[number, number, number], [number, number, number]])
      ),
    [clusters]
  )

  const drops = useMemo(
    () =>
      buildSegments(
        clusters.map((c) => {
          const [x, y, z] = scenePos(c)
          return [
            [x, y, z],
            [x, 0, z]
          ] as [[number, number, number], [number, number, number]]
        })
      ),
    [clusters]
  )

  const texture = useMemo(() => createStarTexture(), [])

  // "You are here". The marker itself keeps its size-by-system-count meaning,
  // so the player's position is drawn *around* it: a halo, a wire cage, and
  // its own drop line so the spot stays findable when the camera is far out.
  const current = useMemo(
    () => (currentId ? (clusters.find((c) => idOf(c) === currentId) ?? null) : null),
    [clusters, currentId, idOf]
  )

  const currentHalo = useMemo<[number, number, number]>(() => {
    const size = current ? markerRadius(current.systemCount) * 6 : 1
    return [size, size, size]
  }, [current])

  const currentDrop = useMemo(() => {
    if (!current) return null
    const [x, y, z] = scenePos(current)
    return buildSegments([
      [
        [x, y, z],
        [x, 0, z]
      ]
    ])
  }, [current])

  useEffect(() => () => void rings.dispose(), [rings])
  useEffect(() => () => void spokes.dispose(), [spokes])
  useEffect(() => () => void drops.dispose(), [drops])
  useEffect(() => () => void texture.dispose(), [texture])
  useEffect(() => () => currentDrop?.dispose(), [currentDrop])
  useEffect(() => void invalidate(), [current, invalidate])

  useEffect(() => {
    const mesh = markersRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const active = new THREE.Color('#ffffff')
    const normal = new THREE.Color(MARKER_COLOR)
    clusters.forEach((cluster, index) => {
      const [x, y, z] = scenePos(cluster)
      const scale = markerRadius(cluster.systemCount)
      mesh.setMatrixAt(index, matrix.makeScale(scale, scale, scale).setPosition(x, y, z))
      mesh.setColorAt(index, idOf(cluster) === activeId ? active : normal)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    invalidate()
  }, [clusters, activeId, idOf, invalidate])

  useEffect(() => {
    const distance = Math.max(reach * OVERVIEW_SCALE * 2.6, 20)
    camera.position.set(distance * 0.1, distance * 0.85, distance * 0.6)
    camera.lookAt(0, 0, 0)
    controlsRef.current?.target.set(0, 0, 0)
    controlsRef.current?.update()
    invalidate()
  }, [reach, camera, invalidate])

  const handleMove = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation()
    if (event.instanceId != null) onHover(clusters[event.instanceId] ?? null)
  }

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    if (event.instanceId != null) {
      const cluster = clusters[event.instanceId]
      if (cluster) onSelect(cluster)
    }
  }

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        dampingFactor={0.12}
        onChange={() => invalidate()}
      />

      <lineSegments geometry={rings}>
        <lineBasicMaterial color="#334155" transparent opacity={0.5} toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={spokes}>
        <lineBasicMaterial color="#475569" transparent opacity={0.35} toneMapped={false} />
      </lineSegments>
      <lineSegments geometry={drops}>
        <lineBasicMaterial color={MARKER_COLOR} transparent opacity={0.3} toneMapped={false} />
      </lineSegments>

      {/* The core: a small solid point wrapped in an additive halo. */}
      <mesh>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color={CORE_COLOR} toneMapped={false} />
      </mesh>
      <sprite scale={[6, 6, 6]}>
        <spriteMaterial
          map={texture}
          color={CORE_COLOR}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </sprite>

      <instancedMesh
        ref={markersRef}
        args={[undefined, undefined, clusters.length]}
        onPointerMove={handleMove}
        onPointerOut={() => onHover(null)}
        onClick={handleClick}
      >
        <sphereGeometry args={[1, 20, 20]} />
        <meshBasicMaterial transparent opacity={0.85} toneMapped={false} />
      </instancedMesh>

      {current && (
        <>
          {currentDrop && (
            <lineSegments geometry={currentDrop}>
              <lineBasicMaterial color={CURRENT_COLOR} transparent opacity={0.8} toneMapped={false} />
            </lineSegments>
          )}
          <group position={scenePos(current)}>
            <mesh>
              <sphereGeometry args={[markerRadius(current.systemCount) * 1.45, 16, 12]} />
              <meshBasicMaterial
                color={CURRENT_COLOR}
                wireframe
                transparent
                opacity={0.55}
                toneMapped={false}
              />
            </mesh>
            <sprite scale={currentHalo}>
              <spriteMaterial
                map={texture}
                color={CURRENT_COLOR}
                transparent
                opacity={0.55}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </sprite>
          </group>
        </>
      )}
    </>
  )
}
