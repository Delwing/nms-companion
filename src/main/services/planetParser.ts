/**
 * Entity parser: turns raw OCR text from planet-info UI (ship approach
 * panel, Discoveries menu card, Analysis Visor) into a structured record.
 * Matching is signature-based: OCR output is noisy and the panels float,
 * so we look for distinctive fragments rather than exact layouts.
 */
import type { ParsedPlanetData } from '@shared/types'
// Relative import (not @shared alias): this is a runtime dependency and the
// tests' tsc build doesn't rewrite path aliases in emitted JS.
import { RESOURCE_SIGNATURES } from '../../shared/resources'
import { ITEM_NAMES } from '../../shared/itemNames'
import { BIOME_ADJECTIVES, STANDALONE_TYPES, TYPE_TAILS } from '../../shared/planetTypes'
import { GALAXY_NAMES } from '../../shared/galaxy'

/** Galaxy names appear beside system names in HUD location lines and the
 *  Discoveries header — never as a planet name. */
const GALAXY_NAME_SET = new Set(GALAXY_NAMES.map((g) => g.toLowerCase()))

/** Sentinel levels, canonicalized from noisy reads like "igh Sentinel Activity". */
const SENTINEL_SIGNATURES: Array<[string, RegExp]> = [
  ['Aggressive', /aggress/i],
  ['Frenzied', /frenzied/i],
  ['Corrupt', /corrupt/i],
  ['High', /h?igh/i],
  ['Low', /\blow\b/i],
  ['Minimal', /minimal|passive|limited/i],
  ['None', /none|absent/i]
]

/** Lines that can never be a planet name. "Unmapped"/"Uncharted" are the
 *  flight-HUD status labels shown right under the target's actual name.
 *  Ship-cockpit gauge labels ("Thermal Load", "Pulse Engine") and this
 *  app's own overlay chrome float in the same frame during ship-view
 *  scans — procedural planet names never contain these English words. */
const NOT_A_NAME =
  /discovered|arrive|sentinel|activity|planet|moon|world|collect|free|buy for|switch|inventory|redeem|donate|report|wonders|mark |return|options|catalogue|discoveries|log\b|visited|system|rename|upload|\bview\b|\bname\b|unmapped|uncharted|nms hud|\bstation\b|thermal|\bload\b|pulse|thruster|hyperdrive|photon|phase beam|rocket|deflector|shield|cannon|launch|charging|\bfuel\b|oxygen|hazard|undiscov|\bpress\b|\bunits\b|nanites|synthesis/i

/** Lowercase alpha-only words — tolerant of OCR punctuation noise. */
const normaliseTypeText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim()

/** Normalised form -> canonical standalone type ("Vermillion Globe"). */
const STANDALONE_BY_NORM = new Map(STANDALONE_TYPES.map((t) => [normaliseTypeText(t), t]))

