/**
 * Tests for locating save directories. The Linux paths can't be exercised on a
 * Windows dev box, so the platform-specific parts are pure path/text functions
 * tested directly; only the config.json override, which runs everywhere, is
 * tested against a real directory tree.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const {
  locateSaveDirs,
  parseLibraryFolders,
  protonUsersDir,
  steamRootCandidates
} = require('./.build/main/services/saveLocations.js')
const { slotIdentity } = require('./.build/main/services/saveSlots.js')

const MODERN_VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"/home/pilot/.local/share/Steam"
		"label"		""
		"apps"
		{
			"275850"		"14953821766"
		}
	}
	"1"
	{
		"path"		"/mnt/games/SteamLibrary"
		"apps"
		{
			"275850"		"14953821766"
		}
	}
}`

test('parseLibraryFolders: reads every library path from the modern format', () => {
  assert.deepStrictEqual(parseLibraryFolders(MODERN_VDF), [
    '/home/pilot/.local/share/Steam',
    '/mnt/games/SteamLibrary'
  ])
})

test('parseLibraryFolders: app ids in the "apps" block are not mistaken for paths', () => {
  assert.ok(!parseLibraryFolders(MODERN_VDF).includes('14953821766'))
})

test('parseLibraryFolders: still reads the pre-2021 numeric-key format', () => {
  const legacy = `"LibraryFolders"
{
	"TimeNextStatsReport"		"1600000000"
	"ContentStatsID"		"-1234567890"
	"1"		"/mnt/games/SteamLibrary"
}`
  assert.deepStrictEqual(parseLibraryFolders(legacy), ['/mnt/games/SteamLibrary'])
})

test('protonUsersDir: points at the prefix Steam creates for app 275850', () => {
  assert.strictEqual(
    protonUsersDir('/mnt/games/SteamLibrary'),
    '/mnt/games/SteamLibrary/steamapps/compatdata/275850/pfx/drive_c/users'
  )
})

test('steamRootCandidates: covers the native, symlinked and flatpak installs', () => {
  const roots = steamRootCandidates('/home/pilot')
  assert.ok(roots.includes('/home/pilot/.local/share/Steam'))
  assert.ok(roots.includes('/home/pilot/.steam/steam'))
  assert.ok(
    roots.includes('/home/pilot/.var/app/com.valvesoftware.Steam/.local/share/Steam'),
    'flatpak Steam keeps its data inside the sandbox dir'
  )
})

test('steamRootCandidates: XDG_DATA_HOME wins when set', () => {
  const roots = steamRootCandidates('/home/pilot', '/data/xdg')
  assert.strictEqual(roots[0], '/data/xdg/Steam')
})

/**
 * The slot id is what names the per-slot database, so a Proton path and the
 * equivalent Windows path must collapse to the same id — otherwise moving
 * between the two would silently start a second catalogue.
 */
test('slotIdentity: a Proton save path yields the same slot id as the Windows one', () => {
  const profile = 'st_76561198012345678'
  const linux = slotIdentity(
    `/home/pilot/.local/share/Steam/steamapps/compatdata/275850/pfx/drive_c/users/` +
      `steamuser/AppData/Roaming/HelloGames/NMS/${profile}/save2.hg`
  )
  const windows = slotIdentity(
    `C:\\Users\\pilot\\AppData\\Roaming\\HelloGames\\NMS\\${profile}\\save2.hg`
  )
  assert.deepStrictEqual(linux, windows)
  assert.strictEqual(linux.id, `${profile}/Slot1`)
})

test('locateSaveDirs: a config.json override expands profile dirs and save dirs alike', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'nms-locations-'))
  try {
    // An NMS root holding profile folders — the shape inside a Wine prefix.
    const nmsRoot = join(tmp, 'prefix', 'HelloGames', 'NMS')
    mkdirSync(join(nmsRoot, 'st_999'), { recursive: true })
    mkdirSync(join(nmsRoot, 'ignored'), { recursive: true })
    // A profile folder pointed at directly.
    const direct = join(tmp, 'direct')
    mkdirSync(direct, { recursive: true })
    writeFileSync(join(direct, 'save.hg'), 'x')

    const dirs = locateSaveDirs([join(tmp, 'prefix'), direct, join(tmp, 'does-not-exist')])

    assert.ok(dirs.includes(join(nmsRoot, 'st_999')), 'profile dir under the given root')
    assert.ok(!dirs.includes(join(nmsRoot, 'ignored')), 'non-profile subdirs are skipped')
    assert.ok(dirs.includes(direct), 'a dir holding save*.hg is watched as-is')
    assert.ok(!dirs.some((d) => d.includes('does-not-exist')), 'missing dirs are dropped')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
