/**
 * Tests for language word-progress extraction, driven by synthetic save
 * trees shaped like a real Game Pass save (KnownWordGroups entries carrying
 * a word-group id plus per-race boolean flags).
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  DEFAULT_KEY_MAPPING,
  deobfuscateKeys,
  extractLanguageProgress
} = require('./.build/main/services/saveParser.js')
const { LANGUAGE_TOTALS } = require('./.build/shared/languageWords.js')

const entry = (group, ...raceIndexes) => ({
  Group: group,
  Races: Array.from({ length: 9 }, (_, i) => raceIndexes.includes(i))
})

test('extractLanguageProgress: group and word tallies per language', () => {
  const root = {
    BaseContext: {
      PlayerStateData: {
        KnownWordGroups: [
          entry('^TRA_A', 0), // 1 Gek word
          entry('^WAR_ABANDON', 1), // 2 Vy'keen words (abandon + abandoned)
          entry('^ATLAS_END', 4), // 5 Atlas words
          entry('^BUI_ABORT', 8), // 1 Autophage word
          entry('^TRA_UNSEEN') // seen but learned for no race: counts nowhere
        ]
      }
    }
  }
  const byName = Object.fromEntries(extractLanguageProgress(root).map((l) => [l.language, l]))
  assert.deepStrictEqual(Object.keys(byName).sort(), [
    'Atlas',
    'Autophage',
    'Gek',
    'Korvax',
    "Vy'keen"
  ])
  assert.strictEqual(byName.Gek.wordsKnown, 1)
  assert.strictEqual(byName.Gek.groupsKnown, 1)
  assert.strictEqual(byName["Vy'keen"].wordsKnown, 2)
  assert.strictEqual(byName["Vy'keen"].groupsKnown, 1)
  assert.strictEqual(byName.Atlas.wordsKnown, 5)
  assert.strictEqual(byName.Autophage.wordsKnown, 1)
  assert.strictEqual(byName.Korvax.wordsKnown, 0)
  assert.strictEqual(byName.Korvax.groupsKnown, 0)
  // Totals come straight from the bundled vocabulary table.
  assert.strictEqual(byName.Gek.totalWords, LANGUAGE_TOTALS.Gek.words)
  assert.strictEqual(byName.Gek.totalGroups, LANGUAGE_TOTALS.Gek.groups)
})

test('extractLanguageProgress: shorter pre-Autophage race arrays and unmapped indexes', () => {
  const root = {
    PlayerStateData: {
      KnownWordGroups: [
        // Older saves carry 8-flag arrays (no Autophage slot).
        { Group: '^TRA_A', Races: [true, false, false, false, false, false, false, false] },
        // Indexes without a language (Robots=3, Diplomats=5, Exotics=6, 7) are ignored.
        { Group: '^TRA_A', Races: [false, false, false, true, false, true, true, true] }
      ]
    }
  }
  const byName = Object.fromEntries(extractLanguageProgress(root).map((l) => [l.language, l]))
  assert.strictEqual(byName.Gek.wordsKnown, 1)
  const learnt = extractLanguageProgress(root).reduce((sum, l) => sum + l.wordsKnown, 0)
  assert.strictEqual(learnt, 1)
})

test('extractLanguageProgress: saves without word data return [] (never zeroes)', () => {
  assert.deepStrictEqual(extractLanguageProgress({ PlayerStateData: {} }), [])
  assert.deepStrictEqual(extractLanguageProgress({}), [])
})

test('extractLanguageProgress: obfuscated keys are handled via the default mapping', () => {
  // Key shapes copied from a real Game Pass save.
  const obfuscated = {
    vLc: {
      '6f=': {
        MF2: [
          { MYl: '^EXP_A', 'D;o': [false, false, true, false, false, false, false, false, false] }
        ]
      }
    }
  }
  const byName = Object.fromEntries(
    extractLanguageProgress(deobfuscateKeys(obfuscated, DEFAULT_KEY_MAPPING)).map((l) => [
      l.language,
      l
    ])
  )
  assert.strictEqual(byName.Korvax.wordsKnown, 2) // ^EXP_A unlocks two words
  assert.strictEqual(byName.Korvax.groupsKnown, 1)
})
