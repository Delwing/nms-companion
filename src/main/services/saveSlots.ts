/**
 * Save-slot identity: collapse a save file path into its character slot.
 * The auto and manual saves of one character form a pair. Game Pass names
 * the pair in the directory (Slot2Auto/Slot2Manual); Steam/GOG interleave
 * files per slot — save.hg+save2.hg is slot 1, save3+save4 slot 2, and so
 * on. The profile directory is part of the id so slots from different
 * accounts never merge.
 */
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export function slotIdentity(savePath: string): { id: string; label: string } | null {
  const normalized = savePath.replace(/\\/g, '/')
  const gp = normalized.match(/\/xgs\/([^/]+)\/Slot(\d+)(?:Auto|Manual)\/data$/i)
  if (gp) return { id: `${gp[1]}/Slot${gp[2]}`, label: `Slot ${gp[2]}` }
  const hg = normalized.match(/\/([^/]+)\/save(\d*)\.hg$/i)
  if (hg) {
    const n = hg[2] ? parseInt(hg[2], 10) : 1
    const slot = Math.ceil(n / 2)
    return { id: `${hg[1]}/Slot${slot}`, label: `Slot ${slot}` }
  }
  return null
}

/** Filesystem-safe encoding of a slot id, for per-slot store filenames. */
export function encodeSlotId(slotId: string): string {
  return slotId.replace(/[^A-Za-z0-9_-]+/g, '-')
}

/** Save files directly inside one profile/user dir (both platform layouts). */
export function findSaveFiles(dir: string): string[] {
  const out: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^save\d*\.hg$/i.test(entry.name)) {
        out.push(join(dir, entry.name))
      } else if (entry.isDirectory() && /^Slot\d+(Auto|Manual)$/i.test(entry.name)) {
        const data = join(dir, entry.name, 'data')
        if (existsSync(data)) out.push(data)
      }
    }
  } catch {
    /* unreadable dir */
  }
  return out
}

/**
 * The most recently written slot across the given save dirs — i.e. the
 * character being played right now (the game writes its save every few
 * minutes), or the last one played when the game is closed.
 */
export function newestSlotOnDisk(dirs: string[]): string | null {
  let best: string | null = null
  let bestMtime = -1
  for (const dir of dirs) {
    for (const file of findSaveFiles(dir)) {
      const id = slotIdentity(file)?.id
      if (!id) continue
      let mtimeMs = 0
      try {
        mtimeMs = statSync(file).mtimeMs
      } catch {
        continue
      }
      if (mtimeMs > bestMtime) {
        bestMtime = mtimeMs
        best = id
      }
    }
  }
  return best
}
