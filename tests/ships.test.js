/**
 * Tests for owned-ship extraction, driven by synthetic save trees shaped
 * like a real Game Pass save (fixed-size ownership array with husk slots
 * and scrapped-ship ghost entries, per-inventory base stats and
 * supercharged slots).
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  DEFAULT_KEY_MAPPING,
  deobfuscateKeys,
  extractShips
} = require('./.build/main/services/saveParser.js')

/** One ship inventory area, already deobfuscated. */
const inventory = (validCount, cls, stats = [], supercharged = 0) => ({
  Slots: [],
  ValidSlotIndices: Array.from({ length: validCount }, (_, i) => ({ X: i % 10, Y: (i / 10) | 0 })),
  Class: { InventoryClass: cls },
  BaseStatValues: stats.map(([id, value]) => ({ BaseStatID: id, Value: value })),
  SpecialSlots: Array.from({ length: supercharged }, (_, i) => ({
    Type: { InventorySpecialSlotType: 'TechBonus' },
    Index: { X: i, Y: 0 }
  })),
  Width: 10,
  Height: 5
})

const ship = (filename, seed, general, tech, name = '') => ({
  Name: name,
  Resource: { Filename: filename, Seed: seed },
  Inventory: general,
  Inventory_Cargo: inventory(0, 'C'),
  Inventory_TechOnly: tech
})

/** An unused ownership slot: 1×1 husk, no stats. */
const husk = () =>
  ship('', [false, '0x0'], inventory(0, 'C'), inventory(0, 'C'))

/** A scrapped ship: full ghost inventory left behind, Resource cleared. */
const scrapped = () =>
  ship('', [false, '0x0'], inventory(37, 'B', FIGHTER_STATS, 2), inventory(26, 'B'))

const FIGHTER_STATS = [
  ['^SHIP_DAMAGE', 61.3],
  ['^SHIP_SHIELD', 20],
  ['^SHIP_HYPERDRIVE', 26.1],
  ['^SHIP_AGILE', 40]
]

test('extractShips: husk and scrapped-ghost filtering and the primary flag', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        PrimaryShip: 1,
        ShipOwnership: [
          scrapped(),
          ship(
            'MODELS/COMMON/SPACECRAFT/FIGHTERS/FIGHTER_PROC.SCENE.MBIN',
            [true, '0x6A733E7A'],
            inventory(38, 'S', FIGHTER_STATS, 1),
            inventory(14, 'S', [], 3),
            'Rasamama S36'
          ),
          husk()
        ]
      }
    }
  }
  const ships = extractShips(root)
  assert.strictEqual(ships.length, 1)
  const [s] = ships
  assert.strictEqual(s.index, 1)
  assert.strictEqual(s.isPrimary, true)
  assert.strictEqual(s.name, 'Rasamama S36')
  assert.strictEqual(s.archetype, 'Fighter')
  assert.strictEqual(s.inventoryClass, 'S')
  assert.strictEqual(s.damage, 61.3)
  assert.strictEqual(s.shield, 20)
  assert.strictEqual(s.hyperdrive, 26.1)
  assert.strictEqual(s.agility, 40)
  assert.strictEqual(s.storageSlots, 38)
  assert.strictEqual(s.techSlots, 14)
  assert.strictEqual(s.cargoSlots, 0)
  assert.strictEqual(s.storageSupercharged, 1)
  assert.strictEqual(s.techSupercharged, 3)
  assert.strictEqual(s.seed, '0x6A733E7A')
})

