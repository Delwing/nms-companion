/**
 * Guild inference across regions. Every station in a region (voxel) hosts
 * the same guild, so one envoy scan reveals the guild of every catalogued
 * system sharing that voxel. Inference is derived at display time and never
 * written back to the store — a mis-read scan must not contaminate records.
 */
import type { GuildType, SystemRecord } from './types'
import { regionKey } from './galaxy'

export type KnownGuild = Exclude<GuildType, null>

/**
 * Map of region key -> guild, voted from systems with a scanned guild.
 * Scans should never disagree within a region, but OCR can mis-read: the
 * majority wins, and a tie goes to the most recently updated system.
 */
export function inferRegionGuilds(systems: SystemRecord[]): Map<string, KnownGuild> {
  const votes = new Map<string, Map<KnownGuild, { count: number; latest: string }>>()
  for (const s of systems) {
    // Pirate/stationless systems have no envoy: any guild on them is stale.
    if (s.station !== 'normal') continue
    if (!s.guildType || s.voxelX === null || s.voxelY === null || s.voxelZ === null) continue
    const key = regionKey(s.galaxy, s.voxelX, s.voxelY, s.voxelZ)
    if (!votes.has(key)) votes.set(key, new Map())
    const tally = votes.get(key)!
    const entry = tally.get(s.guildType) ?? { count: 0, latest: '' }
    entry.count++
    if (s.updatedAt > entry.latest) entry.latest = s.updatedAt
    tally.set(s.guildType, entry)
  }

  const result = new Map<string, KnownGuild>()
  for (const [key, tally] of votes) {
    let winner: KnownGuild | null = null
    let best = { count: 0, latest: '' }
    for (const [guild, entry] of tally) {
      if (
        entry.count > best.count ||
        (entry.count === best.count && entry.latest > best.latest)
      ) {
        winner = guild
        best = entry
      }
    }
    if (winner) result.set(key, winner)
  }
  return result
}

/**
 * The guild a system without an envoy scan inherits from its region, or
 * null when the system has one scanned, hosts no envoy (pirate or
 * stationless), lacks coordinates, or the region is unknown.
 */
export function inferredGuildFor(
  system: SystemRecord,
  regionGuilds: Map<string, KnownGuild>
): KnownGuild | null {
  if (system.station !== 'normal') return null
  if (system.guildType || system.voxelX === null || system.voxelY === null || system.voxelZ === null)
    return null
  return regionGuilds.get(regionKey(system.galaxy, system.voxelX, system.voxelY, system.voxelZ)) ?? null
}
