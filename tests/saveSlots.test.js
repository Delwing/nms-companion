/**
 * Tests for save-slot identity: auto+manual saves of one character must
 * collapse into a single slot, across Game Pass and Steam/GOG layouts.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const {
  encodeSlotId,
  findSaveFiles,
  newestSlotOnDisk,
  slotIdentity
} = require('./.build/main/services/saveSlots.js')

test('slotIdentity: Game Pass auto and manual saves share a slot', () => {
  const user = '000901FB9887A49E_29070100B936489ABCE8B9AF3980429C'
  const auto = slotIdentity(
    `C:\\Users\\x\\AppData\\Local\\Packages\\HelloGames.NoMansSky_bs190hzg1sesy\\SystemAppData\\xgs\\${user}\\Slot2Auto\\data`
  )
  const manual = slotIdentity(
    `C:\\Users\\x\\AppData\\Local\\Packages\\HelloGames.NoMansSky_bs190hzg1sesy\\SystemAppData\\xgs\\${user}\\Slot2Manual\\data`
  )
  assert.ok(auto && manual)
  assert.strictEqual(auto.id, manual.id)
  assert.strictEqual(auto.label, 'Slot 2')
  // A different slot of the same user is a different character.
  const other = slotIdentity(
    `C:\\Users\\x\\AppData\\Local\\Packages\\HelloGames.NoMansSky_bs190hzg1sesy\\SystemAppData\\xgs\\${user}\\Slot1Auto\\data`
  )
  assert.notStrictEqual(other.id, auto.id)
  assert.strictEqual(other.label, 'Slot 1')
})

test('slotIdentity: Steam .hg files pair up per slot', () => {
  const dir = 'C:\\Users\\x\\AppData\\Roaming\\HelloGames\\NMS\\st_76561198000000000'
  const pairs = [
    ['save.hg', 'save2.hg', 'Slot 1'],
    ['save3.hg', 'save4.hg', 'Slot 2'],
    ['save5.hg', 'save6.hg', 'Slot 3']
  ]
  const ids = new Set()
  for (const [autoFile, manualFile, label] of pairs) {
    const auto = slotIdentity(`${dir}\\${autoFile}`)
    const manual = slotIdentity(`${dir}\\${manualFile}`)
    assert.ok(auto && manual, `${autoFile} should map to a slot`)
    assert.strictEqual(auto.id, manual.id, `${autoFile}+${manualFile} should share a slot`)
    assert.strictEqual(auto.label, label)
    ids.add(auto.id)
  }
  assert.strictEqual(ids.size, pairs.length, 'each pair is its own slot')
})

test('slotIdentity: profile directory keeps accounts apart', () => {
  const a = slotIdentity('C:\\saves\\st_111\\save.hg')
  const b = slotIdentity('C:\\saves\\st_222\\save.hg')
  assert.notStrictEqual(a.id, b.id)
})

test('slotIdentity: non-save files map to nothing', () => {
  assert.strictEqual(slotIdentity('C:\\saves\\st_111\\mf_save.hg'), null)
  assert.strictEqual(
    slotIdentity('C:\\Packages\\HelloGames.X\\SystemAppData\\xgs\\user\\AccountData\\data'),
    null
  )
})

test('encodeSlotId is filesystem-safe and keeps slots distinct', () => {
  assert.strictEqual(encodeSlotId('st_76561198000000000/Slot2'), 'st_76561198000000000-Slot2')
  assert.strictEqual(
    encodeSlotId('000901FB_29070100/Slot1'),
    '000901FB_29070100-Slot1'
  )
  assert.notStrictEqual(encodeSlotId('a/Slot1'), encodeSlotId('a/Slot2'))
})

test('findSaveFiles + newestSlotOnDisk: newest-written slot wins', () => {
  const root = mkdtempSync(join(tmpdir(), 'nms-slots-'))
  try {
    // Steam layout: two slots in one profile dir.
    const steam = join(root, 'st_123')
    mkdirSync(steam)
    writeFileSync(join(steam, 'save.hg'), 'x') // slot 1
    writeFileSync(join(steam, 'save3.hg'), 'x') // slot 2
    writeFileSync(join(steam, 'ignore.txt'), 'x')
    // Game Pass layout: slot dirs with a data file (under an xgs user dir,
    // which is what slotIdentity keys on).
    const gp = join(root, 'xgs', 'user1')
    mkdirSync(join(gp, 'Slot1Auto'), { recursive: true })
    writeFileSync(join(gp, 'Slot1Auto', 'data'), 'x')
    mkdirSync(join(gp, 'AccountData'), { recursive: true })
    writeFileSync(join(gp, 'AccountData', 'data'), 'x')

    assert.deepStrictEqual(findSaveFiles(steam).map((f) => f.split(/[\\/]/).pop()).sort(), [
      'save.hg',
      'save3.hg'
    ])
    assert.strictEqual(findSaveFiles(gp).length, 1)

    // Make the Game Pass slot the most recently written.
    const now = Date.now() / 1000
    utimesSync(join(steam, 'save.hg'), now - 300, now - 300)
    utimesSync(join(steam, 'save3.hg'), now - 200, now - 200)
    utimesSync(join(gp, 'Slot1Auto', 'data'), now - 100, now - 100)
    assert.strictEqual(newestSlotOnDisk([steam, gp]), 'user1/Slot1')

    // Flip: the Steam slot-2 save becomes newest.
    utimesSync(join(steam, 'save3.hg'), now, now)
    assert.strictEqual(newestSlotOnDisk([steam, gp]), 'st_123/Slot2')

    assert.strictEqual(newestSlotOnDisk([join(root, 'missing')]), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
