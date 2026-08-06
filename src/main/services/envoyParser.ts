/**
 * Entity parser for the station Guild Envoy screen: guild type, envoy name,
 * rank and the offered item list (e.g. Salvaged Frigate Module).
 */
import type { EnvoyData, GuildType } from '@shared/types'

const GUILD_RE = /(Mercenaries|Merchants|Explorers)['’]?s?\s+Guild/i
const ENVOY_RE = /Envoy\s+([A-Za-z][A-Za-z' -]*?)\s+of\s+the\s+(Mercenaries|Merchants|Explorers)/i
const RANK_RE = /Rank:\s*([A-Za-z]+)/i

/** Segments of the item list that are UI chrome, not item names. */
const NOT_AN_ITEM =
  /status required|buy for|collect|\bfree\b|suppl|redeem|donate|all\s*.?tems|exosuit|inventory|switch|envoy|guild|rank|^\W|^\d|^[\d\s/|]+$/i

/**
 * Known envoy offerings as [canonical name, OCR-tolerant signature].
 * Signatures match a distinctive fragment so garbled reads like
 * "Jl on Battery" still resolve to the right item.
 */
const ITEM_SIGNATURES: Array<[string, RegExp]> = [
  ['Salvaged Frigate Module', /frigate/i],
  ['Ion Battery', /[o0]n\s*battery/i],
  // "Ionised" often reads as "lonised"; "Cobalt" truncates to "Cobal".
  ['Ionised Cobalt', /[il1|]onised\W{0,3}cobal/i],
  ['Warp Hypercore', /hypercore/i],
  ['Projectile Ammunition', /ammunition/i],
  ['Unstable Plasma', /plasma/i],
  ['Pugneum', /pugneum/i],
  ['Sentinel Boundary Map', /boundary\s*map/i],
  ['Infra-Knife Module', /infra[\s-]*knife/i],
  ['Toxic Protection Module', /toxic\s*protection/i],
  ['Underwater Protection Module', /underwater\s*protection/i],
  ['Thermic Protection Module', /thermic\s*protection/i],
  ['Radiation Protection Module', /radiation\s*protection/i],
  ['Exosuit Expansion Unit', /expansion\s*unit/i],
  ['Scanner Module', /scanner\s*module/i],
  ['Oxygen', /^\W{0,3}oxygen\b/im],
  ['Life Support Gel', /support\s*gel/i],
  ['Starship Launch Fuel', /launch\s*fuel/i],
  ['Antimatter Housing', /antimatter\s*housing/i],
  ['Hermetic Seal', /hermetic/i],
  ['Metal Plating', /metal\s*plating/i],
  ['Di-hydrogen Jelly', /jelly/i],
  ['Artifact Chart', /artifact\s*chart/i],
  ['Mining Beam Module', /mining\s*beam/i],
  ['Anomaly Detector', /anomaly/i],
  ['Navigation Data', /navigation/i],
  ['AtlasPass', /atlas\s*pass/i],
  ['Hadal Core', /hadal/i]
]

export function isEnvoyScreen(...texts: string[]): boolean {
  const joined = texts.join('\n')
  return ENVOY_RE.test(joined) || /Guild\s+Envoy/i.test(joined) || GUILD_RE.test(joined)
}

function normalizeGuild(match: string | undefined): GuildType {
  if (!match) return null
  const g = match.toLowerCase()
  if (g.startsWith('mercen')) return 'Mercenaries'
  if (g.startsWith('merch')) return 'Merchants'
  if (g.startsWith('expl')) return 'Explorers'
  return null
}

/**
 * Item names sit in the left column of each row; OCR merges the row into one
 * line ("Pugneum    Buy for 98"), so split on the big whitespace gap first.
 *
 * The returned order mirrors the screen: rows are walked top-to-bottom and
 * dedup keeps the first occurrence. That order is load-bearing — stock row i
 * unlocks at guild rank i (see guildRanks.ts). The Tesseract dual-threshold
 * join stays ordered too: locked rows are dimmer AND later in the list, so
 * dim-pass-only items land after every bright-pass item.
 */
function extractItems(itemsText: string): string[] {
  const items: string[] = []
  const push = (name: string): void => {
    if (!items.some((i) => i.toLowerCase() === name.toLowerCase())) items.push(name)
  }

  for (const rawLine of itemsText.split('\n')) {
    // Signature match against the whole row first: canonical names survive
    // garbled reads ("Jl on Battery"), and a row holds only one item.
    const signatureHit = ITEM_SIGNATURES.find(([, signature]) => signature.test(rawLine))
    if (signatureHit) {
      push(signatureHit[0])
      continue
    }

    for (const segment of rawLine.split(/\s{2,}|\t/)) {
      // OCR leaves junk fragments around real names ("owe Warp Hypercore",
      // "Underwater Protection Module gy") — trim words that can't belong.
      const words = segment.replace(/\s+/g, ' ').trim().split(' ')
      while (words.length && !/^[A-Z][A-Za-z'-]{2,}$/.test(words[0])) words.shift()
      while (
        words.length &&
        !/^([A-Za-z'-]{3,}|of|\d+|[A-Z]\d+|[Vv]\d+)$/.test(words[words.length - 1])
      ) {
        words.pop()
      }
      const text = words.join(' ')

      if (text.length < 4 || text.length > 40) continue
      if (NOT_AN_ITEM.test(text)) continue
      if (!/^[A-Z][A-Za-z' -]+$/.test(text)) continue
      // Whitespace-collapsed cleanup can reveal a signature the raw row
      // hid — record the canonical name in this row's position.
      const cleanedHit = ITEM_SIGNATURES.find(([, sig]) => sig.test(text))
      if (cleanedHit) {
        push(cleanedHit[0])
        continue
      }
      // Partial re-reads of an item already found ("Battery" from
      // "Ion Battery", "Module" from "... Module") are not new items.
      if (items.some((i) => new RegExp(`\\b${text}\\b`, 'i').test(i))) continue
      push(text)
    }
  }
  return items
}

export function parseEnvoyData(bannerText: string, itemsText: string): EnvoyData {
  const joined = `${bannerText}\n${itemsText}`
  const envoyMatch = joined.match(ENVOY_RE)
  const guildMatch = envoyMatch?.[2] ?? joined.match(GUILD_RE)?.[1]
  const items = extractItems(itemsText)

  return {
    guild: normalizeGuild(guildMatch),
    envoyName: envoyMatch ? envoyMatch[1].trim() : null,
    guildRank: joined.match(RANK_RE)?.[1] ?? null,
    items,
    offersSfm: /Salvaged\s+Frigate\s+Module/i.test(joined)
  }
}
