/**
 * Where No Man's Sky keeps its saves, per platform.
 *
 * Windows: %APPDATA%\HelloGames\NMS\{st_*, DefaultUser}\save*.hg for Steam and
 * GOG, plus the Game Pass tree under %LOCALAPPDATA%\Packages.
 *
 * Linux: the game only runs under Proton, so the same Windows-side AppData tree
 * lives inside the compatibility prefix Steam creates per app id. Everything
 * below the prefix — profile folder names, file names, the .hg format itself —
 * is byte-for-byte what the Windows build writes, so only the path differs.
 * There is no Game Pass equivalent.
 *
 * Anything we can't guess (Heroic, Lutris, a hand-rolled WINEPREFIX) is reached
 * through the config.json "saveDirs" override.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs'
import { homedir } from 'os'
import { join, posix } from 'path'
import { findSaveFiles } from './saveSlots'

/** Steam's app id for No Man's Sky — it names the Proton prefix. */
export const NMS_APP_ID = '275850'

/** The per-account folders the Steam/GOG builds create inside HelloGames\NMS. */
function isProfileDir(name: string): boolean {
  return name.startsWith('st_') || name === 'DefaultUser'
}

function safeSubdirs(dir: string, predicate: (name: string) => boolean): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && predicate(e.name))
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/** Resolved path, or null when the entry doesn't exist (or is a dead symlink). */
function realPath(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

function windowsSaveDirs(): string[] {
  const dirs: string[] = []

  const appData = process.env.APPDATA
  if (appData) {
    const nmsRoot = join(appData, 'HelloGames', 'NMS')
    if (existsSync(nmsRoot)) dirs.push(...safeSubdirs(nmsRoot, isProfileDir))
  }

  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    const packages = join(localAppData, 'Packages')
    for (const pkg of safeSubdirs(packages, (n) => n.startsWith('HelloGames.NoMansSky'))) {
      const xgs = join(pkg, 'SystemAppData', 'xgs')
      dirs.push(...safeSubdirs(xgs, () => true))
    }
  }

  return dirs
}

/**
 * Every place a Steam install might live. `.steam/steam` and `.steam/root` are
 * usually symlinks into one of the others, so callers must resolve and dedupe;
 * the flatpak build gets its own sandboxed data dir.
 */
export function steamRootCandidates(home: string, xdgDataHome?: string): string[] {
  const roots: string[] = []
  if (xdgDataHome) roots.push(posix.join(xdgDataHome, 'Steam'))
  roots.push(
    posix.join(home, '.steam', 'steam'),
    posix.join(home, '.steam', 'root'),
    posix.join(home, '.local', 'share', 'Steam'),
    posix.join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam')
  )
  return roots
}

/**
 * Library paths out of steamapps/libraryfolders.vdf — games (and their Proton
 * prefixes) can sit on a different drive from the Steam install. The current
 * format nests a "path" key per library; the pre-2021 one put the path directly
 * under a numeric key, which is why bare digits are accepted too. That also
 * matches the app-id/size pairs in the modern "apps" block, so values that
 * aren't absolute paths are dropped.
 */
export function parseLibraryFolders(vdf: string): string[] {
  const out: string[] = []
  for (const match of vdf.matchAll(/"(?:path|\d+)"\s+"([^"]+)"/g)) {
    const value = match[1]
    if (/^([A-Za-z]:)?[\\/]/.test(value)) out.push(value)
  }
  return out
}

/**
 * The Windows-side user profiles inside NMS's Proton prefix for one Steam
 * library. Current Proton always creates the account as "steamuser", older
 * prefixes used the real login name, so callers enumerate whatever is there.
 */
export function protonUsersDir(libraryRoot: string): string {
  return posix.join(libraryRoot, 'steamapps', 'compatdata', NMS_APP_ID, 'pfx', 'drive_c', 'users')
}

function linuxSaveDirs(): string[] {
  const home = homedir()
  if (!home) return []

  const libraries = new Set<string>()
  for (const candidate of steamRootCandidates(home, process.env.XDG_DATA_HOME)) {
    const root = realPath(candidate)
    if (!root) continue
    libraries.add(root)
    try {
      const vdf = readFileSync(join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')
      for (const library of parseLibraryFolders(vdf)) {
        const resolved = realPath(library)
        if (resolved) libraries.add(resolved)
      }
    } catch {
      // No library index — this root is a library in its own right.
    }
  }

  const dirs: string[] = []
  for (const library of libraries) {
    for (const user of safeSubdirs(protonUsersDir(library), () => true)) {
      const nmsRoot = join(user, 'AppData', 'Roaming', 'HelloGames', 'NMS')
      if (existsSync(nmsRoot)) dirs.push(...safeSubdirs(nmsRoot, isProfileDir))
    }
  }
  return dirs
}

/**
 * Expand one config.json "saveDirs" entry. The user may reasonably point at a
 * profile folder holding save*.hg, at the NMS root holding those folders, or at
 * a prefix's AppData\Roaming — accept all three. A directory that matches none
 * of them is still watched: it may be a save location that has yet to be
 * written, and the user asked for it explicitly.
 */
function expandExtraDir(dir: string): string[] {
  if (!existsSync(dir)) return []
  if (findSaveFiles(dir).length > 0) return [dir]
  const nested = join(dir, 'HelloGames', 'NMS')
  const root = existsSync(nested) ? nested : dir
  const profiles = safeSubdirs(root, isProfileDir)
  return profiles.length > 0 ? profiles : [root]
}

/**
 * Every directory worth watching for saves. `extraDirs` comes from config.json
 * and is searched in addition to — not instead of — the platform defaults.
 */
export function locateSaveDirs(extraDirs: string[] = []): string[] {
  const found = process.platform === 'win32' ? windowsSaveDirs() : linuxSaveDirs()
  for (const dir of extraDirs) found.push(...expandExtraDir(dir))
  return [...new Set(found)]
}

/** What to tell the user when nothing turned up — the paths differ per OS. */
export function noSaveDirMessage(): string {
  if (process.platform === 'win32') {
    return 'No NMS save directory found under %APPDATA%\\HelloGames\\NMS'
  }
  return (
    'No NMS save directory found in any Steam library ' +
    `(steamapps/compatdata/${NMS_APP_ID}/pfx). If the game runs outside Steam, ` +
    'add its save folder to "saveDirs" in config.json.'
  )
}
