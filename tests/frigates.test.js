/**
 * Tests for fleet-frigate extraction, driven by synthetic save trees shaped
 * like a real Game Pass save (FleetFrigates entries with the fixed-order
 * FrigateStatTypeEnum stats array and '^'-prefixed trait ids).
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  DEFAULT_KEY_MAPPING,
  deobfuscateKeys,
  extractFrigates
} = require('./.build/main/services/saveParser.js')

/** One frigate save entry, already deobfuscated. */
const frigate = (cls, grade, stats, traits, overrides = {}) => ({
  ResourceSeed: [true, '0xE9A7AACD777D2C13'],
  HomeSystemSeed: [true, '0xA0002B50AC7'],
  CustomName: '',
  FrigateClass: { FrigateClass: cls },
  Race: { AlienRace: 'Traders' },
  InventoryClass: { InventoryClass: grade },
  TotalNumberOfExpeditions: 32,
  TotalNumberOfSuccessfulEvents: 527,
  TotalNumberOfFailedEvents: 17,
  NumberOfTimesDamaged: 27,
  TraitIDs: traits,
  Stats: stats,
  ...overrides
})

test('extractFrigates: stats land on the right fields and class names are translated', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        FleetFrigates: [
          frigate(
            'Diplomacy',
            'S',
            [9, 10, 11, 33, 12, 4, 2, 0, 0, 1, 0],
            ['^TRADING_PRI', '^TRADING_SEC_6', '^FUEL_TER_7', '^', '^']
          ),
          frigate('Mining', 'A', [11, 6, 24, 7, 11, 0, 0, 0, 0, 0, 0], ['^MINING_PRI']),
          frigate('Support', 'C', [4, 0, 0, 0, 3, 19, 0, 0, 0, 0, 0], ['^FUEL_PRI'])
        ]
      }
    }
  }

  const fleet = extractFrigates(root)
  assert.strictEqual(fleet.length, 3)

  const [trade, industrial, support] = fleet
  assert.strictEqual(trade.type, 'Trade')
  assert.strictEqual(trade.inventoryClass, 'S')
  assert.strictEqual(trade.race, 'Traders')
  assert.strictEqual(trade.name, null)
  assert.strictEqual(trade.combat, 9)
  assert.strictEqual(trade.exploration, 10)
  assert.strictEqual(trade.industrial, 11)
  assert.strictEqual(trade.trade, 33)
  assert.strictEqual(trade.fuelBurnRate, 12)
  assert.strictEqual(trade.fuelCapacity, 4)
  assert.strictEqual(trade.speed, 2)
  assert.strictEqual(trade.invulnerability, 1)
  // '^' sigils are stripped and empty trait slots dropped.
  assert.deepStrictEqual(trade.traits, ['TRADING_PRI', 'TRADING_SEC_6', 'FUEL_TER_7'])
  assert.strictEqual(trade.expeditions, 32)
  assert.strictEqual(trade.successfulEvents, 527)
  assert.strictEqual(trade.failedEvents, 17)
  assert.strictEqual(trade.timesDamaged, 27)

  assert.strictEqual(industrial.type, 'Industrial')
  assert.strictEqual(industrial.index, 1)
  assert.strictEqual(support.type, 'Support')
  assert.strictEqual(support.fuelCapacity, 19)
})

test('extractFrigates: custom name is kept, unset-seed entries are skipped', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        FleetFrigates: [
          frigate('Combat', 'B', [26, 7, 10, 5, 10, 0, 0, 0, 0, 2, 0], ['^COMBAT_PRI'], {
            CustomName: 'The Hammer'
          }),
          frigate('Exploration', 'B', [5, 26, 5, 5, 8, 0, 0, 0, 0, 0, 0], ['^EXPLORE_PRI'], {
            ResourceSeed: [false, '0x0']
          })
        ]
      }
    }
  }

  const fleet = extractFrigates(root)
  assert.strictEqual(fleet.length, 1)
  assert.strictEqual(fleet[0].name, 'The Hammer')
  assert.strictEqual(fleet[0].type, 'Combat')
})

test('extractFrigates: reads through the obfuscated key mapping', () => {
  const obfuscated = {
    vLc: {
      '6f=': {
        ';Du': [
          {
            SLc: [true, '0xF83E2FE471547B34'],
            fH8: '',
            uw7: { uw7: 'Mining' },
            SS2: { '0Hi': 'Warriors' },
            '1o6': { '1o6': 'A' },
            '5es': 15,
            'v=L': 114,
            '5VG': 14,
            MuL: 10,
            Mjm: ['^MINING_PRI', '^COMBAT_TER_1'],
            gUR: [11, 6, 24, 7, 11, 0, 0, 0, 0, 0, 0]
          }
        ]
      }
    }
  }

  const fleet = extractFrigates(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.strictEqual(fleet.length, 1)
  assert.strictEqual(fleet[0].type, 'Industrial')
  assert.strictEqual(fleet[0].race, 'Warriors')
  assert.strictEqual(fleet[0].inventoryClass, 'A')
  assert.strictEqual(fleet[0].industrial, 24)
  assert.deepStrictEqual(fleet[0].traits, ['MINING_PRI', 'COMBAT_TER_1'])
})

test('extractFrigates: empty on saves without fleet data', () => {
  assert.deepStrictEqual(extractFrigates({ BaseContext: { PlayerStateData: {} } }), [])
  assert.deepStrictEqual(extractFrigates({}), [])
})
