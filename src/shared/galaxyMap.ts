/**
 * Region-lattice geometry for the 3D map. A region IS a voxel (see galaxy.ts),
 * so everything here is integer lattice work over system coordinates: group
 * systems into voxel cells, then cluster those cells into neighbourhoods.
 *
 * Clustering exists because a catalogue is not a blob. A real one spans
 * thousands of voxels on each axis while filling a few dozen cells, so a
 * bounding box over the whole catalogue would be hundreds of millions of
 * cells. Per-neighbourhood boxes are small enough to draw.
 *
 * Pure and dependency-free like the rest of @shared — the three.js layer
 * lives in the renderer and only consumes these results.
 */
import type { SystemRecord } from './types'
import { distanceToCoreLy, regionKey } from './galaxy'
import { inferRegionGuilds, type KnownGuild } from './regionGuilds'

export interface Voxel {
  x: number
  y: number
  z: number
}

/** One region: a voxel plus the systems catalogued inside it. */
export interface RegionCell extends Voxel {
  /** `regionKey(galaxy, x, y, z)` — unique across galaxies. */
  key: string
  galaxy: string | null
  systems: SystemRecord[]
  /** Region guild, inferred at display time and never persisted. */
  guild: KnownGuild | null
}

export interface RegionCluster {
  galaxy: string | null
  cells: RegionCell[]
  min: Voxel
  max: Voxel
  /** Cell-count-weighted centre. Fractional, unlike a real voxel. */
  centroid: Voxel
  systemCount: number
  /** Systems in the busiest cell; the normaliser for density shading. */
  maxCellCount: number
  /** Light years from the centroid to the galactic core. */
  coreLy: number
  /** Unit vector from the centroid toward the core (voxel 0,0,0). */
  coreDir: [number, number, number]
}

/**
 * Chebyshev distance below which two regions count as neighbours. Measured
 * against real catalogues the clustering is insensitive here (radius 1, 2 and
 * 3 give near-identical groupings); 2 tolerates a one-voxel gap without
 * merging genuinely distant outposts into the home cluster.
 */
export const CLUSTER_RADIUS = 2

function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

/**
 * Group systems into region cells. Systems without coordinates are skipped
 * entirely rather than collapsed onto voxel 0,0,0 — OCR-sourced systems can
 * lack an address, and the core sits at 0,0,0.
 */
export function buildRegionCells(systems: SystemRecord[]): RegionCell[] {
  const regionGuilds = inferRegionGuilds(systems)
  const cells = new Map<string, RegionCell>()

  for (const s of systems) {
    if (s.voxelX === null || s.voxelY === null || s.voxelZ === null) continue
    const key = regionKey(s.galaxy, s.voxelX, s.voxelY, s.voxelZ)
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        key,
        galaxy: s.galaxy,
        x: s.voxelX,
        y: s.voxelY,
        z: s.voxelZ,
        systems: [],
        guild: regionGuilds.get(key) ?? null
      }
      cells.set(key, cell)
    }
    cell.systems.push(s)
  }

  return [...cells.values()]
}

/** Distance and unit direction from a point to the galactic core. */
export function coreVectorFrom(point: Voxel): { ly: number; dir: [number, number, number] } {
  const length = Math.hypot(point.x, point.y, point.z)
  const dir: [number, number, number] =
    length === 0 ? [0, 0, 0] : [-point.x / length, -point.y / length, -point.z / length]
  return { ly: distanceToCoreLy(point.x, point.y, point.z), dir }
}

/**
 * Split region cells into spatial neighbourhoods, largest first.
 *
 * Clusters never span galaxies: two galaxies reuse the same voxel numbering,
 * so identical coordinates in Euclid and Eissentam are unrelated places.
 */
