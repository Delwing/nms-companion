/**
 * Freighter-battle cooldown: extraction from a save tree shaped like a real
 * Game Pass save (obfuscated keys, stats block), and the two-gate readiness
 * maths built on top of it.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  DEFAULT_KEY_MAPPING,
  deobfuscateKeys,
  extractFreighterBattle
} = require('./.build/main/services/saveParser.js')
const {
  HOURS_BETWEEN_BATTLES,
  SECONDS_BETWEEN_BATTLES,
  WARPS_BETWEEN_BATTLES,
  evaluateFreighterBattle,
  formatDuration
} = require('./.build/shared/freighterBattle.js')

/** Global-stats block as the save stores it: one group, id/value entries. */
const stats = (values) => [
  {
    GroupId: '^GLOBAL_STATS',
    Stats: Object.entries(values).map(([Id, v]) => ({ Id, Value: { IntValue: v } }))
  },
  // Per-planet groups carry the same stat ids; only ^GLOBAL_STATS counts.
  { GroupId: '^PLANET_STATS', Stats: [{ Id: '^DIST_WARP', Value: { IntValue: 999 } }] }
]

const save = (playerState, totalPlayTime = 224870) => ({
  CommonStateData: { TotalPlayTime: totalPlayTime },
  BaseContext: { PlayerStateData: playerState }
})

/** Values taken from a real save: 78 warps done, last battle at warp 71. */
const realish = {
  TimeLastSpaceBattle: 212481,
  WarpsLastSpaceBattle: 71,
  ActiveSpaceBattleType: { SpaceBattleType: 'None' },
  Stats: stats({ '^DIST_WARP': 78, '^SPACE_BATTLES': 9 })
}

test('extractFreighterBattle: reads both gate stamps, warp counter and battle state', () => {
  const battle = extractFreighterBattle(save(realish))
  assert.deepStrictEqual(battle, {
    timeLastSpaceBattle: 212481,
    warpsLastSpaceBattle: 71,
    totalPlayTime: 224870,
    warpCount: 78,
    battlesFought: 9,
    activeBattleType: 'None'
  })
})

test('extractFreighterBattle: survives the obfuscated key round-trip', () => {
  const obfuscated = {
    '<h0': { Lg8: 224870 },
    vLc: {
      '6f=': {
        '05J': 212481,
        '8br': 71,
        '9JR': { ':4C': 'PirateFreighter' },
        gUR: [
          {
            ':rc': '^GLOBAL_STATS',
            gUR: [{ b2n: '^DIST_WARP', '>MX': { '>vs': 78 } }]
          }
        ]
      }
    }
  }
  const battle = extractFreighterBattle(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING))
  assert.strictEqual(battle.timeLastSpaceBattle, 212481)
  assert.strictEqual(battle.warpsLastSpaceBattle, 71)
  assert.strictEqual(battle.totalPlayTime, 224870)
  assert.strictEqual(battle.warpCount, 78)
  assert.strictEqual(battle.activeBattleType, 'PirateFreighter')
  // Stat absent from the save (never incremented) rather than mis-parsed as 0.
  assert.strictEqual(battle.battlesFought, null)
})

test('extractFreighterBattle: missing fields yield null, never a bogus zero', () => {
  assert.strictEqual(extractFreighterBattle({}), null)
  assert.strictEqual(extractFreighterBattle(save({ TimeLastSpaceBattle: 1 })), null)
  // No play clock anywhere: nothing to measure the timer against.
  assert.strictEqual(extractFreighterBattle({ BaseContext: { PlayerStateData: realish } }), null)
})

test('extractFreighterBattle: legacy layout keeps the play clock inside PlayerStateData', () => {
  // Save version 4655: PlayerStateData at the root, no CommonStateData.
  const battle = extractFreighterBattle({
    PlayerStateData: { ...realish, TotalPlayTime: 2722 }
  })
  assert.strictEqual(battle.totalPlayTime, 2722)
  assert.strictEqual(battle.warpsLastSpaceBattle, 71)
})

test('extractFreighterBattle: a save with no stats block still reports the stamps', () => {
  const battle = extractFreighterBattle(
    save({ TimeLastSpaceBattle: 100, WarpsLastSpaceBattle: 3 }, 200)
  )
  assert.strictEqual(battle.warpCount, null)
  assert.strictEqual(battle.battlesFought, null)
  assert.strictEqual(battle.activeBattleType, null)
})

