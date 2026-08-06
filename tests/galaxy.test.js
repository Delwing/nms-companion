/**
 * Tests for closest-to-core ranking: each galaxy has its own core at voxel
 * 0,0,0, so the catalogue tracks the nearest system per galaxy.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const { closestToCoreByGalaxy, distanceToCoreLy } = require('./.build/shared/galaxy.js')

let nextAddress = 0
function system(overrides = {}) {
  return {
    universalAddress: `addr-${nextAddress++}`,
    galaxy: 'Euclid',
    voxelX: 100,
    voxelY: 10,
    voxelZ: -200,
    ...overrides
  }
}

test('picks the system with the smallest core distance', () => {
  const far = system({ voxelX: 500, voxelY: 0, voxelZ: 500 })
  const near = system({ voxelX: 3, voxelY: 1, voxelZ: -2 })
  const mid = system({ voxelX: 50, voxelY: 5, voxelZ: 50 })

  const best = closestToCoreByGalaxy([far, near, mid])
  assert.strictEqual(best.get('Euclid').universalAddress, near.universalAddress)
  assert.strictEqual(best.get('Euclid').ly, distanceToCoreLy(3, 1, -2))
})

test('ranks each galaxy independently', () => {
  const euclid = system({ voxelX: 400, voxelY: 0, voxelZ: 0 })
  const eissentam = system({ galaxy: 'Eissentam', voxelX: 700, voxelY: 0, voxelZ: 0 })

  const best = closestToCoreByGalaxy([euclid, eissentam])
  assert.strictEqual(best.get('Euclid').universalAddress, euclid.universalAddress)
  assert.strictEqual(best.get('Eissentam').universalAddress, eissentam.universalAddress)
})

test('skips systems without coordinates', () => {
  const noCoords = system({ voxelX: null, voxelY: null, voxelZ: null })
  const withCoords = system({ voxelX: 600, voxelY: 20, voxelZ: 600 })

  const best = closestToCoreByGalaxy([noCoords, withCoords])
  assert.strictEqual(best.get('Euclid').universalAddress, withCoords.universalAddress)
  assert.strictEqual(closestToCoreByGalaxy([noCoords]).size, 0)
})

test('groups unknown-galaxy systems under the null key', () => {
  const unknown = system({ galaxy: null, voxelX: 1, voxelY: 0, voxelZ: 0 })
  const best = closestToCoreByGalaxy([unknown])
  assert.strictEqual(best.get(null).universalAddress, unknown.universalAddress)
})
