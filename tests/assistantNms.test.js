/**
 * Tests for the AssistantNMS live-data service: matching community entries
 * back to save-file item ids, and the disk cache / conditional-GET flow.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const {
  buildItemDetails,
  buildLiveTuples,
  createAssistantNms
} = require('./.build/main/services/assistantNms.js')

const entry = (Name, Group, BaseValueUnits, CurrencyType = 'Credits') => ({
  Id: 'x',
  Name,
  Group,
  BaseValueUnits,
  CurrencyType
})

test('buildLiveTuples: exact and case/punctuation-insensitive name matches', () => {
  const tuples = buildLiveTuples([
    entry('Fusion Core', 'Trade Goods (Energy Source)', 50000),
    // Static name is 'Self-repairing Heridium' — capitalisation differs.
    entry('Self-Repairing Heridium', 'Trade Goods (Construction)', 6000),
    // Static name is 'Grahgrah'.
    entry('GrahGrah', 'Smuggled Goods', 58000)
  ])
  assert.deepStrictEqual(tuples.TRA_ENERGY5, [50000, 0, 'Trade Goods (Energy Source)', 1])
  assert.deepStrictEqual(tuples.TRA_ALLOY2, [6000, 0, 'Trade Goods (Construction)', 3])
  assert.deepStrictEqual(tuples.ILLEGAL_PROD5, [58000, 0, 'Smuggled Goods', 1])
})

test('buildLiveTuples: override table covers renamed community entries', () => {
  const tuples = buildLiveTuples([
    entry('5D Torus', 'Trade Goods (Construction)', 30000),
    entry('De-Scented Bottles', 'Trade Goods (Scientific)', 1000),
    entry('Decommissioned Circuits', 'Trade Goods (Technology)', 1000)
  ])
  // These ids are absent from the static table (the name join used to miss).
  assert.deepStrictEqual(tuples.TRA_ALLOY4, [30000, 0, 'Trade Goods (Construction)', 1])
  assert.deepStrictEqual(tuples.TRA_EXOTICS1, [1000, 0, 'Trade Goods (Scientific)', 1])
  assert.deepStrictEqual(tuples.TRA_TECH1, [1000, 0, 'Trade Goods (Technology)', 1])
})

test('buildLiveTuples: keeps static ingredient flag, skips unknown names', () => {
  const tuples = buildLiveTuples([
    // Static ILLEGAL_PROD2 is flagged as an ingredient (flags 2).
    entry('Stolen DNA Samples', 'Smuggled Goods', 9000),
    entry('Definitely Not A Real Item', 'Trade Goods', 1)
  ])
  assert.deepStrictEqual(tuples.ILLEGAL_PROD2, [9000, 0, 'Smuggled Goods', 3])
  assert.strictEqual(Object.keys(tuples).length, 1)
})

test('buildLiveTuples: non-credit currencies keep their code', () => {
  const tuples = buildLiveTuples([entry('Fusion Core', 'Trade Goods (Energy Source)', 60, 'Nanites')])
  assert.strictEqual(tuples.TRA_ENERGY5[1], 1)
})

test('buildItemDetails: keys by normalised name, first dataset wins', () => {
  const rawMaterials = [
    {
      Id: 'raw19',
      Icon: 'rawMaterials/19.png',
      Name: 'Copper',
      Group: 'Refined Stellar Metal: Yellow',
      Description: 'A <STELLAR>chromatic metal<>.',
      BaseValueUnits: 41,
      CurrencyType: 'Credits',
      Colour: 'E59001'
    }
  ]
  const cooking = [
    // Same display name in a lower-priority dataset must not win.
    { Id: 'cook1', Name: 'Copper', Group: 'Ingredient', BaseValueUnits: 1, CurrencyType: 'Credits' },
    { Id: 'cook2', Name: 'Glass Heart!', Group: 'Curio', BaseValueUnits: 5, CurrencyType: 'Nanites' }
  ]
  const details = buildItemDetails([rawMaterials, cooking])
  assert.strictEqual(details.copper.group, 'Refined Stellar Metal: Yellow')
  assert.strictEqual(details.copper.icon, 'rawMaterials/19.png')
  assert.strictEqual(details.copper.colour, 'E59001')
  assert.strictEqual(details.copper.description, 'A <STELLAR>chromatic metal<>.')
  // Punctuation drops out of the key; absent fields get safe defaults.
  const heart = details.glassheart
  assert.strictEqual(heart.name, 'Glass Heart!')
  assert.strictEqual(heart.currency, 1)
  assert.strictEqual(heart.description, '')
  assert.strictEqual(heart.icon, null)
})

/** Minimal fetch stub: sequence of responses, records calls. */
function fetchStub(responses) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} })
    const next = responses.shift()
    if (next instanceof Error) throw next
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: { get: (k) => (k.toLowerCase() === 'etag' ? (next.etag ?? null) : null) },
      text: async () => next.body ?? ''
    }
  }
  return { impl, calls }
}

