/**
 * Harvests a system name from the save's SaveSummary text ("In the Vadorca
 * system"). Stationless systems have no other name source in a save: only
 * space-station teleport endpoints carry system-shaped names, and discovery
 * records store player-given names only — but the summary line the game
 * writes for the load menu includes the procedural name.
 */

/** "In the Vadorca system" / "Within Rerasmutul system" -> the system name. */
export function systemNameFromSummary(summary: string | null | undefined): string | null {
  if (typeof summary !== 'string') return null
  const match = /^(?:in|within)\s+(?:the\s+)?(.+?)\s+system$/i.exec(summary.trim())
  const name = match?.[1].trim()
  // "In the system" backtracks into capturing the bare article — not a name.
  if (!name || /^the$/i.test(name)) return null
  return name
}

/**
 * SaveSummary can lag a warp behind UniversalAddress (it refreshes only at
 * certain save points), so pairing the two naively could pin the previous
 * system's name on the current address — and in a stationless system nothing
 * would ever correct it. A name is trusted only once the same
 * (address, name) pair has been seen on two distinct save writes: a stale
 * summary next to a fresh address never survives the following save.
 */
export class SummaryNameTracker {
  private pending: { address: string; name: string; mtimeMs: number } | null = null

  /** Feed one location update; returns the system name once confirmed. */
  observe(address: string, summary: string | null, mtimeMs: number): string | null {
    const name = systemNameFromSummary(summary)
    if (!name) return null
    const p = this.pending
    if (p && p.address === address && p.name === name) {
      // Same pair again: confirmed only if it came from a different save
      // write — re-processing one file (slot re-pin, duplicate watcher
      // event) must not let a summary confirm itself.
      return p.mtimeMs !== mtimeMs ? name : null
    }
    this.pending = { address, name, mtimeMs }
    return null
  }
}
