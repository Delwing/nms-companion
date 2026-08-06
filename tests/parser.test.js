/**
 * Regression tests for the OCR entity parsers, driven by real captured
 * OCR text (tests/fixtures/*.txt, saved from userData/debug scans).
 * Run via `npm test` — compiles the parsers to tests/.build first.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { parseEnvoyData } = require('./.build/main/services/envoyParser.js')
const { assembleText, ctcDecode } = require('./.build/main/services/paddleOcr.js')
const { parsePlanetData } = require('./.build/main/services/planetParser.js')
const {
  matchBaseInText,
  matchSystemInText,
  planPlaceholderMerges,
  relinkPlanetsByHint,
  systemBaseName
} = require('./.build/main/services/systemMatcher.js')

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8')

test('two-column merge: resource name must not prefix the planet name', () => {
  const p = parsePlanetData(fixture('notr-beta-panel.txt'))
  assert.strictEqual(p.name, 'Notr Beta')
  assert.strictEqual(p.planetType, 'Poisonous Planet') // "sonous Planet", left edge cropped
  assert.strictEqual(p.systemHint, 'udane 9') // lowercase header
})

test('list-bullet junk: stray "O" before the name is dropped', () => {
  const p = parsePlanetData(fixture('aton-panel.txt'))
  assert.strictEqual(p.name, 'Aton IX') // roman numeral allowed
  assert.strictEqual(p.planetType, 'Torrid Planet') // mid-line after "Aton X"
  assert.deepStrictEqual(p.resources.sort(), [
    'Copper', 'Magnetised Ferrite', 'Phosphorus', 'Solanium'
  ])
})

test('item-table fallback catches resources the curated list lacks', () => {
  // "Kelp Sac" has no RESOURCE_SIGNATURES entry: the ITEM_NAMES lookup
  // recovers it from a bullet row, lost spaces and all.
  const p = parsePlanetData(
    'Fishy Prime\nDiscovered by: someone\nMarshy Planet\n# KelpSac\n4 Copper\n& Salt'
  )
  assert.ok(p.resources.includes('Kelp Sac'), 'fallback resource missing')
  assert.ok(p.resources.includes('Copper'))
  // A cropped credit line naming a player must not become a resource.
  const q = parsePlanetData('nio Beta\nscovered by: Vile Spawn\nny Planet\nStar Bulb')
  assert.ok(!q.resources.includes('Vile Spawn'))
})

test('short biome after digit junk: "0  0  Icy Planet" resolves', () => {
  // Real card read: planet icons OCR as stray digits merged into the type
  // row, and "Icy" is too short for the suffix-recovery pass.
  const p = parsePlanetData(
    'Abianast Q9    0    Abianast Q9\nDiscovered by: Inniskaa @\n0    0    Icy Planet\n$Frost Crystal\n* Copper\n Dioxite.'
  )
  assert.strictEqual(p.planetType, 'Icy Planet')
  // A neighbouring row's "Unknown Planet" must not beat the known biome.
  const q = parsePlanetData(
    'S Lefar XI1    .    Unknown Planet    own Planet\nAbianast Q9\n0    0    Icy Planet'
  )
  assert.strictEqual(q.planetType, 'Icy Planet')
})

test('sidebar junk and multi-line type stitching', () => {
  const full = parsePlanetData(fixture('ulchig-full.txt'))
  assert.strictEqual(full.name, 'Ulchig Nadair')
  assert.strictEqual(full.planetType, 'Paradise Planet')
  assert.ok(!full.planetType.includes('\n'))
  assert.strictEqual(full.systemHint, 'Gigantula-System') // not the player name

  const panel = parsePlanetData(fixture('ulchig-panel.txt'))
  assert.strictEqual(panel.name, 'Ulchig Nadair') // recovered from "hig Nadair"
  assert.strictEqual(panel.planetType, 'Paradise Planet') // from "adise Planet"
})

test('card header system name is extracted as hint', () => {
  const p = parsePlanetData(fixture('pool-panel.txt'))
  assert.strictEqual(p.name, 'Pool')
  assert.strictEqual(p.planetType, 'Overgrown Planet')
  assert.strictEqual(p.systemHint, 'Laerib')
})

test('header system name never becomes the planet name', () => {
  const p = parsePlanetData(fixture('cirenio-panel.txt'))
  assert.strictEqual(p.systemHint, 'Sehcher-Amna XIX')
  // Left-cropped tail "nio Beta" recovered from the intact column entry.
  assert.strictEqual(p.name, 'Cirenio Beta')
})

test('exotic biomes resolve', () => {
  const p = parsePlanetData(fixture('haydru-panel.txt'))
  assert.strictEqual(p.name, 'Haydru Beta')
  assert.strictEqual(p.planetType, 'Hexagonal Planet')
})

test('flight HUD wrap: lone "Magnetised" still yields Magnetised Ferrite', () => {
  const p = parsePlanetData(fixture('nunyval-flight-paddle.txt'))
  assert.strictEqual(p.name, 'Nunyval')
  assert.strictEqual(p.planetType, 'Poisonous Planet')
  assert.deepStrictEqual(p.resources.sort(), [
    'Ammonia', 'Copper', 'Fungal Mould', 'Magnetised Ferrite', 'Vile Brood'
  ])
})

test('standalone, hyphenated and trailing planet types resolve', () => {
  // Worlds-era types with no Planet/Moon noun at all. The header names
  // the system; the planet name sits above the credit line.
  const a = parsePlanetData('Laerib\nGowry Minor\nDiscovered by: someone\nVermillion Globe\nCopper')
  assert.strictEqual(a.planetType, 'Vermillion Globe')
  assert.strictEqual(a.name, 'Gowry Minor')

  // Capital after the hyphen used to break the title-case line match.
  const b = parsePlanetData('Erido XI\nscovered by: someone\nLife-Incompatible Planet')
  assert.strictEqual(b.planetType, 'Life-Incompatible Planet')

  // Punctuation noise around a standalone type still matches.
  const c = parsePlanetData('Bakkin Minor\nDiscovered by: someone\n~ Terraforming. Catastrophe')
  assert.strictEqual(c.planetType, 'Terraforming Catastrophe')

  // The descriptor can trail the noun.
  const d = parsePlanetData('Bright Prime\nPlanet of Light\nCadmium')
  assert.strictEqual(d.planetType, 'Planet of Light')

  // A noun-less type line directly above the credit line must not be
  // mistaken for the planet's name.
  const e = parsePlanetData('Laerib\nEnnaji Minor\nWaterworld\nDiscovered by: someone\nSalt')
  assert.strictEqual(e.planetType, 'Waterworld')
  assert.strictEqual(e.name, 'Ennaji Minor')
})

test('ordinary card scans stay correct', () => {
  const a = parsePlanetData(fixture('awsandba-panel.txt'))
  assert.strictEqual(a.name, 'Awsandba IX')
  assert.strictEqual(a.planetType, 'Torrid Planet')
  // The hot-planet plant, plus the "Vile Brood Detected" infestation row.
  assert.deepStrictEqual(a.resources.sort(), [
    'Ancient Bones', 'Cobalt', 'Copper', 'Phosphorus', 'Solanium', 'Vile Brood'
  ])

  const b = parsePlanetData(fixture('psychadelic-panel.txt'))
  assert.strictEqual(b.name, 'Psychadelic')
  assert.strictEqual(b.planetType, 'Humid Planet')
})

test('envoy items: garbled Ionised Cobalt resolves, glow junk is dropped', () => {
  const e = parseEnvoyData(fixture('onusko-envoy-banner.txt'), fixture('onusko-envoy-items.txt'))
  assert.strictEqual(e.guild, 'Explorers')
  assert.strictEqual(e.envoyName, 'Onusko')
  assert.strictEqual(e.guildRank, 'Journeyman')
  // "lonised Cobalt" / "lonised.Cobal ZZ" must resolve to the real item,
  // not a trimmed-down "Cobalt", and the "...FREE" glow fragment is junk.
  assert.ok(!e.items.includes('Cobalt'))
  assert.ok(!e.items.includes('ESS F FREE'))
  // Order mirrors the screen: stock row i unlocks at guild rank i, so the
  // array position carries each item's required rank. The dual-threshold
  // join must not scramble it (locked rows are a suffix).
  assert.deepStrictEqual(e.items, [
    'Ion Battery',
    'Warp Hypercore',
    'Ionised Cobalt',
    'Sac Venom',
    'Anomaly Detector',
    'Movement Module'
  ])
})

test('paddle CTC decode: repeats collapse, blanks separate', () => {
  const dict = ['<blank>', 'A', 'B', ' ']
  // timesteps (C=4, argmax marked): A, A, blank, B, B  ->  "AB"
  const probs = Float32Array.from([
    0.1, 0.9, 0.0, 0.0,
    0.1, 0.8, 0.1, 0.0,
    0.9, 0.05, 0.05, 0.0,
    0.0, 0.1, 0.9, 0.0,
    0.1, 0.0, 0.9, 0.0
  ])
  const { text } = ctcDecode(probs, 5, 4, dict)
  assert.strictEqual(text, 'AB')
  // blank between repeats keeps both: A, blank, A -> "AA"
  const probs2 = Float32Array.from([0.1, 0.9, 0.0, 0.0, 0.9, 0.05, 0.0, 0.05, 0.1, 0.9, 0.0, 0.0])
  assert.strictEqual(ctcDecode(probs2, 3, 4, dict).text, 'AA')
})

test('paddle line assembly: rows merge, columns gap, zones filter', () => {
  const frame = {
    width: 1000,
    height: 100,
    boxes: [
      { x0: 500, y0: 2, x1: 600, y1: 12, text: 'World', conf: 0.9 },
      { x0: 0, y0: 0, x1: 100, y1: 10, text: 'Hello', conf: 0.9 },
      { x0: 110, y0: 1, x1: 200, y1: 11, text: 'there', conf: 0.9 },
      { x0: 0, y0: 50, x1: 80, y1: 60, text: 'Next', conf: 0.9 }
    ]
  }
  // same row joins left-to-right; >2%-width jumps become a column gap
  assert.strictEqual(assembleText(frame), 'Hello there    World\nNext')
  // proportional zone keeps only boxes whose centre falls inside it
  const rightHalf = { key: 'x', left: 0.4, top: 0, width: 0.6, height: 0.5 }
  assert.strictEqual(assembleText(frame, rightHalf), 'World')
})

test('paddle card text: orbit labels do not shadow the card biome', () => {
  const p = parsePlanetData(fixture('moga-panel-paddle.txt'))
  assert.strictEqual(p.name, 'Moga 54/N8')
  // "Unknown Moon" orbit labels float above the card; the known biome wins.
  assert.strictEqual(p.planetType, 'Overgrown Planet')
  assert.strictEqual(p.sentinels, 'High')
  assert.deepStrictEqual(p.resources.sort(), ['Copper', 'Paraffinium', 'Sodium', 'Star Bulb'])
  // Header lost its stylized capital ("Leuz" -> "euz"); the matcher still
  // attaches the scan to the catalogued system.
  const system = { universalAddress: 'A', name: 'Leuz Station Minor' }
  assert.strictEqual(matchSystemInText([system], fixture('moga-panel-paddle.txt')), system)
})

test('paddle card text: salvage resources are captured', () => {
  const p = parsePlanetData(fixture('wucossimo-panel-paddle.txt'))
  assert.strictEqual(p.name, 'Wucossimo Beta')
  assert.strictEqual(p.planetType, 'Dead Moon')
  assert.strictEqual(p.sentinels, 'High')
  assert.strictEqual(p.systemHint, 'Migayas')
  // "Ancient Bones" and "Rusted Metal" sit in the resource list alongside minerals.
  assert.deepStrictEqual(p.resources.sort(), ['Ancient Bones', 'Cobalt', 'Copper', 'Rusted Metal'])
})

test('system matcher: station names double as system names', () => {
  assert.strictEqual(systemBaseName('Leuz Station Tau'), 'Leuz')
  assert.strictEqual(systemBaseName('The Simaon-Umam IV Sphere'), 'Simaon-Umam IV')
  assert.strictEqual(systemBaseName('Rakawa Stellar Observer'), 'Rakawa')

  const SYSTEMS = [
    { universalAddress: 'A', name: 'Laerib Station Minor' },
    { universalAddress: 'B', name: 'udane 9 Station Minor' },
    { universalAddress: 'C', name: 'UDANE I Station Omega' },
    { universalAddress: 'D', name: 'Gigantula-System Station Omega' },
    { universalAddress: 'E', name: 'Unknown System' }
  ]
  assert.strictEqual(matchSystemInText(SYSTEMS, '| » Laerib ').universalAddress, 'A')
  assert.strictEqual(matchSystemInText(SYSTEMS, 'Gigantula-System').universalAddress, 'D')
  assert.strictEqual(matchSystemInText(SYSTEMS, 'browsing udane 9 now').universalAddress, 'B')
  assert.strictEqual(matchSystemInText(SYSTEMS, 'no such place here'), null)
})

test('base matcher: a base named on the card pins system and planet index', () => {
  // Real incident: the "luchae" header failed to match, but the card body
  // listed "Teusi-Lola Base" — which the save places on Iuchae planet 3.
  const BASES = [
    { systemAddress: 'IUCHAE', planetIndex: 3, name: 'Teusi-Lola Base' },
    { systemAddress: 'IUCHAE', planetIndex: null, name: 'Freighter Base' }, // no planet
    { systemAddress: 'OTHER', planetIndex: 1, name: 'Unnamed Base' } // generic: skipped
  ]
  const hit = matchBaseInText(BASES, fixture('moscowen-panel-paddle.txt'))
  assert.strictEqual(hit.systemAddress, 'IUCHAE')
  assert.strictEqual(hit.planetIndex, 3)
  assert.strictEqual(matchBaseInText(BASES, 'no bases mentioned here'), null)
  assert.strictEqual(matchBaseInText(BASES, 'an Unnamed Base somewhere'), null)
})

test('placeholder merges: a card that showed no base avoids base-bearing slots', () => {
  // Iuchae scenario: bases sit on planets 4 and 6; two scans whose cards
  // showed no base must pair with the baseless slots 1 and 5, not 4.
  const planets = [
    { id: 10, systemAddress: 'S', name: 'Planet 1', planetIndex: 1, source: 'save', type: 'Unknown', scannedAt: '2026-01-01' },
    { id: 11, systemAddress: 'S', name: 'Planet 4', planetIndex: 4, source: 'save', type: 'Unknown', scannedAt: '2026-01-01' },
    { id: 12, systemAddress: 'S', name: 'Planet 5', planetIndex: 5, source: 'save', type: 'Unknown', scannedAt: '2026-01-01' },
    { id: 20, systemAddress: 'S', name: 'Arwa D28', planetIndex: null, source: 'ocr', type: 'Dead Planet', scannedAt: '2026-01-02', cardBases: 0 },
    { id: 21, systemAddress: 'S', name: 'Midor 94/04', planetIndex: null, source: 'ocr', type: 'Frozen Planet', scannedAt: '2026-01-03', cardBases: 0 }
  ]
  const bases = [
    { systemAddress: 'S', planetIndex: 4 },
    { systemAddress: 'S', planetIndex: 6 }
  ]
  const merges = planPlaceholderMerges(planets, bases)
  assert.deepStrictEqual(
    merges.map((m) => [m.keepId, m.planetIndex]),
    [
      [20, 1],
      [21, 5]
    ]
  )
  // Without the negative evidence the old zip pairing (4 to the second scan)
  // still applies.
  const legacy = planets.map((p) => ({ ...p, cardBases: null }))
  assert.deepStrictEqual(
    planPlaceholderMerges(legacy, bases).map((m) => [m.keepId, m.planetIndex]),
    [
      [20, 1],
      [21, 4]
    ]
  )
})

test('system matcher: OCR-garbled first capital still matches', () => {
  // Real incident: card header "Iuchae" read as "luchae" (capital I and
  // lowercase l are identical glyphs) left four scanned planets orphaned.
  const iuchae = { universalAddress: 'F', name: 'Iuchae Station Omega' }
  assert.strictEqual(matchSystemInText([iuchae], 'luchae'), iuchae)
  // Dropped first capital keeps matching too ("Leuz" -> "euz").
  const leuz = { universalAddress: 'A', name: 'Leuz Station Minor' }
  assert.strictEqual(matchSystemInText([leuz], 'planet card euz header'), leuz)
  // The garbled char must replace the first, not extend the tail elsewhere.
  assert.strictEqual(matchSystemInText([iuchae], 'no uchaX here'), null)
})

test('orphan planets get tied once their hinted system shows up', () => {
  const systems = [{ universalAddress: 'E', name: 'Unknown System' }]
  const planets = [
    { id: 1, systemAddress: null, systemHint: 'Laerib' },
    { id: 2, systemAddress: null, systemHint: 'udane 9' },
    { id: 3, systemAddress: null, systemHint: null }, // no hint: untouched
    { id: 4, systemAddress: 'X', systemHint: 'Laerib' } // already tied: untouched
  ]
  const store = {
    listSystems: () => systems,
    listPlanets: () => planets,
    setPlanetSystem: (id, address) => {
      planets.find((p) => p.id === id).systemAddress = address
    }
  }

  // Nothing catalogued under those names yet: nothing links.
  assert.strictEqual(relinkPlanetsByHint(store), 0)

  // The systems arrive (save sync names their stations): hints resolve.
  systems.push(
    { universalAddress: 'A', name: 'Laerib Station Minor' },
    { universalAddress: 'B', name: 'udane 9 Station Minor' }
  )
  assert.strictEqual(relinkPlanetsByHint(store), 2)
  assert.strictEqual(planets[0].systemAddress, 'A')
  assert.strictEqual(planets[1].systemAddress, 'B')
  assert.strictEqual(planets[2].systemAddress, null)
  assert.strictEqual(planets[3].systemAddress, 'X')

  // A second sync finds no remaining orphans.
  assert.strictEqual(relinkPlanetsByHint(store), 0)
})

test('flight HUD: status label "Unmapped" never shadows the target name', () => {
  const p = parsePlanetData(fixture('moga-flight-full.txt'))
  // Slash designations are valid names; "Unmapped" sits right below them.
  assert.strictEqual(p.name, 'Moga 54/N8')
})

test('placeholder stubs merge into already-scanned OCR planets', () => {
  const planets = [
    // System S: two save stubs, one scanned OCR planet without an index.
    { id: 1, systemAddress: 'S', name: 'Planet 2', planetIndex: 2, source: 'save', type: 'Unknown', scannedAt: '2026-01-02' },
    { id: 2, systemAddress: 'S', name: 'Planet 4', planetIndex: 4, source: 'save', type: 'Unknown', scannedAt: '2026-01-02' },
    { id: 3, systemAddress: 'S', name: 'Moga 54/N8', planetIndex: null, source: 'ocr', type: 'Overgrown Planet', scannedAt: '2026-01-01' },
    // Already indexed OCR planet: not a merge candidate.
    { id: 4, systemAddress: 'S', name: 'Wucossimo Beta', planetIndex: 1, source: 'ocr', type: 'Dead Moon', scannedAt: '2026-01-01' },
    // Renamed save planet (not a "Planet N" stub): kept.
    { id: 5, systemAddress: 'S', name: 'My Home', planetIndex: 3, source: 'save', type: 'Unknown', scannedAt: '2026-01-02' },
    // Different system: never crosses over.
    { id: 6, systemAddress: 'T', name: 'Planet 1', planetIndex: 1, source: 'save', type: 'Unknown', scannedAt: '2026-01-02' },
    // Unassigned OCR planet: no system, no merge.
    { id: 7, systemAddress: null, name: 'Pool', planetIndex: null, source: 'ocr', type: 'Overgrown Planet', scannedAt: '2026-01-01' }
  ]
  const merges = planPlaceholderMerges(planets)
  // One scan, two stubs: the scan claims the lowest free index, the other
  // stub stays (it is a genuinely unscanned planet).
  assert.deepStrictEqual(merges, [{ keepId: 3, dropId: 1, planetIndex: 2 }])
})
