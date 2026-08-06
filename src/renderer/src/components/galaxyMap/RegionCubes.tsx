/**
 * The lattice itself: a translucent cube per catalogued region, tinted by
 * guild and brightened by how many systems sit inside it.
 *
 * Only catalogued regions are drawn. Every voxel in the galaxy holds systems,
 * so outlining the un-catalogued neighbours would mark nothing — it would
 * just wrap the real data in a shell of noise.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { RegionCell, RegionCluster, Voxel } from '@shared/galaxyMap'
import { buildEdgeGeometry, scenePosition } from './geometry'
import { CUBE_SCALE, CURRENT_COLOR, GUILD_COLORS, MIN_DENSITY, guildKey } from './theme'

interface RegionCubesProps {
  cluster: RegionCluster
  origin: Voxel
  selectedKey: string | null
  hoveredKey: string | null
  /** Region the player is in right now, marked permanently. */
  currentKey: string | null
  onHover: (cell: RegionCell | null) => void
  onSelect: (cell: RegionCell) => void
}

export function RegionCubes({
  cluster,
  origin,
  selectedKey,
  hoveredKey,
  currentKey,
  onHover,
  onSelect
}: RegionCubesProps): React.JSX.Element {
  const meshRef = useRef<THREE.InstancedMesh>(null)

  const colorOf = useMemo(() => {
    return (cell: RegionCell): THREE.Color => {
      const density = cell.systems.length / Math.max(cluster.maxCellCount, 1)
      const scale = MIN_DENSITY + (1 - MIN_DENSITY) * density
      return new THREE.Color(GUILD_COLORS[guildKey(cell.guild)]).multiplyScalar(scale)
    }
  }, [cluster.maxCellCount])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    cluster.cells.forEach((cell, index) => {
      const [x, y, z] = scenePosition(cell, origin)
      mesh.setMatrixAt(index, matrix.makeTranslation(x, y, z))
      mesh.setColorAt(index, colorOf(cell))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [cluster, origin, colorOf])

  const cellEdges = useMemo(
    () =>
      buildEdgeGeometry(cluster.cells, origin, CUBE_SCALE, (index) =>
        colorOf(cluster.cells[index])
      ),
    [cluster, origin, colorOf]
  )
  useEffect(() => () => void cellEdges.dispose(), [cellEdges])

  const highlight = useMemo(() => {
    const cell =
      cluster.cells.find((c) => c.key === selectedKey) ??
      cluster.cells.find((c) => c.key === hoveredKey)
    return cell ? buildEdgeGeometry([cell], origin, CUBE_SCALE * 1.08) : null
  }, [cluster, origin, selectedKey, hoveredKey])

  useEffect(() => () => highlight?.dispose(), [highlight])

  // Drawn wider than the hover/selection outline so the two read as different
  // things when the player selects the region they're standing in.
  const currentEdges = useMemo(() => {
    const cell = cluster.cells.find((c) => c.key === currentKey)
    return cell ? buildEdgeGeometry([cell], origin, CUBE_SCALE * 1.16) : null
  }, [cluster, origin, currentKey])

  useEffect(() => () => currentEdges?.dispose(), [currentEdges])

  const handleMove = (event: ThreeEvent<PointerEvent>): void => {
    event.stopPropagation()
    if (event.instanceId != null) onHover(cluster.cells[event.instanceId] ?? null)
  }

  const handleClick = (event: ThreeEvent<MouseEvent>): void => {
    event.stopPropagation()
    if (event.instanceId != null) {
      const cell = cluster.cells[event.instanceId]
      if (cell) onSelect(cell)
    }
  }

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, cluster.cells.length]}
        onPointerMove={handleMove}
        onPointerOut={() => onHover(null)}
        onClick={handleClick}
      >
        <boxGeometry args={[CUBE_SCALE, CUBE_SCALE, CUBE_SCALE]} />
        <meshBasicMaterial transparent opacity={0.15} depthWrite={false} toneMapped={false} />
      </instancedMesh>

      <lineSegments geometry={cellEdges}>
        <lineBasicMaterial vertexColors transparent opacity={0.85} toneMapped={false} />
      </lineSegments>

      {currentEdges && (
        <lineSegments geometry={currentEdges}>
          <lineBasicMaterial color={CURRENT_COLOR} transparent opacity={0.9} toneMapped={false} />
        </lineSegments>
      )}

      {highlight && (
        <lineSegments geometry={highlight}>
          <lineBasicMaterial color="#ffffff" transparent opacity={0.9} toneMapped={false} />
        </lineSegments>
      )}
    </group>
  )
}