const SAMPLE = [entry('Fusion Core', 'Trade Goods (Energy Source)', 50000)]

test('service: fetches once, caches to disk, honours TTL across instances', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anms-'))
  try {
    const first = fetchStub([{ status: 200, body: JSON.stringify(SAMPLE), etag: '"v1"' }])
    const svc = createAssistantNms({ cacheDir: dir, fetchImpl: first.impl })
    const live = await svc.liveItemInfo()
    assert.strictEqual(live.TRA_ENERGY5[0], 50000)
    assert.strictEqual(first.calls.length, 1)
    // Cache file is real JSON on disk.
    const cached = JSON.parse(readFileSync(join(dir, 'TradeItems.lang.json'), 'utf8'))
    assert.strictEqual(cached.length, 1)

    // Fresh instance within TTL: served from disk, no network call.
    const second = fetchStub([])
    const svc2 = createAssistantNms({ cacheDir: dir, fetchImpl: second.impl })
    const live2 = await svc2.liveItemInfo()
    assert.strictEqual(live2.TRA_ENERGY5[0], 50000)
    assert.strictEqual(second.calls.length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service: expired cache revalidates with ETag and accepts 304', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anms-'))
  try {
    const first = fetchStub([{ status: 200, body: JSON.stringify(SAMPLE), etag: '"v1"' }])
    await createAssistantNms({ cacheDir: dir, fetchImpl: first.impl }).liveItemInfo()

    const revalidate = fetchStub([{ status: 304 }])
    const svc = createAssistantNms({ cacheDir: dir, fetchImpl: revalidate.impl, ttlMs: 0 })
    const live = await svc.liveItemInfo()
    assert.strictEqual(live.TRA_ENERGY5[0], 50000)
    assert.strictEqual(revalidate.calls[0].headers['If-None-Match'], '"v1"')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service: itemDetails merges datasets, icon() disk-caches and rejects bad paths', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anms-'))
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    let iconFetches = 0
    // URL-routing stub: one real dataset, empty siblings, one icon PNG.
    const impl = async (url) => {
      if (url.endsWith('.png')) {
        iconFetches += 1
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)
        }
      }
      const body = url.endsWith('RawMaterials.lang.json')
        ? JSON.stringify([
            {
              Id: 'raw19',
              Icon: 'rawMaterials/19.png',
              Name: 'Copper',
              Group: 'Refined Stellar Metal: Yellow',
              BaseValueUnits: 41,
              CurrencyType: 'Credits'
            }
          ])
        : '[]'
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => body }
    }

    const svc = createAssistantNms({ cacheDir: dir, fetchImpl: impl })
    const details = await svc.itemDetails()
    assert.strictEqual(details.copper.name, 'Copper')

    const dataUrl = await svc.icon('rawMaterials/19.png')
    assert.strictEqual(dataUrl, `data:image/png;base64,${png.toString('base64')}`)
    assert.strictEqual(iconFetches, 1)
    // Second call and even a fresh offline instance serve from disk.
    assert.strictEqual(await svc.icon('rawMaterials/19.png'), dataUrl)
    assert.strictEqual(iconFetches, 1)
    const offline = createAssistantNms({
      cacheDir: dir,
      fetchImpl: async () => {
        throw new Error('offline')
      }
    })
    assert.strictEqual(await offline.icon('rawMaterials/19.png'), dataUrl)

    // Dataset-supplied paths are data, not trusted filesystem input.
    assert.strictEqual(await svc.icon('../../outside.png'), null)
    assert.strictEqual(await svc.icon('rawMaterials/19.png.exe'), null)
    assert.strictEqual(iconFetches, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('service: network failure falls back to stale cache, or empty when none', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'anms-'))
  try {
    const first = fetchStub([{ status: 200, body: JSON.stringify(SAMPLE), etag: null }])
    await createAssistantNms({ cacheDir: dir, fetchImpl: first.impl }).liveItemInfo()

    const offline = fetchStub([new Error('offline')])
    const svc = createAssistantNms({ cacheDir: dir, fetchImpl: offline.impl, ttlMs: 0 })
    const live = await svc.liveItemInfo()
    assert.strictEqual(live.TRA_ENERGY5[0], 50000)

    const empty = mkdtempSync(join(tmpdir(), 'anms-'))
    try {
      const down = fetchStub([new Error('offline')])
      const bare = createAssistantNms({ cacheDir: empty, fetchImpl: down.impl })
      assert.deepStrictEqual(await bare.liveItemInfo(), {})
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
