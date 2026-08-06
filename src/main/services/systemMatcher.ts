/**
 * Fuzzy matching of catalogued systems against OCR text. Catalogued names
 * mostly come from teleport endpoints, i.e. station names shaped like
 * "<System> Station Tau" / "<System> Terminus" — stripping the station
 * suffix recovers the system name shown in Discoveries/galaxy-map headers.
 */

const STATION_SUFFIX =
  /\s+(?:station|stellar\s+observer|terminus|base|platform|sphere|cycler|crossing|orbital|depot|outpost)\b.*$/i

/** "Leuz Station Tau" -> "Leuz", "The Simaon-Umam IV Sphere" -> "Simaon-Umam IV". */
export function systemBaseName(name: string): string {
  return name.replace(/^the\s+/i, '').replace(STATION_SUFFIX, '').trim()
}

/** Lowercase, collapse anything non-alphanumeric — OCR-noise tolerant. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface NamedSystem {
  universalAddress: string
  name: string
}

/** The store surface relinking needs; CatalogueStore satisfies it. */
export interface HintLinkStore {
  listSystems(): NamedSystem[]
  listPlanets(): { id: number; systemAddress: string | null; systemHint: string | null }[]
  setPlanetSystem(id: number, systemAddress: string | null): unknown
}

/**
 * Planets scanned before their system was catalogued keep the card-header
 * text as a hint. Once new systems arrive (save sync), retry those hints
 * so the planets get tied to their system retroactively.
 */
export function relinkPlanetsByHint(store: HintLinkStore): number {
  const systems = store.listSystems()
  if (systems.length === 0) return 0
  let linked = 0
  for (const planet of store.listPlanets()) {
    if (planet.systemAddress || !planet.systemHint) continue
    const match = matchSystemInText(systems, planet.systemHint)
    if (match) {
      store.setPlanetSystem(planet.id, match.universalAddress)
      linked++
    }
  }
  return linked
}

/** The base fields card matching needs; BaseRecord satisfies it. */
export interface NamedBase {
  systemAddress: string
  planetIndex: number | null
  name: string
}

/** Auto-generated base names carry no location information. */
const GENERIC_BASE_NAMES = new Set(['unnamed base', 'freighter base', 'base', 'settlement'])

/**
 * Find a catalogued base whose name appears in a planet card's text. The
 * Discoveries card lists the bases built on that planet, so a hit pins the
 * scan to the base's exact system AND planet index — stronger evidence than
 * the stylized (often garbled) header. Longest name wins.
 */
export function matchBaseInText<T extends NamedBase>(bases: T[], text: string): T | null {
  const haystack = ` ${normalize(text)} `
  let best: T | null = null
  let bestLen = 0
  for (const base of bases) {
    if (base.planetIndex === null) continue // freighter bases have no planet
    const candidate = normalize(base.name)
    if (candidate.length < 6 || candidate.length <= bestLen) continue
    if (GENERIC_BASE_NAMES.has(candidate)) continue
    if (haystack.includes(` ${candidate} `)) {
      best = base
      bestLen = candidate.length
    }
  }
  return best
}

/**
 * Rows a named scan may claim instead of creating a new planet: save-import
 * "Planet N" stubs, and nameless OCR scans ("Uncharted Planet") whose name
 * never got read — a later named scan of the same system is the best chance
 * to identify them.
 */
export function isClaimablePlanet(p: { source: string; type: string; name: string }): boolean {
  return (
    (p.source === 'save' && p.type === 'Unknown' && /^Planet \d+$/.test(p.name)) ||
    p.name === 'Uncharted Planet'
  )
}

export interface SlotCandidate {
  id: number
  planetIndex: number | null
}

/**
 * Pick which claimable row a named scan should absorb. A base seen on the
 * card names the exact slot — never a stranger's. A card that showed no
 * base skips slots holding a buildable base; settlements never appear on
 * Discoveries cards, so their slots stay eligible. Otherwise the lowest
 * indexed row is claimed.
 */
export function choosePlaceholderSlot(
  candidates: SlotCandidate[],
  bases: { planetIndex: number | null; baseType: string }[],
  pinnedIndex: number | null,
  cardBases: number | null
): number | null {
  if (pinnedIndex !== null) {
    return candidates.find((c) => c.planetIndex === pinnedIndex)?.id ?? null
  }
  const byIndex = [...candidates].sort(
    (a, b) =>
      (a.planetIndex ?? Number.MAX_SAFE_INTEGER) - (b.planetIndex ?? Number.MAX_SAFE_INTEGER)
  )
  if (cardBases === 0) {
    const withBase = new Set(
      bases
        .filter((b) => b.planetIndex !== null && b.baseType !== 'Settlement')
        .map((b) => b.planetIndex)
    )
    const clear = byIndex.find((c) => !withBase.has(c.planetIndex))
    if (clear) return clear.id
  }
  return byIndex[0]?.id ?? null
}