test('extractShips: archetypes from scene filenames and the robot fallback', () => {
  const at = (filename, stats = FIGHTER_STATS) =>
    ship(filename, [true, '0x1'], inventory(20, 'A', stats), inventory(10, 'A'))
  const root = {
    PlayerStateData: {
      ShipOwnership: [
        at('MODELS/COMMON/SPACECRAFT/DROPSHIPS/DROPSHIP_PROC.SCENE.MBIN'),
        at('MODELS/COMMON/SPACECRAFT/SCIENTIFIC/SCIENTIFIC_PROC.SCENE.MBIN'),
        at('MODELS/COMMON/SPACECRAFT/S-CLASS/S-CLASS_PROC.SCENE.MBIN'),
        at('MODELS/COMMON/SPACECRAFT/SENTINELSHIP/SENTINELSHIP_PROC.SCENE.MBIN'),
        at('MODELS/COMMON/SPACECRAFT/BIGGS/BIGGS.SCENE.MBIN'),
        // Sentinel interceptors may lose their filename but keep ^ROBOT_SHIP.
        at('', [...FIGHTER_STATS, ['^ROBOT_SHIP', 1]]),
        at('')
      ]
    }
  }
  assert.deepStrictEqual(
    extractShips(root).map((s) => s.archetype),
    ['Hauler', 'Explorer', 'Exotic', 'Sentinel', 'Corvette', 'Sentinel', 'Unknown']
  )
})

test('extractShips: unseeded-but-owned ships report a null seed and no name', () => {
  const root = {
    PlayerStateData: {
      ShipOwnership: [
        ship(
          'MODELS/COMMON/SPACECRAFT/SHUTTLE/SHUTTLE_PROC.SCENE.MBIN',
          [false, '0x0'],
          inventory(30, 'B', FIGHTER_STATS),
          inventory(12, 'B')
        )
      ]
    }
  }
  const [s] = extractShips(root)
  assert.strictEqual(s.seed, null)
  assert.strictEqual(s.name, null)
  assert.strictEqual(s.isPrimary, false)
})

test('extractShips: obfuscated keys are handled via the default mapping', () => {
  // Key shapes copied from a real Game Pass save.
  const obfuscated = {
    vLc: {
      '6f=': {
        aBE: 0,
        '@Cs': [
          {
            NKm: 'Obfuscated Wing',
            NTx: { '93M': 'MODELS/COMMON/SPACECRAFT/SHUTTLE/SHUTTLE_PROC.SCENE.MBIN', '@EL': [true, '0xBEEF'] },
            ';l5': {
              ':No': [],
              'hl?': [{ '>Qh': 0, 'XJ>': 0 }, { '>Qh': 1, 'XJ>': 0 }, { '>Qh': 2, 'XJ>': 0 }],
              'B@N': { '1o6': 'A' },
              '@bB': [
                { QL1: '^SHIP_DAMAGE', '>MX': 74.6521 },
                { QL1: '^SHIP_SHIELD', '>MX': 16.2 }
              ],
              MMm: [],
              '=Tb': 10,
              'N9>': 5
            },
            PMT: {
              ':No': [],
              'hl?': [{ '>Qh': 0, 'XJ>': 0 }],
              'B@N': { '1o6': 'A' },
              '@bB': [],
              MMm: [{ Vn8: { QA1: 'TechBonus' }, '3ZH': { '>Qh': 1, 'XJ>': 1 } }],
              '=Tb': 10,
              'N9>': 3
            },
            gan: { ':No': [], 'hl?': [], 'B@N': { '1o6': 'C' }, '@bB': [], MMm: [] }
          }
        ]
      }
    }
  }
  const ships = extractShips(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.strictEqual(ships.length, 1)
  const [s] = ships
  assert.strictEqual(s.name, 'Obfuscated Wing')
  assert.strictEqual(s.archetype, 'Shuttle')
  assert.strictEqual(s.inventoryClass, 'A')
  assert.strictEqual(s.isPrimary, true)
  assert.strictEqual(s.damage, 74.7) // rounded to one decimal
  assert.strictEqual(s.shield, 16.2)
  assert.strictEqual(s.hyperdrive, null)
  assert.strictEqual(s.storageSlots, 3)
  assert.strictEqual(s.techSlots, 1)
  assert.strictEqual(s.techSupercharged, 1)
  assert.strictEqual(s.seed, '0xBEEF')
})
