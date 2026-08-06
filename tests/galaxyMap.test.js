/**
 * Tests for the region-lattice geometry behind the 3D map: grouping systems
 * into voxel cells and clustering those cells into neighbourhoods.
 *
 * The shape fixture (tests/fixtures/region-voxels.json) is coordinates and
 * counts lifted from a real catalogue, so the clustering is exercised against
 * a genuine exploration pattern rather than a tidy synthetic one.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const {
  buildClusters,
  buildRegionCells,
  clusterRegions,
  coreVectorFrom,
  starPositionIn
} = require('./.build/shared/galaxyMap.js')
const { distanceToCoreLy } = require('./.build/shared/galaxy.js')

let nextAddress = 0
function system(overrides = {}) {
  return {
    universalAddress: `addr-${nextAddress++}`,
    name: 'Test System',
    galaxy: 'Euclid',
    voxelX: 10,
    voxelY: 2,
    voxelZ: -30,
    solarSystemIndex: 1,
    isBlackHole: false,
    guildType: null,
    station: 'normal',
    offersSfm: false,
    multiToolSClass: false,
    economy: null,
    conflict: null,
    race: null,
    customTags: [],
    envoyItems: [],
    notes: '',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  }
}

function at(x, y, z, overrides = {}) {
  return system({ voxelX: x, voxelY: y, voxelZ: z, ...overrides })
}

test('systems in one voxel collapse into a single region cell', () => {
  const cells = buildRegionCells([at(1, 0, 1), at(1, 0, 1), at(2, 0, 1)])
  assert.strictEqual(cells.length, 2)
  const busiest = cells.find((c) => c.x === 1)
  assert.strictEqual(busiest.systems.length, 2)
})

test('a region cell carries its inferred guild', () => {
  const cells = buildRegionCells([
    at(1, 0, 1, { guildType: 'Explorers' }),
    at(1, 0, 1, { solarSystemIndex: 9 })
  ])
  assert.strictEqual(cells.length, 1)
  // Both systems share a region, so the unscanned one inherits the guild.
  assert.strictEqual(cells[0].guild, 'Explorers')
})

test('systems without coordinates are skipped, not placed at the core', () => {
  const cells = buildRegionCells([at(5, 5, 5), system({ voxelX: null }), system({ voxelZ: null })])
  assert.strictEqual(cells.length, 1)
  assert.strictEqual(cells[0].x, 5)
})

test('clustering merges near voxels and separates distant ones', () => {
  const clusters = buildClusters([at(0, 0, 0), at(1, 0, 0), at(0, 0, 4)], 2)
  assert.strictEqual(clusters.length, 2)
  assert.strictEqual(clusters[0].cells.length, 2)
  assert.strictEqual(clusters[1].cells.length, 1)
})

test('clustering is transitive across a chain of neighbours', () => {
  // No two ends are within the radius, but the chain links them.
  const clusters = buildClusters([at(0, 0, 0), at(2, 0, 0), at(4, 0, 0), at(6, 0, 0)], 2)
  assert.strictEqual(clusters.length, 1)
  assert.strictEqual(clusters[0].cells.length, 4)
})

test('clusters never span galaxies, even at identical coordinates', () => {
  const clusters = buildClusters([
    at(0, 0, 0, { galaxy: 'Euclid' }),
    at(0, 0, 0, { galaxy: 'Eissentam' })
  ])
  assert.strictEqual(clusters.length, 2)
  assert.deepStrictEqual(
    clusters.map((c) => c.galaxy).sort(),
    ['Eissentam', 'Euclid']
  )
})

test('clusters are ordered by system count, largest first', () => {
  const clusters = buildClusters([
    at(0, 0, 0),
    at(50, 0, 0),
    at(50, 0, 0),
    at(50, 0, 0),
    at(100, 0, 0),
    at(100, 0, 0)
  ])
  assert.deepStrictEqual(
    clusters.map((c) => c.systemCount),
    [3, 2, 1]
  )
})

test('cluster bounds, centroid and density normaliser', () => {
  const [cluster] = buildClusters([at(0, 0, 0), at(2, 0, 0), at(2, 0, 0), at(2, 0, 0)])
  assert.deepStrictEqual(cluster.min, { x: 0, y: 0, z: 0 })
  assert.deepStrictEqual(cluster.max, { x: 2, y: 0, z: 0 })
  assert.deepStrictEqual(cluster.centroid, { x: 1, y: 0, z: 0 })
  assert.strictEqual(cluster.systemCount, 4)
  assert.strictEqual(cluster.maxCellCount, 3)
})

test('core vector points at the origin and agrees with distanceToCoreLy', () => {
  const { ly, dir } = coreVectorFrom({ x: 3, y: 0, z: 4 })
  assert.strictEqual(ly, distanceToCoreLy(3, 0, 4))
  assert.deepStrictEqual(dir, [-0.6, -0, -0.8])
  assert.ok(Math.abs(Math.hypot(...dir) - 1) < 1e-12)
})

test('core vector at the core itself has no direction', () => {
  const { ly, dir } = coreVectorFrom({ x: 0, y: 0, z: 0 })
  assert.strictEqual(ly, 0)
  assert.deepStrictEqual(dir, [0, 0, 0])
})

test('star positions are deterministic and stay inside the cube', () => {
  const s = at(1, 1, 1, { solarSystemIndex: 317 })
  assert.deepStrictEqual(starPositionIn(s), starPositionIn(s))
  for (const index of [0, 1, 42, 317, 549]) {
    for (const axis of starPositionIn(at(0, 0, 0, { solarSystemIndex: index }))) {
      assert.ok(axis > 0 && axis < 1, `${axis} outside cube`)
    }
  }
})

test('star positions differ between systems in the same region', () => {
  const a = starPositionIn(at(0, 0, 0, { solarSystemIndex: 1 }))
  const b = starPositionIn(at(0, 0, 0, { solarSystemIndex: 2 }))
  assert.notDeepStrictEqual(a, b)
})

test('a system without a solar system index still gets a stable position', () => {
  const s = at(0, 0, 0, { solarSystemIndex: null })
  assert.deepStrictEqual(starPositionIn(s), starPositionIn(s))
})

test('a real catalogue shape clusters into one dominant neighbourhood', () => {
  const voxels = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'region-voxels.json'), 'utf8')
  )
  const systems = []
  for (const [x, y, z, count] of voxels) {
    for (let i = 0; i < count; i++) systems.push(at(x, y, z, { solarSystemIndex: i }))
  }

  const cells = buildRegionCells(systems)
  assert.strictEqual(cells.length, 42)

  const clusters = clusterRegions(cells, 2)
  assert.strictEqual(clusters.length, 7)

  const [home] = clusters
  assert.strictEqual(home.cells.length, 34)
  assert.strictEqual(home.systemCount, 150)

  // The whole catalogue spans a box of hundreds of millions of cells; the
  // home neighbourhood is the reason a lattice is drawable at all.
  const box =
    (home.max.x - home.min.x + 1) * (home.max.y - home.min.y + 1) * (home.max.z - home.min.z + 1)
  assert.strictEqual(box, 864)
})
