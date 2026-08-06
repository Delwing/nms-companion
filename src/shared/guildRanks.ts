/**
 * Guild standing ladder. All three guilds share the same six ranks, and an
 * envoy's stock list always has one row per rank in ladder order — row i
 * unlocks at rank i. An item's required rank is therefore its position in
 * the scanned list; no per-item table is needed.
 */

export const GUILD_RANKS = [
  'Initiate',
  'Apprentice',
  'Journeyman',
  'Associate',
  'Master',
  'Exalted'
] as const

export type GuildRank = (typeof GUILD_RANKS)[number]

/** Rows every envoy stock list has; fewer captured means dropped OCR rows. */
export const ENVOY_STOCK_ROWS = GUILD_RANKS.length

/**
 * OCR-tolerant rank signatures ("Journeyrnan", "lnitiate"): each matches a
 * fragment garbled reads keep intact.
 */
const RANK_SIGNATURES: Array<[GuildRank, RegExp]> = [
  ['Initiate', /n[il1|]t[il1|]a/i],
  ['Apprentice', /pp?rent/i],
  ['Journeyman', /[jl][o0]urn/i],
  ['Associate', /ss[o0]c/i],
  ['Master', /mast/i],
  ['Exalted', /xa[il1|]t/i]
]

/** Canonical rank for an OCR read, or null when nothing recognisable. */
export function normalizeGuildRank(text: string | null | undefined): GuildRank | null {
  if (!text) return null
  for (const [rank, signature] of RANK_SIGNATURES) {
    if (signature.test(text)) return rank
  }
  return null
}

/** Ladder index of a rank read (0 = Initiate), or null when unrecognised. */
export function rankIndex(text: string | null | undefined): number | null {
  const rank = normalizeGuildRank(text)
  return rank === null ? null : GUILD_RANKS.indexOf(rank)
}

/**
 * Whether the envoy stock row at `index` is locked at the player's current
 * rank. False (never dim on a guess) when the rank is unknown or the list
 * didn't capture every row — a dropped middle row shifts later positions.
 */
export function envoyItemLocked(
  index: number,
  currentRank: string | null | undefined,
  listLength: number
): boolean {
  if (listLength !== ENVOY_STOCK_ROWS) return false
  const rank = rankIndex(currentRank)
  if (rank === null) return false
  return index > rank
}