function extractPlanetType(cleanText: string): string | null {
  const labelled =
    cleanText.match(/(?:Planet|Moon)\s*Type:\s*(.+)/i) ||
    cleanText.match(/\[(.+?\s*(?:Planet|Moon|World))\]/i)
  if (labelled) return labelled[1].trim()

  // Types with no Planet/Moon noun at all ("Vermillion Globe",
  // "Waterworld", "Terraforming Catastrophe") — matched per gap-split
  // segment so merged UI columns don't hide them.
  for (const line of cleanText.split('\n')) {
    for (const segment of line.split(/\s{2,}|\t/)) {
      const standalone = STANDALONE_BY_NORM.get(normaliseTypeText(segment))
      if (standalone) return standalone
    }
  }

  // Panels show the biome as its own line: "Verdant Planet", "Frozen Moon",
  // "Decaying Nuclear Planet", "Life-Incompatible Planet". Title-case
  // (capitals allowed after a hyphen) guards against "3 PLANETS / 1 MOON";
  // trailing junk ("Verdant Planet   ~") is tolerated. Merged UI columns
  // prefix the line with unrelated boxes — icon glyphs even read as digits
  // ("0  0  Icy Planet"), which \W would reject — so each gap-split segment
  // is tested on its own; segments never span lines, so unrelated lines
  // can't stitch together ("Yemont\nParadise Planet"). A match with a
  // known biome word beats an earlier "Unknown Moon": colour-aware OCR
  // also reads the faint orbit labels floating around the card, and those
  // sit above it in reading order.
  const segmentPattern =
    /^\W{0,4}((?:[A-Z](?:[a-z]+|[a-z]*(?:-[A-Za-z][a-z]*)+)[ \t]+){0,3}(?:Planet|Moon))\b[^A-Za-z0-9]*$/
  const lineMatches: string[] = []
  for (const line of cleanText.split('\n')) {
    for (const segment of line.split(/\s{2,}|\t/)) {
      const m = segment.match(segmentPattern)
      if (m) lineMatches.push(m[1].trim())
    }
  }
  const knownBiome = lineMatches.find((t) => {
    const adjective = t.replace(/\s*(?:Planet|Moon)$/i, '').trim().toLowerCase()
    return adjective !== '' && BIOME_ADJECTIVES.some((b) => adjective.startsWith(b.toLowerCase()))
  })
  if (knownBiome) return knownBiome
  if (lineMatches.length > 0) return lineMatches[0]

  // The descriptor can trail the noun: "Planet of Light".
  for (const tail of TYPE_TAILS) {
    const tailPattern = tail.replace(/[^A-Za-z ]/g, '').replace(/ +/g, '[ \\t]+')
    const match = cleanText.match(new RegExp(`\\b(Planet|Moon)[ \\t]+${tailPattern}\\b`, 'i'))
    if (match) {
      const noun = match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
      return `${noun} ${tail}`
    }
  }

  // Recovery pass, gated on the biome vocabulary so it's safe mid-line
  // ("Aton X   Torrid Planet") and on truncated crops ("sonous Planet"
  // with the left edge cut off -> Poisonous). Fragments under 4 letters
  // only count as exact adjectives ("Icy", "Hot") — suffix matching that
  // short would let any "...ted Planet" truncation pick a random biome.
  for (const match of cleanText.matchAll(/([A-Za-z-]{3,})\s+(Planet|Moon)\b/g)) {
    const fragment = match[1].toLowerCase()
    const word = BIOME_ADJECTIVES.find(
      (b) =>
        b.toLowerCase() === fragment ||
        (fragment.length >= 4 && b.toLowerCase().endsWith(fragment))
    )
    if (word) return `${word} ${match[2]}`
  }
  return null
}

/**
 * Safety net for resource rows missing from RESOURCE_SIGNATURES: a
 * gap-split segment that reads exactly as a game item name is a resource
 * row ("# Solanium", "¥ StarBulb"). Normalisation drops everything but
 * letters, so bullet glyphs, lost spaces and stray punctuation don't
 * break the lookup. Min length 5 keeps short common words out.
 */
const normalizeItemText = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, '')

let itemNameIndex: Map<string, string> | null = null
function lookupItemName(segment: string): string | undefined {
  if (!itemNameIndex) {
    itemNameIndex = new Map()
    for (const name of Object.values(ITEM_NAMES)) {
      const key = normalizeItemText(name)
      if (key.length >= 5) itemNameIndex.set(key, name)
    }
  }
  return itemNameIndex.get(normalizeItemText(segment))
}

function extractResources(cleanText: string): string[] {
  const found: string[] = []
  let working = cleanText
  for (const [canonical, signature] of RESOURCE_SIGNATURES) {
    if (signature.test(working)) {
      found.push(canonical)
      working = working.replace(new RegExp(signature.source, 'gi'), '')
    }
  }
  // Curated signatures are consumed above; whatever whole item names are
  // left in the text are resources the list doesn't know yet. ":" guards
  // against cropped credit lines ("scovered by: Silver") naming a player.
  for (const line of working.split('\n')) {
    for (const segment of line.split(/\s{2,}|\t/)) {
      if (segment.includes(':')) continue
      const name = lookupItemName(segment)
      if (name && !found.includes(name)) found.push(name)
    }
  }
  return found
}

