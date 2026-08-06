/**
 * Entity parser for system-info screens: the galaxy-map hover panel and the
 * Discoveries-menu system overview both show dominant lifeform, economy
 * (type + strength, with an Economy Scanner) and conflict level. Matching is
 * signature-based like the other parsers — panels vary and OCR is noisy.
 */
import type { SystemInfoData } from '@shared/types'

const RACES: Array<[string, RegExp]> = [
  ['Gek', /\bgek\b/i],
  ['Korvax', /\bkorvax\b/i],
  ["Vy'keen", /\bvy[':’]?\s?keen\b/i],
  ['Uncharted', /\buncharted\b/i],
  ['Abandoned', /\babandoned\b/i]
]

/** Economy type descriptors (wiki-canonical set, one regex per family). */
const ECONOMY_TYPES: Array<[string, RegExp]> = [
  ['Advanced Materials', /advanced\s+materials/i],
  ['Alchemical', /alchemical/i],
  ['Metal Processing', /metal\s+processing/i],
  ['Ore Extraction', /ore\s+extraction/i],
  ['Ore Processing', /ore\s+processing/i],
  ['Mining', /\bmining\b/i],
  ['Prospecting', /prospecting/i],
  ['Minerals', /\bminerals\b/i],
  ['Mathematical', /mathematical/i],
  ['Scientific', /scientific/i],
  ['Research', /\bresearch\b/i],
  ['Experimental', /experimental/i],
  ['Manufacturing', /manufacturing/i],
  ['Construction', /nano-?construction|construction/i],
  ['Industrial', /industrial/i],
  ['Mass Production', /mass\s+production/i],
  ['Engineering', /engineering/i],
  ['High Tech', /high\s+tech/i],
  ['Technology', /technology/i],
  ['Mercantile', /mercantile/i],
  ['Trading', /trading/i],
  ['Commercial', /commercial/i],
  ['Shipping', /shipping/i],
  ['Power Generation', /power\s+generation/i],
  ['Energy Supply', /energy\s+supply/i],
  ['Fuel Generation', /fuel\s+generation/i]
]

/** Economy strength descriptors, weakest to wealthiest. */
const ECONOMY_STRENGTHS: Array<[string, RegExp]> = [
  ['Low Supply', /low\s+supply/i],
  ['Medium Supply', /medium\s+supply/i],
  ['High Supply', /high\s+supply/i],
  ['Declining', /declining/i],
  ['Destitute', /destitute/i],
  ['Failing', /failing/i],
  ['Fledgling', /fledgling/i],
  ['Struggling', /struggling/i],
  ['Unpromising', /unpromising/i],
  ['Unsuccessful', /unsuccessful/i],
  ['Adequate', /adequate/i],
  ['Balanced', /balanced/i],
  ['Comfortable', /comfortable/i],
  ['Developing', /developing/i],
  ['Promising', /\bpromising/i],
  ['Satisfactory', /satisfactory/i],
  ['Sustainable', /sustainable/i],
  ['Advanced', /\badvanced\b(?!\s+materials)/i],
  ['Affluent', /affluent/i],
  ['Booming', /booming/i],
  ['Flourishing', /flourishing/i],
  ['Opulent', /opulent/i],
  ['Prosperous', /prosperous/i],
  ['Wealthy', /wealthy/i]
]

/** Conflict descriptors mapped onto the three in-game tiers. */
const CONFLICTS: Array<[string, RegExp]> = [
  ['Low', /gentle|mild|peaceful|relaxed|stable|tranquil|untroubled|\blow\s+conflict|conflict:?\s*low/i],
  [
    'Medium',
    /alarming|boisterous|sporadic|testy|unpredictable|unruly|unstable|medium\s+conflict|conflict:?\s*medium/i
  ],
  [
    'High',
    /aggressive|at\s+war|belligerent|critical|dangerous|lawless|perilous|violent|high\s+conflict|conflict:?\s*high/i
  ]
]

function firstMatch(text: string, signatures: Array<[string, RegExp]>): string | null {
  for (const [canonical, signature] of signatures) {
    if (signature.test(text)) return canonical
  }
  return null
}

/** Lines that can never be a system name. */
const NOT_A_SYSTEM_NAME =
  /economy|conflict|lifeform|race|discovered|planet|moon|system|scanner|warp|waypoint|distance|light\s*year|star|class|spectral|interference|water|faction|dominant/i

/**
 * Best-effort system name: the header line sitting above the race line
 * (galaxy-map hover) or the first plausible standalone name line.
 */
function extractSystemName(cleanText: string): string | null {
  const lines = cleanText.split('\n').map((l) => l.replace(/\s+/g, ' ').trim())
  const raceLine = lines.findIndex((l) => RACES.some(([, sig]) => sig.test(l)))
  const searchable = raceLine > 0 ? lines.slice(0, raceLine).reverse() : lines
  for (const line of searchable) {
    if (line.length < 4 || line.length > 32) continue
    if (line.includes(':') || NOT_A_SYSTEM_NAME.test(line)) continue
    if (!/^[A-Z][A-Za-z0-9' -]+$/.test(line)) continue
    const words = line.split(' ')
    if (!words.every((w) => w.length >= 3 || /^[A-Z]?\d+$/.test(w))) continue
    return line
  }
  return null
}

export interface SystemInfoParse extends SystemInfoData {
  /** How many of race/economy/conflict were recognised. */
  score: number
}

export function parseSystemInfo(rawOcrText: string): SystemInfoParse {
  const cleanText = rawOcrText.replace(/\r\n/g, '\n')

  const race = firstMatch(cleanText, RACES)
  const economyType = firstMatch(cleanText, ECONOMY_TYPES)
  const economyStrength = firstMatch(cleanText, ECONOMY_STRENGTHS)
  const economy = economyType
    ? economyStrength
      ? `${economyType} · ${economyStrength}`
      : economyType
    : null
  const conflict = firstMatch(cleanText, CONFLICTS)

  return {
    systemName: extractSystemName(cleanText),
    race,
    economy,
    conflict,
    score: (race ? 1 : 0) + (economy ? 1 : 0) + (conflict ? 1 : 0)
  }
}

/**
 * True when the text reads like a system-info panel rather than a planet
 * panel: at least two of race/economy/conflict recognised, and none of the
 * planet-only field labels present.
 */
export function isSystemInfoScreen(parse: SystemInfoParse, rawOcrText: string): boolean {
  if (parse.score < 2) return false
  return !/Weather:|Flora:|Fauna:|Sentinels:/i.test(rawOcrText)
}
