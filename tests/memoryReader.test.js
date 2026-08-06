/**
 * Tests for the experimental game-memory name harvest: packed-UA encoding
 * (must match the save's own address packing), target building, and hit
 * aggregation with the calibration gates that guard against layout drift.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const {
  packedUaHexFromAddress,
  aggregateHarvest,
  buildTargets,
  plausibleSystemName
} = require('./.build/main/services/memoryReader.js')
const { decodeHexAddress } = require('./.build/main/services/saveParser.js')

test('packedUaHexFromAddress round-trips through the save decoder', () => {
  // Real address from the probe session: voxel (-1341, 1, -1200), SSI 488.
  const hex = packedUaHexFromAddress('R0:-1341:1:-1200:488')
  assert.strictEqual(hex, 'c30ab50100e80100')
  // Interpret the little-endian bytes as the save's big-endian hex string.
  const be = hex.match(/../g).reverse().join('')
  const decoded = decodeHexAddress(be)
  assert.deepStrictEqual(
    [decoded.voxelX, decoded.voxelY, decoded.voxelZ, decoded.solarSystemIndex, decoded.planetIndex],
    [-1341, 1, -1200, 488, 0]
  )
})

test('packedUaHexFromAddress carries the planet digit for planet records', () => {
  const hex = packedUaHexFromAddress('R0:-1335:1:-1193:514', 1)
  const decoded = decodeHexAddress(hex.match(/../g).reverse().join(''))
  assert.deepStrictEqual(
    [decoded.voxelX, decoded.voxelZ, decoded.solarSystemIndex, decoded.planetIndex],
    [-1335, -1193, 514, 1]
  )
})

test('packedUaHexFromAddress rejects malformed addresses', () => {
  assert.strictEqual(packedUaHexFromAddress('not-an-address'), null)
  assert.strictEqual(packedUaHexFromAddress('R0:1:2:3'), null)
})

test('buildTargets classifies knowns, unknowns and skips ambiguous planets', () => {
  const targets = buildTargets(
    [
      { universalAddress: 'R0:-1341:1:-1200:424', name: 'Idgefie Station Omega' },
      { universalAddress: 'R0:-1335:1:-1193:514', name: 'Unknown System' }
    ],
    [
      { systemAddress: 'R0:-1335:1:-1193:514', planetIndex: 1, name: 'Planet 1' },
      { systemAddress: 'R0:-1335:1:-1193:514', planetIndex: 2, name: 'Renitusa W1' },
      { systemAddress: 'R0:-1335:1:-1193:514', planetIndex: 0, name: 'Planet 0' }, // collides with system UA
      { systemAddress: null, planetIndex: 3, name: 'Planet 3' }, // unassigned
      { systemAddress: 'R0:-1335:1:-1193:514', planetIndex: null, name: 'Somewhere' } // OCR, no index
    ]
  )
  assert.deepStrictEqual(
    targets.map((t) => [t.kind, t.knownName]),
    [
      ['system', 'Idgefie Station Omega'],
      ['system', null],
      ['planet', null],
      ['planet', 'Renitusa W1']
    ]
  )
})

const sysTarget = (address, knownName = null) => ({
  kind: 'system',
  universalAddress: address,
  ua: packedUaHexFromAddress(address),
  knownName
})
const planetTarget = (address, planetIndex, knownName = null) => ({
  kind: 'planet',
  universalAddress: address,
  planetIndex,
  ua: packedUaHexFromAddress(address, planetIndex),
  knownName
})

test('aggregateHarvest names unknowns when hits agree and calibration passes', () => {
  const targets = [
    sysTarget('R0:-1341:1:-1200:424', 'Idgefie Station Omega'),
    sysTarget('R0:-1341:1:-1200:443', 'Gibrev Station Omega'),
    sysTarget('R0:-1340:1:-1198:122', 'Leuz Station Tau'),
    sysTarget('R0:-1335:1:-1193:514'),
    planetTarget('R0:-1335:1:-1193:514', 1)
  ]
  const lines = [
    `HIT\t${targets[0].ua}\tIdgefie`,
    `HIT\t${targets[1].ua}\tGibrev`,
    `HIT\t${targets[2].ua}\tLeuz`,
    `HIT\t${targets[3].ua}\tLogangjum`,
    `HIT\t${targets[3].ua}\tLogangjum`, // duplicate record, same name: fine
    `HIT\t${targets[4].ua}\tRenitusa W1`,
    'SCAN_DONE'
  ]
  const result = aggregateHarvest(lines, targets)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.named, [
    { universalAddress: 'R0:-1335:1:-1193:514', name: 'Logangjum' }
  ])
  assert.deepStrictEqual(result.namedPlanets, [
    { systemAddress: 'R0:-1335:1:-1193:514', planetIndex: 1, name: 'Renitusa W1' }
  ])
  assert.deepStrictEqual(result.calibration, { matched: 3, compared: 3 })
})

test('plausibleSystemName rejects scan noise, keeps real names', () => {
  // Real names seen in this player's catalogue, including custom ones.
  for (const good of ['Nehous-Uymaz', 'UDANE 33', 'Corpal-B3E', 'Kadaij II', 'udane 9', 'Bam bam uh uh']) {
    assert.strictEqual(plausibleSystemName(good), true, good)
  }
  // Noise actually observed in scans: ID-like strings near stray UA copies.
  for (const bad of ['-orj0000000000000001', '12345678', 'aaaaaaa', 'x', '']) {
    assert.strictEqual(plausibleSystemName(bad), false, bad)
  }
})

test('aggregateHarvest ignores implausible hit names entirely', () => {
  const targets = [sysTarget('R0:-1341:1:-1200:464'), sysTarget('R0:-1341:1:-1200:506')]
  const lines = [
    `HIT\t${targets[0].ua}\t-orj0000000000000001`, // noise only: no name
    `HIT\t${targets[1].ua}\tXiusaral`,
    `HIT\t${targets[1].ua}\t-orj0000000000000001` // noise beside a real hit: real one wins
  ]
  const result = aggregateHarvest(lines, targets)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.named, [
    { universalAddress: 'R0:-1341:1:-1200:506', name: 'Xiusaral' }
  ])
})

test('aggregateHarvest drops systems with conflicting reads', () => {
  const targets = [sysTarget('R0:-1341:1:-1200:506')]
  const lines = [`HIT\t${targets[0].ua}\tXiusaral`, `HIT\t${targets[0].ua}\tMETRY`]
  const result = aggregateHarvest(lines, targets)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.named, [])
})

test('aggregateHarvest fails closed when known system names disagree', () => {
  // A game update that moves the name offset would read garbage everywhere —
  // the known-name check has to reject the whole batch, planets included.
  const targets = [
    sysTarget('R0:-1341:1:-1200:424', 'Idgefie Station Omega'),
    sysTarget('R0:-1341:1:-1200:443', 'Gibrev Station Omega'),
    sysTarget('R0:-1340:1:-1198:122', 'Leuz Station Tau'),
    sysTarget('R0:-1341:1:-1200:506'),
    planetTarget('R0:-1335:1:-1193:514', 1)
  ]
  const lines = [
    `HIT\t${targets[0].ua}\tgarbage1`,
    `HIT\t${targets[1].ua}\tgarbage2`,
    `HIT\t${targets[2].ua}\tgarbage3`,
    `HIT\t${targets[3].ua}\tXiusaral`,
    `HIT\t${targets[4].ua}\tRenitusa W1`
  ]
  const result = aggregateHarvest(lines, targets)
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.error, 'calibration-failed')
  assert.deepStrictEqual(result.named, [])
  assert.deepStrictEqual(result.namedPlanets, [])
})

test('a planet-calibration failure drops planets but keeps system names', () => {
  // Planet knowns include OCR-typed names, which can be noisy — they must
  // not be able to take the (well-calibrated) system harvest down with them.
  const targets = [
    sysTarget('R0:-1341:1:-1200:424', 'Idgefie Station Omega'),
    sysTarget('R0:-1341:1:-1200:443', 'Gibrev Station Omega'),
    sysTarget('R0:-1340:1:-1198:122', 'Leuz Station Tau'),
    sysTarget('R0:-1335:1:-1193:514'),
    planetTarget('R0:-1341:1:-1200:424', 1, 'Ocr Name A'),
    planetTarget('R0:-1341:1:-1200:424', 2, 'Ocr Name B'),
    planetTarget('R0:-1341:1:-1200:424', 3, 'Ocr Name C'),
    planetTarget('R0:-1335:1:-1193:514', 1)
  ]
  const lines = [
    `HIT\t${targets[0].ua}\tIdgefie`,
    `HIT\t${targets[1].ua}\tGibrev`,
    `HIT\t${targets[2].ua}\tLeuz`,
    `HIT\t${targets[3].ua}\tLogangjum`,
    `HIT\t${targets[4].ua}\tDifferent A`,
    `HIT\t${targets[5].ua}\tDifferent B`,
    `HIT\t${targets[6].ua}\tDifferent C`,
    `HIT\t${targets[7].ua}\tRenitusa W1`
  ]
  const result = aggregateHarvest(lines, targets)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.named, [
    { universalAddress: 'R0:-1335:1:-1193:514', name: 'Logangjum' }
  ])
  assert.deepStrictEqual(result.namedPlanets, [])
  assert.deepStrictEqual(result.planetCalibration, { matched: 0, compared: 3 })
})

test('aggregateHarvest tolerates the occasional custom-name mismatch', () => {
  // "Atlas" is a player rename; the station endpoint still says Nameyanho.
  // One mismatch among many matches must not kill the batch.
  const targets = [
    sysTarget('R0:-1341:1:-1199:122', 'Nameyanho Station Minor'),
    sysTarget('R0:-1341:1:-1200:424', 'Idgefie Station Omega'),
    sysTarget('R0:-1341:1:-1200:443', 'Gibrev Station Omega'),
    sysTarget('R0:-1340:1:-1198:122', 'Leuz Station Tau'),
    sysTarget('R0:-1341:1:-1200:506')
  ]
  const lines = [
    `HIT\t${targets[0].ua}\tAtlas`,
    `HIT\t${targets[1].ua}\tIdgefie`,
    `HIT\t${targets[2].ua}\tGibrev`,
    `HIT\t${targets[3].ua}\tLeuz`,
    `HIT\t${targets[4].ua}\tXiusaral`
  ]
  const result = aggregateHarvest(lines, targets)
  assert.strictEqual(result.ok, true)
  assert.deepStrictEqual(result.calibration, { matched: 3, compared: 4 })
  assert.deepStrictEqual(result.named, [
    { universalAddress: 'R0:-1341:1:-1200:506', name: 'Xiusaral' }
  ])
})
