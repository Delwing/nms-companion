/**
 * Tests for the bare-system predicate: address-only records (unnamed, no
 * planets, no user metadata) are hidden from the catalogue.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const { isBareUnknownSystem } = require('./.build/shared/systemStubs.js')

function system(overrides = {}) {
  return {
    universalAddress: 'R0:-1341:1:-1200:424',
    name: 'Unknown System',
    galaxy: 'Euclid',
    voxelX: -1341,
    voxelY: 1,
    voxelZ: -1200,
    solarSystemIndex: 424,
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

test('an address-only unknown system is bare', () => {
  assert.strictEqual(isBareUnknownSystem(system(), 0), true)
})

test('a named system is never bare', () => {
  assert.strictEqual(isBareUnknownSystem(system({ name: 'Leuz' }), 0), false)
})

test('planets keep an unknown system visible', () => {
  assert.strictEqual(isBareUnknownSystem(system(), 1), false)
})

test('any user metadata keeps an unknown system visible', () => {
  const touched = [
    { guildType: 'Merchants' },
    { station: 'pirate' },
    { station: 'stationless' },
    { isBlackHole: true },
    { offersSfm: true },
    { multiToolSClass: true },
    { economy: 'Mining · Medium Supply' },
    { conflict: 'Low' },
    { race: 'Gek' },
    { customTags: ['revisit'] },
    { envoyItems: ['Ion Battery'] },
    { notes: 'portal here' }
  ]
  for (const patch of touched) {
    assert.strictEqual(
      isBareUnknownSystem(system(patch), 0),
      false,
      `expected not bare with ${JSON.stringify(patch)}`
    )
  }
})
