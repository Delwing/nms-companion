/**
 * Bridges the catalogue to the map: systems in, spatial neighbourhoods out.
 *
 * All the work is memoised on the systems array because clustering runs over
 * the whole catalogue, and the renderer re-renders on every save sync.
 */
import { useMemo } from 'react'
import type { SystemRecord } from '@shared/types'
import { buildClusters, type RegionCell, type RegionCluster } from '@shared/galaxyMap'
import { regionLabel } from '@shared/galaxy'

export interface GalaxyMapData {
  clusters: RegionCluster[]
  /** Galaxies represented in the catalogue, most-catalogued first. */
  galaxies: (string | null)[]
  /** Systems that carry no coordinates and so cannot be placed. */
  unplaced: number
}

export function useGalaxyMapData(systems: SystemRecord[]): GalaxyMapData {
  return useMemo(() => {
    const clusters = buildClusters(systems)
    const galaxies: (string | null)[] = []
    for (const cluster of clusters) {
      if (!galaxies.includes(cluster.galaxy)) galaxies.push(cluster.galaxy)
    }
    const unplaced = systems.filter(
      (s) => s.voxelX === null || s.voxelY === null || s.voxelZ === null
    ).length
    return { clusters, galaxies, unplaced }
  }, [systems])
}

/** Where the player is, resolved onto the lattice. */
export interface CurrentPlacement {
  cluster: RegionCluster
  cell: RegionCell
  system: SystemRecord
}

/**
 * Locate the player's system in the clustering. Returns null when the save's
 * address isn't catalogued or carries no coordinates — the map only draws
 * regions it has systems for, so there is nowhere to put the marker.
 */
export function findCurrentPlacement(
  clusters: readonly RegionCluster[],
  address: string | null
): CurrentPlacement | null {
  if (!address) return null
  for (const cluster of clusters) {
    for (const cell of cluster.cells) {
      const system = cell.systems.find((s) => s.universalAddress === address)
      if (system) return { cluster, cell, system }
    }
  }
  return null
}

/** The region a neighbourhood would be recognised by: its busiest one. */
function busiestCell(cluster: RegionCluster): RegionCluster['cells'][number] {
  return cluster.cells.reduce((best, cell) =>
    cell.systems.length > best.systems.length ? cell : best
  )
}

/**
 * A neighbourhood has no name in game, so it borrows the coordinates of its
 * busiest region.
 */
export function clusterLabel(cluster: RegionCluster): string {
  const cell = busiestCell(cluster)
  return regionLabel(cell.x, cell.y, cell.z)
}

/**
 * Stable identity for a neighbourhood across re-syncs. Keyed on the bounding
 * box's low corner, which only moves when the cluster genuinely grows.
 */
export function clusterId(cluster: RegionCluster): string {
  return `${cluster.galaxy ?? '?'}|${cluster.min.x},${cluster.min.y},${cluster.min.z}`
}
