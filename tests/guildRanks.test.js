/**
 * Tests for the guild rank ladder: OCR-tolerant rank normalisation and the
 * positional envoy stock availability rule (row i unlocks at rank i).
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  ENVOY_STOCK_ROWS,
  GUILD_RANKS,
  envoyItemLocked,
  normalizeGuildRank,
  rankIndex
} = require('./.build/shared/guildRanks.js')

test('rank normalisation: exact names and OCR garbles resolve', () => {
  for (const rank of GUILD_RANKS) {
    assert.strictEqual(normalizeGuildRank(rank), rank)
    assert.strictEqual(normalizeGuildRank(`Rank: ${rank.toUpperCase()}`), rank)
  }
  // Classic OCR confusions: I/l, o/0, rn/m.
  assert.strictEqual(normalizeGuildRank('lnitiate'), 'Initiate')
  assert.strictEqual(normalizeGuildRank('Journeyrnan'), 'Journeyman')
  assert.strictEqual(normalizeGuildRank('J0urneyman'), 'Journeyman')
  assert.strictEqual(normalizeGuildRank('Ass0ciate'), 'Associate')
  assert.strictEqual(normalizeGuildRank('Exa1ted'), 'Exalted')
  // Garbage must not become a rank.
  assert.strictEqual(normalizeGuildRank('Wanted'), null)
  assert.strictEqual(normalizeGuildRank(''), null)
  assert.strictEqual(normalizeGuildRank(null), null)
})

test('rank index follows the ladder', () => {
  assert.strictEqual(rankIndex('Initiate'), 0)
  assert.strictEqual(rankIndex('Journeyman'), 2)
  assert.strictEqual(rankIndex('Exalted'), GUILD_RANKS.length - 1)
  assert.strictEqual(rankIndex('nonsense'), null)
})

test('availability: row i locks above the current rank', () => {
  // Onusko scenario: Journeyman (index 2) -> rows 0-2 open, 3-5 locked.
  for (let i = 0; i < ENVOY_STOCK_ROWS; i++) {
    assert.strictEqual(envoyItemLocked(i, 'Journeyman', ENVOY_STOCK_ROWS), i > 2, `row ${i}`)
  }
  assert.strictEqual(envoyItemLocked(5, 'Exalted', ENVOY_STOCK_ROWS), false)
  assert.strictEqual(envoyItemLocked(1, 'Initiate', ENVOY_STOCK_ROWS), true)
})

test('availability: never dim on a guess', () => {
  // Unknown standing: nothing locks.
  assert.strictEqual(envoyItemLocked(5, null, ENVOY_STOCK_ROWS), false)
  assert.strictEqual(envoyItemLocked(5, 'garbled', ENVOY_STOCK_ROWS), false)
  // Incomplete scan (a dropped middle row shifts positions): nothing locks.
  assert.strictEqual(envoyItemLocked(4, 'Initiate', ENVOY_STOCK_ROWS - 1), false)
  assert.strictEqual(envoyItemLocked(0, 'Initiate', 0), false)
})