export function clusterRegions(
  cells: readonly RegionCell[],
  radius: number = CLUSTER_RADIUS
): RegionCluster[] {
  const byGalaxy = new Map<string | null, RegionCell[]>()
  for (const cell of cells) {
    const group = byGalaxy.get(cell.galaxy)
    if (group) group.push(cell)
    else byGalaxy.set(cell.galaxy, [cell])
  }

  const clusters: RegionCluster[] = []
  for (const [galaxy, group] of byGalaxy) {
    const lookup = new Map(group.map((c) => [voxelKey(c.x, c.y, c.z), c]))
    const seen = new Set<string>()

    for (const start of group) {
      const startKey = voxelKey(start.x, start.y, start.z)
      if (seen.has(startKey)) continue
      seen.add(startKey)

      // Flood fill through the (2r+1)^3 neighbourhood of each member, which
      // keeps this linear in cell count rather than quadratic.
      const members: RegionCell[] = []
      const queue: RegionCell[] = [start]
      while (queue.length > 0) {
        const cell = queue.pop()!
        members.push(cell)
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dz = -radius; dz <= radius; dz++) {
              const key = voxelKey(cell.x + dx, cell.y + dy, cell.z + dz)
              if (seen.has(key)) continue
              const neighbour = lookup.get(key)
              if (!neighbour) continue
              seen.add(key)
              queue.push(neighbour)
            }
          }
        }
      }

      clusters.push(buildCluster(galaxy, members))
    }
  }

  return clusters.sort((a, b) => b.systemCount - a.systemCount || b.cells.length - a.cells.length)
}

function buildCluster(galaxy: string | null, cells: RegionCell[]): RegionCluster {
  const min: Voxel = { x: Infinity, y: Infinity, z: Infinity }
  const max: Voxel = { x: -Infinity, y: -Infinity, z: -Infinity }
  let systemCount = 0
  let maxCellCount = 0
  const sum: Voxel = { x: 0, y: 0, z: 0 }

  for (const cell of cells) {
    min.x = Math.min(min.x, cell.x)
    min.y = Math.min(min.y, cell.y)
    min.z = Math.min(min.z, cell.z)
    max.x = Math.max(max.x, cell.x)
    max.y = Math.max(max.y, cell.y)
    max.z = Math.max(max.z, cell.z)
    systemCount += cell.systems.length
    maxCellCount = Math.max(maxCellCount, cell.systems.length)
    sum.x += cell.x
    sum.y += cell.y
    sum.z += cell.z
  }

  const centroid: Voxel = {
    x: sum.x / cells.length,
    y: sum.y / cells.length,
    z: sum.z / cells.length
  }
  const core = coreVectorFrom(centroid)

  return {
    galaxy,
    cells,
    min,
    max,
    centroid,
    systemCount,
    maxCellCount,
    coreLy: core.ly,
    coreDir: core.dir
  }
}

/** Convenience: catalogue in, neighbourhoods out. */
export function buildClusters(
  systems: SystemRecord[],
  radius: number = CLUSTER_RADIUS
): RegionCluster[] {
  return clusterRegions(buildRegionCells(systems), radius)
}

function hash32(value: number): number {
  let h = value | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}

function hashString(value: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/** Stars sit this far inside the cube walls, so they never z-fight the faces. */
const STAR_INSET = 0.15

/**
 * Deterministic position for a system inside its region cube, as fractions in
 * [STAR_INSET, 1 - STAR_INSET] on each axis.
 *
 * The seed is `solarSystemIndex` — real data, stable across re-syncs — so a
 * system always lands in the same spot and a busy region genuinely looks busy.
 * Systems missing an index fall back to hashing their address.
 */
export function starPositionIn(system: SystemRecord): [number, number, number] {
  const seed =
    system.solarSystemIndex ?? hashString(system.universalAddress)
  const span = 1 - STAR_INSET * 2
  return [
    STAR_INSET + (hash32(seed) / 0x100000000) * span,
    STAR_INSET + (hash32(seed + 0x9e3779b9) / 0x100000000) * span,
    STAR_INSET + (hash32(seed + 0x7f4a7c15) / 0x100000000) * span
  ]
}