/** The planet fields the merge planner inspects; PlanetRecord satisfies it. */
export interface PlanetSlotRow {
  id: number
  systemAddress: string | null
  name: string
  planetIndex: number | null
  source: 'ocr' | 'save'
  type: string
  scannedAt: string
  /** Known bases seen on the scan's card: 0 = card showed none, null = unknown. */
  cardBases?: number | null
}

export interface PlaceholderMerge {
  /** OCR planet that survives and claims the slot's planet index. */
  keepId: number
  /** Save-import "Planet N" placeholder to delete. */
  dropId: number
  planetIndex: number
}

/**
 * A save sync imports discovery records as "Planet N" placeholders keyed by
 * planet index, while OCR scans carry no index — so a scanned planet and its
 * own placeholder can coexist in one system. Pair unscanned placeholders
 * (lowest index first) with unindexed OCR planets (oldest scan first): each
 * merge keeps the scanned data, claims the slot's index and drops the stub.
 * Which index belongs to which scan can't be known, same as the slot-filling
 * in insertPlanet — except bases narrow it down: a scan whose card showed no
 * base (cardBases === 0) can't own a base-bearing index, so those slots are
 * skipped for it. Base-anchored planets keep their bases correct even though
 * the remaining pairing stays a guess. Settlements never appear on
 * Discoveries cards, so their slots stay eligible for no-base scans.
 */
export function planPlaceholderMerges(
  planets: PlanetSlotRow[],
  bases: { systemAddress: string; planetIndex: number | null; baseType?: string }[] = []
): PlaceholderMerge[] {
  const baseIndexes = new Map<string, Set<number>>()
  for (const b of bases) {
    if (b.planetIndex === null || b.baseType === 'Settlement') continue
    const set = baseIndexes.get(b.systemAddress) ?? new Set()
    set.add(b.planetIndex)
    baseIndexes.set(b.systemAddress, set)
  }
  const bySystem = new Map<string, PlanetSlotRow[]>()
  for (const p of planets) {
    if (!p.systemAddress) continue
    const rows = bySystem.get(p.systemAddress)
    if (rows) rows.push(p)
    else bySystem.set(p.systemAddress, [p])
  }
  const merges: PlaceholderMerge[] = []
  for (const [address, rows] of bySystem) {
    const placeholders = rows
      .filter(
        (p) =>
          p.source === 'save' &&
          p.type === 'Unknown' &&
          p.planetIndex !== null &&
          /^Planet \d+$/.test(p.name)
      )
      .sort((a, b) => (a.planetIndex ?? 0) - (b.planetIndex ?? 0))
    const scans = rows
      .filter((p) => p.source === 'ocr' && p.planetIndex === null)
      .sort((a, b) => a.scannedAt.localeCompare(b.scannedAt) || a.id - b.id)
    const withBase = baseIndexes.get(address)
    const taken = new Set<number>()
    for (const scan of scans) {
      const slot = placeholders.find(
        (p) =>
          !taken.has(p.id) &&
          !(scan.cardBases === 0 && withBase?.has(p.planetIndex ?? 0))
      )
      if (!slot) continue
      taken.add(slot.id)
      merges.push({
        keepId: scan.id,
        dropId: slot.id,
        planetIndex: slot.planetIndex ?? 0
      })
    }
  }
  return merges
}

/**
 * Find the catalogued system whose name (or station-suffix-stripped base
 * name) appears in `text`. Longest match wins so "UDANE I" can't shadow
 * a longer sibling like "udane 9".
 */
export function matchSystemInText<T extends NamedSystem>(systems: T[], text: string): T | null {
  const haystack = ` ${normalize(text)} `
  let best: T | null = null
  let bestLen = 0
  for (const system of systems) {
    if (!system.name || system.name === 'Unknown System') continue
    const candidates = new Set([normalize(system.name), normalize(systemBaseName(system.name))])
    for (const candidate of candidates) {
      if (candidate.length < 4 || candidate.length <= bestLen) continue
      if (haystack.includes(` ${candidate} `)) {
        best = system
        bestLen = candidate.length
      } else if (new RegExp(` [a-z0-9]?${candidate.slice(1)} `).test(haystack)) {
        // Big stylized headers often lose or garble their first capital to
        // OCR ("Leuz" -> "euz", "Iuchae" -> "luchae"); a hit with the first
        // character dropped or swapped counts, scored one shorter. Normalized
        // candidates are [a-z0-9 ] only, so no regex escaping is needed.
        best = system
        bestLen = candidate.length - 1
      }
    }
  }
  return best
}
