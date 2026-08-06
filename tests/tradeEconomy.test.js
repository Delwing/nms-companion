/**
 * Tests for the trade-route knowledge table: economy classification,
 * wealth tiers and best-sell-economy advice per trade-good family.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  classifyEconomy,
  economyWealth,
  tradeSellAdvice
} = require('./.build/shared/tradeEconomy.js')

test('classifyEconomy: flavour names collapse onto their economy class', () => {
  assert.strictEqual(classifyEconomy('Ore Extraction · Booming'), 'Mining')
  assert.strictEqual(classifyEconomy('Minerals'), 'Mining')
  assert.strictEqual(classifyEconomy('High Tech'), 'Technology')
  assert.strictEqual(classifyEconomy('Mass Production · Adequate'), 'Manufacturing')
  assert.strictEqual(classifyEconomy('Energy Supply'), 'Power Generation')
  assert.strictEqual(classifyEconomy('Mercantile · Opulent'), 'Trading')
  assert.strictEqual(classifyEconomy('Metal Processing'), 'Advanced Materials')
  assert.strictEqual(classifyEconomy('Research'), 'Scientific')
})

test('classifyEconomy: unknown or missing descriptors give null', () => {
  assert.strictEqual(classifyEconomy('Black Market'), null)
  assert.strictEqual(classifyEconomy(''), null)
  assert.strictEqual(classifyEconomy(null), null)
  assert.strictEqual(classifyEconomy(undefined), null)
})

test('economyWealth: strength descriptor maps to tier, absent gives null', () => {
  assert.strictEqual(economyWealth('Trading · Struggling'), 1)
  assert.strictEqual(economyWealth('Trading · Balanced'), 2)
  assert.strictEqual(economyWealth('Ore Extraction · Booming'), 3)
  assert.strictEqual(economyWealth('Scientific · High Supply'), 3)
  assert.strictEqual(economyWealth('Mining'), null)
  assert.strictEqual(economyWealth(null), null)
})

test('tradeSellAdvice: both trade loops are encoded', () => {
  // Mining -> Manufacturing -> Technology -> Power Generation -> Mining
  assert.strictEqual(tradeSellAdvice('Trade Goods (Minerals)').sellAt, 'Manufacturing')
  assert.strictEqual(tradeSellAdvice('Trade Goods (Industrial)').sellAt, 'Technology')
  assert.strictEqual(tradeSellAdvice('Trade Goods (Technology)').sellAt, 'Power Generation')
  assert.strictEqual(tradeSellAdvice('Trade Goods (Energy Source)').sellAt, 'Mining')
  // Scientific -> Trading -> Advanced Materials -> Scientific
  assert.strictEqual(tradeSellAdvice('Trade Goods (Scientific)').sellAt, 'Trading')
  assert.strictEqual(tradeSellAdvice('Trade Goods').sellAt, 'Advanced Materials')
  assert.strictEqual(tradeSellAdvice('Trade Goods (Construction)').sellAt, 'Scientific')
})

test('tradeSellAdvice: each family is produced by the class preceding its buyer', () => {
  const loopB = ['Mining', 'Manufacturing', 'Technology', 'Power Generation']
  const families = [
    'Trade Goods (Minerals)',
    'Trade Goods (Industrial)',
    'Trade Goods (Technology)',
    'Trade Goods (Energy Source)'
  ]
  families.forEach((family, i) => {
    const advice = tradeSellAdvice(family)
    assert.strictEqual(advice.producedBy, loopB[i])
    assert.strictEqual(advice.sellAt, loopB[(i + 1) % loopB.length])
  })
})

test('tradeSellAdvice: smuggled goods sell anywhere regulated, others give null', () => {
  const smuggled = tradeSellAdvice('Smuggled Goods')
  assert.strictEqual(smuggled.sellAt, null)
  assert.match(smuggled.note, /outlaw/i)
  assert.strictEqual(tradeSellAdvice('Salvaged Scrap'), null)
  assert.strictEqual(tradeSellAdvice(null), null)
})