function extractSentinels(cleanText: string): string | null {
  const labelled = cleanText.match(/Sentinels:\s*(.+)/i)
  const activity = cleanText.match(/([A-Za-z]+)\s+Sentinel\s+Activity/i)
  const raw = labelled?.[1] ?? activity?.[1]
  if (!raw) return null
  for (const [canonical, signature] of SENTINEL_SIGNATURES) {
    if (signature.test(raw)) return canonical
  }
  return raw.trim()
}

/**
 * UI rows often merge columns into one OCR line ("Fungal Mould    Notr
 * Beta") and list-bullet icons read as stray letters ("O      Aton IX").
 * Big whitespace gaps mark those seams, so candidates are the gap-split
 * segments of a line, not the whole line.
 */
function nameSegments(rawLine: string): string[] {
  return rawLine
    .split(/\s{2,}|\t/)
    .map((s) => s.replace(/\s+/g, ' ').replace(/^\W+|\W+$/g, '').trim())
    .filter(Boolean)
}

/** A resource reading is never a planet name ("Fungal Mould"). */
function isResourceName(text: string): boolean {
  return RESOURCE_SIGNATURES.some(([canonical]) => canonical.toLowerCase() === text.toLowerCase())
}

function looksLikeName(segment: string, strict = false): boolean {
  if (segment.length < (strict ? 4 : 3) || segment.length > 40) return false
  if (segment.includes(':') || NOT_A_NAME.test(segment)) return false
  // "/" appears in designation-style names ("Moga 54/N8").
  if (!/^[A-Z][A-Za-z0-9'/ -]+$/.test(segment)) return false
  if (isResourceName(segment)) return false
  if (GALAXY_NAME_SET.has(segment.toLowerCase())) return false
  // Noun-less type lines ("Waterworld", "Vermillion Globe") read like
  // names but never are one.
  if (STANDALONE_BY_NORM.has(normaliseTypeText(segment))) return false
  // Without a "Discovered by:" anchor, a lone all-caps blob is far more
  // likely OCR noise ("PEE") than a name.
  if (strict && !segment.includes(' ') && segment === segment.toUpperCase()) return false
  // OCR noise makes short fragments ("Cee as"): every word must be a real
  // word (3+ letters), a designation like "W31", or a numeral like "IX".
  const words = segment.split(/\s+/)
  return words.every(
    (word) => word.length >= 3 || /^[A-Z]?\d+$/.test(word) || /^[IVXLCM]+$/i.test(word)
  )
}

/**
 * A left-cropped card leaves only a name tail above the credit line
 * ("nio Beta"). The full name usually appears intact elsewhere in the
 * frame (planet list, right column) — recover it by suffix match.
 */
function recoverFullName(fragment: string, rawLines: string[]): string | undefined {
  const tail = fragment.toLowerCase()
  for (const line of rawLines) {
    for (const segment of nameSegments(line)) {
      if (segment.length <= fragment.length) continue
      if (segment.toLowerCase().endsWith(tail) && looksLikeName(segment)) return segment
    }
  }
  return undefined
}

function extractName(cleanText: string, systemHint?: string): string | undefined {
  const rawLines = cleanText.split('\n')
  // The Discoveries header names the browsed *system* — never the planet.
  const notTheSystem = (s: string): boolean =>
    !systemHint || s.toLowerCase() !== systemHint.toLowerCase()

  // Discoveries card: the name sits directly above "Discovered by: <user>"
  // (or its left-cropped tail "scovered by:"). The system header says
  // "Discovered <time> ago by" — no colon — so the colon still anchors us
  // to the planet card even when both are in frame.
  for (let i = rawLines.length - 1; i >= 0; i--) {
    if (CARD_SIGNATURE.test(rawLines[i])) {
      for (let j = i - 1; j >= 0; j--) {
        const segments = nameSegments(rawLines[j]).filter(notTheSystem)
        const valid = segments.find((s) => looksLikeName(s))
        if (valid) return valid
        // A cropped name tail ("nio Beta") — prefer the intact full name
        // from elsewhere in the frame, fall back to the tail itself.
        // Noun-less type lines ("Waterworld") are never a name tail.
        const crude = segments.find(
          (s) => s.length >= 3 && !STANDALONE_BY_NORM.has(normaliseTypeText(s))
        )
        if (crude) return recoverFullName(crude, rawLines) ?? crude
      }
    }
  }

  for (const line of rawLines) {
    const valid = nameSegments(line)
      .filter(notTheSystem)
      .find((s) => looksLikeName(s, true))
    if (valid) return valid
  }
  return undefined
}

/** UI chrome that can never be the Discoveries header's system name. */
const NOT_A_SYSTEM_HEADER =
  /discover|catalogue|guide|option|planet|moon|\bview\b|rename|upload|wonder|return|\bsystems\b|visited|\ball\b|log\b/i

/**
 * A Discoveries card, tolerant of the left crop edge cutting the word
 * ("Discovered by:" -> "scovered by:").
 */
export const CARD_SIGNATURE = /covered\s+by:/i

/**
 * The Discoveries menu shows the browsed system's name in the header,
 * right under the "DISCOVERIES | CATALOGUE ..." bar ("» Laerib",
 * "Gigantula-System", "udane 9"). Grab the first plausible segment from
 * the top few lines so a card scan can be matched back to its system.
 */
export function extractCardSystemName(rawOcrText: string): string | undefined {
  const text = rawOcrText.replace(/\r\n/g, '\n')
  // On full-frame reads the player's own name sits top-left — the same
  // name the card credits, so the credit line identifies what to reject.
  const discoverer = text
    .match(/covered\s+by:\s*([A-Za-z' -]{3,})/i)?.[1]
    ?.toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

  for (const line of text.split('\n').slice(0, 5)) {
    for (const segment of nameSegments(line)) {
      if (segment.length < 4 || segment.length > 32) continue
      if (segment.includes(':') || NOT_A_SYSTEM_HEADER.test(segment)) continue
      if (!/^[A-Za-z][A-Za-z0-9' -]+$/.test(segment)) continue
      if (isResourceName(segment)) continue
      const norm = segment.toLowerCase()
      if (discoverer && (discoverer.startsWith(norm) || norm.startsWith(discoverer))) continue
      return segment
    }
  }
  return undefined
}

export function parsePlanetData(rawOcrText: string): ParsedPlanetData {
  const cleanText = rawOcrText.replace(/\r\n/g, '\n')
  // Usernames ("Discovered by: Silver") must not pollute resource matching.
  const resourceText = cleanText.replace(/Discovered.*$/gim, '')

  const weatherMatch = cleanText.match(/Weather:\s*(.+)/i)
  const floraMatch = cleanText.match(/Flora:\s*(.+)/i)
  const faunaMatch = cleanText.match(/Fauna:\s*(.+)/i)

  // Hint first: the header's system name must not be mistaken for the planet.
  const systemHint = CARD_SIGNATURE.test(cleanText) ? extractCardSystemName(cleanText) : undefined

  return {
    name: extractName(cleanText, systemHint),
    planetType: extractPlanetType(cleanText) ?? 'Unknown',
    weather: weatherMatch ? weatherMatch[1].trim() : 'Unknown',
    sentinels: extractSentinels(cleanText) ?? 'Unknown',
    flora: floraMatch ? floraMatch[1].trim() : 'Unknown',
    fauna: faunaMatch ? faunaMatch[1].trim() : 'Unknown',
    resources: extractResources(resourceText),
    systemHint
  }
}

/** How many meaningful fields a parse extracted — used to rank OCR passes. */
export function parseScore(data: ParsedPlanetData): number {
  const fields = [data.planetType, data.weather, data.sentinels, data.flora, data.fauna]
  return fields.filter((f) => f !== 'Unknown').length + data.resources.length + (data.name ? 1 : 0)
}
