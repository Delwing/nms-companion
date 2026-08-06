/**
 * Tests for save-file inventory extraction and item display names,
 * driven by synthetic save trees shaped like a real Game Pass save.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  DEFAULT_KEY_MAPPING,
  deobfuscateKeys,
  extractInventories
} = require('./.build/main/services/saveParser.js')
const { itemDisplayName } = require('./.build/shared/itemNames.js')
const { itemInfo } = require('./.build/shared/itemInfo.js')

/** An inventory slot as it appears in a deobfuscated save. */
const slot = (id, amount, type = 'Substance') => ({
  Type: { InventoryType: type },
  Id: `^${id}`,
  Amount: amount,
  MaxAmount: 10000
})

const inventory = (slots, name = '') => ({ Slots: slots, Name: name })

test('extractInventories: exosuit, chests, freighter and ships with labels', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        Inventory: inventory([slot('FUEL1', 250), slot('OXYGEN', 120)]),
        Inventory_TechOnly: inventory([slot('JET1', -1, 'Technology')]),
        Chest1Inventory: inventory([slot('YELLOW2', 300)], 'BLD_STORAGE_NAME'),
        Chest2Inventory: inventory([slot('CATALYST1', 50)], 'Farm Goods'),
        Chest3Inventory: inventory([]),
        FreighterInventory: inventory([slot('STELLAR2', 900)]),
        ShipOwnership: [
          { Name: 'Rocinante', Inventory: inventory([slot('NAV_DATA', 4, 'Product')]) },
          { Name: '', Inventory: inventory([]) }
        ]
      }
    }
  }

  const containers = extractInventories(root)
  const byId = new Map(containers.map((c) => [c.containerId, c]))

  assert.deepStrictEqual(byId.get('exosuit:general').items, [
    { itemId: 'FUEL1', itemType: 'Substance', amount: 250 },
    { itemId: 'OXYGEN', itemType: 'Substance', amount: 120 }
  ])
  // Installed tech reports Amount -1; it should still show up once.
  assert.deepStrictEqual(byId.get('exosuit:tech').items, [
    { itemId: 'JET1', itemType: 'Technology', amount: 1 }
  ])
  // Unrenamed chests use the game's 0-based numbering; custom names win;
  // empties are omitted.
  assert.strictEqual(byId.get('chest:1').label, 'Storage 0')
  assert.strictEqual(byId.get('chest:2').label, 'Farm Goods')
  assert.strictEqual(byId.get('chest:3'), undefined)
  assert.strictEqual(byId.get('freighter:general').group, 'Freighter')
  // Named ship; the empty second ship contributes nothing.
  assert.strictEqual(byId.get('ship:0:general').label, 'Rocinante')
  assert.strictEqual(byId.get('ship:1:general'), undefined)
  assert.strictEqual(containers.length, 6)
})

test('extractInventories: duplicate stacks aggregate, garbage ids are dropped', () => {
  const root = {
    PlayerStateData: {
      Inventory: inventory([
        slot('FUEL2', 100),
        slot('FUEL2', 150),
        slot('ÿþ#12345', 5), // corrupted procedural entry
        { Type: { InventoryType: 'Substance' }, Id: '^', Amount: 3 } // empty sigil
      ])
    }
  }
  const containers = extractInventories(root)
  assert.strictEqual(containers.length, 1)
  assert.deepStrictEqual(containers[0].items, [
    { itemId: 'FUEL2', itemType: 'Substance', amount: 250 }
  ])
})

test('extractInventories: obfuscated Game Pass keys resolve via the default mapping', () => {
  // The same tree as a modern save stores it: every key obfuscated.
  const obfuscated = {
    vLc: {
      '6f=': {
        ';l5': {
          ':No': [
            {
              Vn8: { elv: 'Substance' },
              b2n: '^LAND1',
              '1o9': 42,
              F9q: 9999
            }
          ],
          NKm: ''
        },
        '3Nc': {
          ':No': [
            {
              Vn8: { elv: 'Product' },
              b2n: '^POWERCELL',
              '1o9': 7,
              F9q: 5
            }
          ],
          NKm: 'BLD_STORAGE_NAME'
        }
      }
    }
  }
  const root = deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING)
  const containers = extractInventories(root)
  const byId = new Map(containers.map((c) => [c.containerId, c]))
  assert.deepStrictEqual(byId.get('exosuit:general').items, [
    { itemId: 'LAND1', itemType: 'Substance', amount: 42 }
  ])
  assert.strictEqual(byId.get('chest:1').label, 'Storage 0')
  assert.deepStrictEqual(byId.get('chest:1').items, [
    { itemId: 'POWERCELL', itemType: 'Product', amount: 7 }
  ])
})

test('itemInfo: values, currencies and usage flags', () => {
  // Ferrite Dust: cheap mineral, consumed by crafting -> ingredient.
  const ferrite = itemInfo('LAND1')
  assert.ok(ferrite)
  assert.strictEqual(ferrite.currency, 'units')
  assert.ok(ferrite.value > 0)
  assert.strictEqual(ferrite.isIngredient, true)
  assert.strictEqual(ferrite.isTradeGood, false)
  // Storm Crystal: high-value curiosity, not a trade good, no crafting use.
  const storm = itemInfo('STORM_CRYSTAL')
  assert.ok(storm)
  assert.ok(storm.value > 100000)
  // A '#seed' suffix resolves through the base id.
  assert.deepStrictEqual(itemInfo('LAND1#12345'), ferrite)
  // Unknown ids yield null rather than fake data.
  assert.strictEqual(itemInfo('NO_SUCH_ITEM'), null)
})

test('itemDisplayName: known ids, procedural seeds and unknown fallbacks', () => {
  assert.strictEqual(itemDisplayName('FUEL1'), 'Carbon')
  assert.strictEqual(itemDisplayName('YELLOW2'), 'Copper')
  assert.strictEqual(itemDisplayName('SAND1'), 'Silicate Powder')
  // Procedural upgrades carry a '#seed' suffix; the base id names the family.
  assert.strictEqual(itemDisplayName('UP_LASER3#93811'), 'Mining Beam')
  // Ids missing from the table prettify instead of showing raw.
  assert.strictEqual(itemDisplayName('FOOD_M_GRUB'), 'Food M Grub')
})
