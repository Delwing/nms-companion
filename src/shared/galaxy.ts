/**
 * Pure address math on galactic coordinates. Everything here is derived
 * with plain arithmetic from voxel + system index — no game data needed.
 *
 * A system's identity in NMS is its position: 12-bit signed voxel X/Z,
 * 8-bit signed voxel Y, and a solar-system index within the voxel (region).
 * Portal codes and signal-booster coordinates are just re-encodings of it.
 */

/** Galaxy names by reality index; the game has 256, these first ten cover
 *  virtually all play. */
export const GALAXY_NAMES = [
  'Euclid',
  'Hilbert Dimension',
  'Calypso',
  'Hesperius Dimension',
  'Hyades',
  'Ickjamatew',
  'Budullangr',
  'Kikolgallr',
  'Eltiensleen',
  'Eissentam'
]

/** Portal glyph names indexed by hex digit, for tooltips/accessibility. */
export const GLYPH_NAMES = [
  'Sunset',
  'Bird',
  'Face',
  'Diplo',
  'Eclipse',
  'Balloon',
  'Boat',
  'Bug',
  'Dragonfly',
  'Galaxy',
  'Voxel',
  'Fish',
  'Tent',
  'Rocket',
  'Tree',
  'Atlas'
] as const

function hex(value: number, width: number): string {
  return value.toString(16).toUpperCase().padStart(width, '0')
}

/**
 * 12-hex-digit portal address: P SSS YY ZZZ XXX.
 * Portal digits are the raw two's-complement voxel values (a signed voxel
 * of 0 sits at glyph 0), so the encode is just masking.
 * `planetIndex` defaults to 1 — any planet digit reaches the system; 1 is
 * the community convention when the target planet is unknown.
 */
export function portalCode(
  voxelX: number,
  voxelY: number,
  voxelZ: number,
  solarSystemIndex: number,
  planetIndex = 1
): string {
  return (
    hex(planetIndex & 0xf, 1) +
    hex(solarSystemIndex & 0xfff, 3) +
    hex(voxelY & 0xff, 2) +
    hex(voxelZ & 0xfff, 3) +
    hex(voxelX & 0xfff, 3)
  )
}

/**
 * Signal-booster / galaxy-map coordinates "XXXX:YYYY:ZZZZ:SSSS"
 * (the part after the scanner's 5-letter prefix). Offsets re-center the
 * signed voxel so the galactic core reads 07FF:007F:07FF.
 */
export function boosterCoords(
  voxelX: number,
  voxelY: number,
  voxelZ: number,
  solarSystemIndex: number
): string {
  return [
    hex((voxelX + 0x7ff) & 0xfff, 4),
    hex((voxelY + 0x7f) & 0xff, 4),
    hex((voxelZ + 0x7ff) & 0xfff, 4),
    hex(solarSystemIndex & 0xfff, 4)
  ].join(':')
}

/** One voxel unit is ~400 light-years across. */
const LY_PER_VOXEL = 400

/** Distance from the galactic core in light-years (core = voxel 0,0,0). */
export function distanceToCoreLy(voxelX: number, voxelY: number, voxelZ: number): number {
  return Math.round(Math.sqrt(voxelX ** 2 + voxelY ** 2 + voxelZ ** 2) * LY_PER_VOXEL)
}

export function formatLightYears(ly: number): string {
  if (ly >= 10000) return `${(ly / 1000).toFixed(1)}k ly`
  return `${ly.toLocaleString()} ly`
}

/** The coordinate fields needed to rank systems by core distance. */
interface CoreCandidate {
  universalAddress: string
  galaxy: string | null
  voxelX: number | null
  voxelY: number | null
  voxelZ: number | null
}

export interface CoreClosest {
  universalAddress: string
  ly: number
}

/**
 * Each galaxy's catalogued system nearest its own core (every galaxy has
 * one, at voxel 0,0,0). Keyed by galaxy name; systems without coordinates
 * can't be ranked and are skipped.
 */
export function closestToCoreByGalaxy(
  systems: readonly CoreCandidate[]
): Map<string | null, CoreClosest> {
  const best = new Map<string | null, CoreClosest>()
  for (const s of systems) {
    if (s.voxelX === null || s.voxelY === null || s.voxelZ === null) continue
    const ly = distanceToCoreLy(s.voxelX, s.voxelY, s.voxelZ)
    const current = best.get(s.galaxy)
    if (!current || ly < current.ly) {
      best.set(s.galaxy, { universalAddress: s.universalAddress, ly })
    }
  }
  return best
}

/**
 * Region identity: a region IS a voxel — every system sharing a voxel
 * (up to ~550 of them) is in the same region. Regions have procedural
 * names we can't derive, so they're labelled by coordinates.
 */
export function regionKey(galaxy: string | null, x: number, y: number, z: number): string {
  return `${galaxy ?? '?'}|${x}|${y}|${z}`
}

export function regionLabel(x: number, y: number, z: number): string {
  return `Region [${x}, ${y}, ${z}]`
}
