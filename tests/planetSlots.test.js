/**
 * Tests for the placeholder-claiming rules a named scan uses to land in an
 * existing row instead of duplicating: save stubs and nameless scans are
 * claimable, base evidence pins slots, and settlements — which the game's
 * Discoveries cards never list — must not repel no-base scans.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  choosePlaceholderSlot,
  isClaimablePlanet,
  planPlaceholderMerges
} = require('./.build/main/services/systemMatcher.js')

test('isClaimablePlanet: stubs and nameless scans yes, real planets no', () => {
  assert.ok(isClaimablePlanet({ source: 'save', type: 'Unknown', name: 'Planet 3' }))
  assert.ok(isClaimablePlanet({ source: 'ocr', type: 'Unknown', name: 'Uncharted Planet' }))
  // A nameless scan that still read a type stays claimable — the name is
  // what identifies a planet, and it never got one.
  assert.ok(isClaimablePlanet({ source: 'ocr', type: 'Hyperborean Planet', name: 'Uncharted Planet' }))
  assert.ok(!isClaimablePlanet({ source: 'ocr', type: 'Scorched Planet', name: 'Oropusc XVI' }))
  assert.ok(!isClaimablePlanet({ source: 'save', type: 'Frozen Planet', name: 'Planet 2' }))
})

test('pinned index claims exactly that slot or nothing', () => {
  const candidates = [
    { id: 10, planetIndex: 1 },
    { id: 11, planetIndex: 2 }
  ]
  assert.strictEqual(choosePlaceholderSlot(candidates, [], 2, null), 11)
  assert.strictEqual(choosePlaceholderSlot(candidates, [], 5, null), null)
})

test('no evidence: lowest indexed candidate wins, unindexed last', () => {
  const candidates = [
    { id: 20, planetIndex: null },
    { id: 21, planetIndex: 3 },
    { id: 22, planetIndex: 1 }
  ]
  assert.strictEqual(choosePlaceholderSlot(candidates, [], null, null), 22)
})

test('a no-base card skips slots with a buildable base', () => {
  const candidates = [
    { id: 30, planetIndex: 1 },
    { id: 31, planetIndex: 2 }
  ]
  const bases = [{ planetIndex: 1, baseType: 'HomePlanetBase' }]
  assert.strictEqual(choosePlaceholderSlot(candidates, bases, null, 0), 31)
  // All slots base-bearing: better a guess than a duplicate row.
  const allTaken = [
    { planetIndex: 1, baseType: 'HomePlanetBase' },
    { planetIndex: 2, baseType: 'HomePlanetBase' }
  ]
  assert.strictEqual(choosePlaceholderSlot(candidates, allTaken, null, 0), 30)
})

test('settlements never repel a no-base scan — cards do not list them', () => {
  const candidates = [
    { id: 40, planetIndex: 1 },
    { id: 41, planetIndex: 2 }
  ]
  const bases = [{ planetIndex: 1, baseType: 'Settlement' }]
  assert.strictEqual(choosePlaceholderSlot(candidates, bases, null, 0), 40)
})

test('planPlaceholderMerges: settlement slots stay eligible for no-base scans', () => {
  const planets = [
    {
      id: 1,
      systemAddress: 'A',
      name: 'Planet 1',
      planetIndex: 1,
      source: 'save',
      type: 'Unknown',
      scannedAt: '2026-01-01'
    },
    {
      id: 2,
      systemAddress: 'A',
      name: 'Frostheim',
      planetIndex: null,
      source: 'ocr',
      type: 'Frozen Planet',
      scannedAt: '2026-01-02',
      cardBases: 0
    }
  ]
  const bases = [{ systemAddress: 'A', planetIndex: 1, baseType: 'Settlement' }]
  const merges = planPlaceholderMerges(planets, bases)
  assert.strictEqual(merges.length, 1)
  assert.strictEqual(merges[0].keepId, 2)
  assert.strictEqual(merges[0].planetIndex, 1)
})