const state = (over) => ({
  timeLastSpaceBattle: 0,
  warpsLastSpaceBattle: 0,
  totalPlayTime: 0,
  warpCount: 0,
  battlesFought: 0,
  activeBattleType: 'None',
  savedAt: '2026-08-06T10:32:39.226Z',
  ...over
})

test('evaluateFreighterBattle: both gates must clear', () => {
  const base = { timeLastSpaceBattle: 1000, warpsLastSpaceBattle: 10 }
  const bothShort = evaluateFreighterBattle(
    state({ ...base, totalPlayTime: 1000 + SECONDS_BETWEEN_BATTLES - 60, warpCount: 13 })
  )
  assert.strictEqual(bothShort.ready, false)
  assert.strictEqual(bothShort.warpsSince, 3)
  assert.strictEqual(bothShort.warpsRemaining, WARPS_BETWEEN_BATTLES - 3)
  assert.strictEqual(bothShort.secondsRemaining, 60)

  const timeOnly = evaluateFreighterBattle(
    state({ ...base, totalPlayTime: 1000 + SECONDS_BETWEEN_BATTLES, warpCount: 12 })
  )
  assert.strictEqual(timeOnly.timeReady, true)
  assert.strictEqual(timeOnly.warpsReady, false)
  assert.strictEqual(timeOnly.ready, false)

  const warpsOnly = evaluateFreighterBattle(
    state({ ...base, totalPlayTime: 2000, warpCount: 10 + WARPS_BETWEEN_BATTLES })
  )
  assert.strictEqual(warpsOnly.warpsReady, true)
  assert.strictEqual(warpsOnly.timeReady, false)
  assert.strictEqual(warpsOnly.ready, false)

  const both = evaluateFreighterBattle(
    state({
      ...base,
      totalPlayTime: 1000 + SECONDS_BETWEEN_BATTLES,
      warpCount: 10 + WARPS_BETWEEN_BATTLES
    })
  )
  assert.strictEqual(both.ready, true)
  assert.strictEqual(both.secondsRemaining, 0)
  assert.strictEqual(both.warpsRemaining, 0)
})

test('evaluateFreighterBattle: unknown warp counter falls back to the time gate', () => {
  const ready = evaluateFreighterBattle(
    state({ totalPlayTime: SECONDS_BETWEEN_BATTLES, warpCount: null })
  )
  assert.strictEqual(ready.warpsSince, null)
  assert.strictEqual(ready.warpsRemaining, null)
  assert.strictEqual(ready.warpsReady, null)
  assert.strictEqual(ready.ready, true)

  const waiting = evaluateFreighterBattle(state({ totalPlayTime: 60, warpCount: null }))
  assert.strictEqual(waiting.ready, false)
})

test('evaluateFreighterBattle: an in-progress battle is flagged, clocks never go negative', () => {
  const mid = evaluateFreighterBattle(
    state({
      // Saved mid-battle: the stamp can sit a touch ahead of the play clock.
      timeLastSpaceBattle: 500,
      totalPlayTime: 480,
      warpsLastSpaceBattle: 9,
      warpCount: 8,
      activeBattleType: 'PirateFreighter'
    })
  )
  assert.strictEqual(mid.inBattle, true)
  assert.strictEqual(mid.secondsSince, 0)
  assert.strictEqual(mid.warpsSince, 0)
  assert.strictEqual(mid.secondsRemaining, SECONDS_BETWEEN_BATTLES)
})

test('evaluateFreighterBattle: a character that never fought one is ready', () => {
  const fresh = evaluateFreighterBattle(
    state({ totalPlayTime: HOURS_BETWEEN_BATTLES * 3600 + 1, warpCount: WARPS_BETWEEN_BATTLES })
  )
  assert.strictEqual(fresh.ready, true)
})

test('formatDuration: hours, minutes, seconds', () => {
  assert.strictEqual(formatDuration(12389), '3h 26m')
  assert.strictEqual(formatDuration(7200), '2h')
  assert.strictEqual(formatDuration(1560), '26m')
  assert.strictEqual(formatDuration(40), '40s')
  assert.strictEqual(formatDuration(-5), '0s')
})
