/**
 * Tests for region-wide guild inference: every station in a region (voxel)
 * hosts the same guild, so one envoy scan reveals the guild of every
 * catalogued neighbour system.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const { inferRegionGuilds, inferredGuildFor } = require('./.build/shared/regionGuilds.js')
const { regionKey } = require('./.build/shared/galaxy.js')

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

test('one scanned system reveals the guild of its region', () => {
  const scanned = system({ guildType: 'Merchants' })
  const neighbour = system({ solarSystemIndex: 7 })
  const guilds = inferRegionGuilds([scanned, neighbour])
  assert.strictEqual(guilds.get(regionKey('Euclid', 10, 2, -30)), 'Merchants')
  assert.strictEqual(inferredGuildFor(neighbour, guilds), 'Merchants')
})

test('a scanned system does not report an inferred guild for itself', () => {
  const scanned = system({ guildType: 'Explorers' })
  const guilds = inferRegionGuilds([scanned])
  assert.strictEqual(inferredGuildFor(scanned, guilds), null)
})

test('regions are scoped per galaxy and per voxel', () => {
  const euclid = system({ guildType: 'Merchants' })
  const hilbert = system({ galaxy: 'Hilbert Dimension', guildType: 'Explorers' })
  const otherVoxel = system({ voxelX: 11 })
  const guilds = inferRegionGuilds([euclid, hilbert, otherVoxel])
  assert.strictEqual(guilds.get(regionKey('Euclid', 10, 2, -30)), 'Merchants')
  assert.strictEqual(guilds.get(regionKey('Hilbert Dimension', 10, 2, -30)), 'Explorers')
  assert.strictEqual(inferredGuildFor(otherVoxel, guilds), null)
})

test('systems without coordinates neither vote nor inherit', () => {
  const noCoords = system({ voxelX: null, guildType: 'Mercenaries' })
  const neighbour = system({ solarSystemIndex: 3 })
  const guilds = inferRegionGuilds([noCoords, neighbour])
  assert.strictEqual(guilds.size, 0)
  assert.strictEqual(inferredGuildFor(system({ voxelX: null }), guilds), null)
})

test('pirate and stationless systems neither vote nor inherit', () => {
  const scanned = system({ guildType: 'Merchants' })
  const pirate = system({ station: 'pirate', solarSystemIndex: 2 })
  const stationless = system({ station: 'stationless', solarSystemIndex: 3 })
  // A stale guild on a pirate system must not poison the region vote.
  const stalePirate = system({ station: 'pirate', guildType: 'Explorers', solarSystemIndex: 4 })
  const guilds = inferRegionGuilds([scanned, pirate, stationless, stalePirate])
  assert.strictEqual(guilds.get(regionKey('Euclid', 10, 2, -30)), 'Merchants')
  assert.strictEqual(inferredGuildFor(pirate, guilds), null)
  assert.strictEqual(inferredGuildFor(stationless, guilds), null)
})

test('conflicting scans: majority wins', () => {
  const guilds = inferRegionGuilds([
    system({ guildType: 'Merchants' }),
    system({ guildType: 'Merchants', solarSystemIndex: 2 }),
    system({ guildType: 'Explorers', solarSystemIndex: 3 })
  ])
  assert.strictEqual(guilds.get(regionKey('Euclid', 10, 2, -30)), 'Merchants')
})

test('conflicting scans: a tie goes to the most recently updated system', () => {
  const guilds = inferRegionGuilds([
    system({ guildType: 'Merchants', updatedAt: '2026-01-01T00:00:00Z' }),
    system({
      guildType: 'Mercenaries',
      solarSystemIndex: 2,
      updatedAt: '2026-02-01T00:00:00Z'
    })
  ])
  assert.strictEqual(guilds.get(regionKey('Euclid', 10, 2, -30)), 'Mercenaries')
})
