/**
 * Parses a decompressed No Man's Sky save into system records:
 * teleporter endpoints (named stations/bases) and discovery-manager
 * solar-system records, keyed by a canonical universal-address string.
 */
import type {
  FreighterBattleState,
  FrigateRecord,
  FrigateType,
  LanguageProgressRecord,
  ShipArchetype,
  ShipRecord
} from '@shared/types'
// Relative imports (not @shared alias): runtime dependencies; the tests' tsc
// build doesn't rewrite path aliases in emitted JS.
import { GALAXY_NAMES } from '../../shared/galaxy'
import {
  LANGUAGE_TOTALS,
  MULTI_WORD_GROUPS,
  RACE_LANGUAGES,
  type LanguageName
} from '../../shared/languageWords'
import { decompressNmsSave, decompressRawLz4, isNmsCompressedSave } from './lz4'

export interface ParsedSystem {
  universalAddress: string
  name: string
  galaxy: string | null
  voxelX: number | null
  voxelY: number | null
  voxelZ: number | null
  solarSystemIndex: number | null
  /** Handle of the player credited with the system discovery, if recorded. */
  discoveredBy: string | null
  /** ISO date of that discovery, if recorded. */
  discoveredAt: string | null
}

function galaxyName(realityIndex: number | null): string | null {
  if (realityIndex === null || realityIndex < 0) return null
  return GALAXY_NAMES[realityIndex] ?? `Galaxy #${realityIndex + 1}`
}

/** Sign-extend a value of `bits` width. */
function signed(value: number, bits: number): number {
  const shift = 32 - bits
  return (value << shift) >> shift
}

/**
 * Decode a packed universal address (GcUniverseAddressData, 56 bits):
 * "0xPSSSGGYYZZZXXX" — planet (1 hex digit), solar-system index (3),
 * galaxy/reality (2), voxel Y (2), Z (3), X (3). Layout verified against
 * a real save by matching teleport endpoints' explicit voxel fields to
 * their discovery-record UAs.
 */
export function decodeHexAddress(ua: string): {
  voxelX: number
  voxelY: number
  voxelZ: number
  solarSystemIndex: number
  planetIndex: number
  realityIndex: number
} | null {
  let hex = ua.replace(/^0x/i, '').padStart(14, '0')
  if (hex.length > 14) hex = hex.slice(-14)
  if (!/^[0-9a-fA-F]{14}$/.test(hex)) return null
  return {
    planetIndex: parseInt(hex.slice(0, 1), 16),
    solarSystemIndex: parseInt(hex.slice(1, 4), 16),
    realityIndex: parseInt(hex.slice(4, 6), 16),
    voxelY: signed(parseInt(hex.slice(6, 8), 16), 8),
    voxelZ: signed(parseInt(hex.slice(8, 11), 16), 12),
    voxelX: signed(parseInt(hex.slice(11, 14), 16), 12)
  }
}

function canonicalAddress(
  reality: number | null,
  voxelX: number | null,
  voxelY: number | null,
  voxelZ: number | null,
  ssi: number | null
): string {
  return `R${reality ?? 0}:${voxelX ?? 0}:${voxelY ?? 0}:${voxelZ ?? 0}:${ssi ?? 0}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

/**
 * Obfuscated -> readable key mapping for modern NMS saves, reverse-engineered
 * from a real Game Pass save (obfuscated keys are stable per field name).
 * A user-supplied nms-keymap.json is merged over these defaults.
 */
export const DEFAULT_KEY_MAPPING: Record<string, string> = {
  vLc: 'BaseContext',
  '6f=': 'PlayerStateData',
  nlG: 'TeleportEndpoints',
  yhJ: 'UniversalAddress',
  Iis: 'RealityIndex',
  oZw: 'GalacticAddress',
  dZj: 'VoxelX',
  IyE: 'VoxelY',
  uXE: 'VoxelZ',
  vby: 'SolarSystemIndex',
  jsv: 'PlanetIndex',
  iAF: 'TeleporterType',
  NKm: 'Name',
  fDu: 'DiscoveryManagerData',
  ETO: 'DiscoveryData-v1',
  OsQ: 'Store',
  '?fB': 'Record',
  '8P3': 'DD',
  '5L6': 'UA',
  '<Dn': 'DT',
  // Discovery-record flags block (community name "FL"): H = hidden — set on
  // records the game caches from the network for systems the player never
  // visited (verified against a real save: every teleporter-confirmed visited
  // system lacks H; all foreign planetless records carry it). C = confirmed.
  '=wD': 'FL',
  bLr: 'C',
  tiH: 'H',
  // Discovery-record metadata block holding the player-given custom name —
  // verified against a real save: q5u values match the system names on the
  // corresponding station teleporter endpoints (e.g. "udane 9" ↔ "udane 9
  // Station Minor").
  q9a: 'DM',
  q5u: 'CN',
  // Discovery-record ownership block (community names): who discovered it,
  // on which platform, when. Verified against a real save — USN values are
  // player handles and TS timestamps match the discovery dates shown in-game.
  ksu: 'OWS',
  f5Q: 'LID',
  K7E: 'UID',
  'V?:': 'USN',
  D6b: 'PTK',
  '3I1': 'TS',
  'n:R': 'SaveSummary',
  'F?0': 'PersistentPlayerBases',
  peI: 'BaseType',
  DPp: 'PersistentBaseTypes',
  '@ZJ': 'Objects',
  // Inventory containers and slot fields, mapped by probing a real Game Pass
  // save: the ten BLD_STORAGE_NAME containers appear in Chest1..10 save
  // order; ship/vehicle/multitool arrays were identified by their scene
  // filenames and slot contents.
  ';l5': 'Inventory',
  PMT: 'Inventory_TechOnly',
  gan: 'Inventory_Cargo',
  Kgt: 'WeaponInventory',
  SuJ: 'Multitools',
  '@Cs': 'ShipOwnership',
  '>lr': 'VehicleOwnership',
  '8ZP': 'FreighterInventory',
  '0wS': 'FreighterInventory_TechOnly',
  FdP: 'FreighterInventory_Cargo',
  '3Nc': 'Chest1Inventory',
  IDc: 'Chest2Inventory',
  'M=:': 'Chest3Inventory',
  iYp: 'Chest4Inventory',
  '<IP': 'Chest5Inventory',
  qYJ: 'Chest6Inventory',
  '@e5': 'Chest7Inventory',
  '5uh': 'Chest8Inventory',
  '5Tg': 'Chest9Inventory',
  'Bq<': 'Chest10Inventory',
  ';?C': 'ChestMagicInventory',
  fCh: 'ChestMagic2Inventory',
  Kha: 'CookingInventory',
  ':No': 'Slots',
  b2n: 'Id',
  Vn8: 'Type',
  elv: 'InventoryType',
  '1o9': 'Amount',
  F9q: 'MaxAmount',
  'B@N': 'Class',
  '1o6': 'InventoryClass',
  // Ship metadata, probed the same way: resource scene/seed, inventory
  // geometry, per-ship base stat bonuses and supercharged (TechBonus) slots.
  NTx: 'Resource',
  '93M': 'Filename',
  '@EL': 'Seed',
  'hl?': 'ValidSlotIndices',
  '=Tb': 'Width',
  'N9>': 'Height',
  '@bB': 'BaseStatValues',
  QL1: 'BaseStatID',
  '>MX': 'Value',
  MMm: 'SpecialSlots',
  QA1: 'InventorySpecialSlotType',
  '3ZH': 'Index',
  '>Qh': 'X',
  'XJ>': 'Y',
  aBE: 'PrimaryShip',
  // Fleet frigates, verified against libMBIN's mapping.json
  // (GcFleetFrigateSaveData) and a real save. The stats array is ordered by
  // FrigateStatTypeEnum; the class enum says "Mining"/"Diplomacy" where the
  // game displays Industrial/Trade.
  ';Du': 'FleetFrigates',
  uw7: 'FrigateClass',
  SS2: 'Race',
  '0Hi': 'AlienRace',
  Mjm: 'TraitIDs',
  fH8: 'CustomName',
  SLc: 'ResourceSeed',
  '5es': 'TotalNumberOfExpeditions',
  'v=L': 'TotalNumberOfSuccessfulEvents',
  '5VG': 'TotalNumberOfFailedEvents',
  MuL: 'NumberOfTimesDamaged',
  // Learned alien words, verified against the NMSSaveEditor community
  // mapping: one entry per word group, flagged per race.
  MF2: 'KnownWordGroups',
  MYl: 'Group',
  'D;o': 'Races',
  // Space-battle / freighter-rescue cooldown state and the play-time clock
  // it is measured on, plus the stats block holding the warp counter.
  // Verified against libMBIN's mapping.json (GcPlayerStateData /
  // GcCommonStateData field names) and a real save.
  '<h0': 'CommonStateData',
  Lg8: 'TotalPlayTime',
  '05J': 'TimeLastSpaceBattle',
  '8br': 'WarpsLastSpaceBattle',
  '9JR': 'ActiveSpaceBattleType',
  ':4C': 'SpaceBattleType',
  '8xx': 'ActiveSpaceBattleUA',
  'G;q': 'FreighterLastSpawnTime',
  gUR: 'Stats',
  ':rc': 'GroupId',
  '>vs': 'IntValue'
}

/** True when the tree still uses plain (un-obfuscated) keys. */
function hasPlainKeys(root: Json): boolean {
  return !!(root?.PlayerStateData || root?.BaseContext || root?.DiscoveryManagerData)
}

/**
 * Newer NMS saves obfuscate JSON keys. If the user drops a mapping file
 * (obfuscated key -> readable key, e.g. exported from libMBIN/NMSSaveEditor)
 * we rewrite the tree before extraction.
 */
export function deobfuscateKeys(node: Json, mapping: Record<string, string>): Json {
  if (Array.isArray(node)) return node.map((n) => deobfuscateKeys(n, mapping))
  if (node !== null && typeof node === 'object') {
    const out: Record<string, Json> = {}
    for (const [key, value] of Object.entries(node)) {
      out[mapping[key] ?? key] = deobfuscateKeys(value, mapping)
    }
    return out
  }
  return node
}

/** Decompress (if needed) and JSON-parse a raw save.hg buffer. */
export function loadSaveJson(raw: Buffer, keyMapping?: Record<string, string>): Json {
  // Three formats seen in the wild: NMS block container (magic-prefixed),
  // plain JSON, and a headerless raw LZ4 block (older Xbox slots).
  let jsonBuf: Buffer
  if (isNmsCompressedSave(raw)) {
    jsonBuf = decompressNmsSave(raw)
  } else if (raw[0] === 0x7b) {
    jsonBuf = raw
  } else {
    jsonBuf = decompressRawLz4(raw)
  }
  // Saves are NUL-terminated; trim trailing NULs before parsing.
  let start = 0
  while (start < jsonBuf.length && jsonBuf[start] !== 0x7b) start++
  let end = jsonBuf.length
  while (end > start && jsonBuf[end - 1] === 0) end--
  const parsed = JSON.parse(jsonBuf.subarray(start, end).toString('utf8'))
  if (hasPlainKeys(parsed)) return parsed
  return deobfuscateKeys(parsed, { ...DEFAULT_KEY_MAPPING, ...keyMapping })
}

/**
 * Player-given name on a discovery record: nested under the DM metadata
 * block in modern saves, flat CN in older ones. Empty when never renamed
 * (procedural names are not stored in saves at all).
 */
function discoveryCustomName(rec: Json): string {
  const nested = rec?.DM?.CN
  if (typeof nested === 'string' && nested.trim()) return nested.trim()
  const flat = rec?.CN
  if (typeof flat === 'string' && flat.trim()) return flat.trim()
  return ''
}

function extractFromTeleportEndpoints(playerState: Json, systems: Map<string, ParsedSystem>): void {
  const endpoints: Json[] = playerState?.TeleportEndpoints
  if (!Array.isArray(endpoints)) return

  for (const ep of endpoints) {
    const ua = ep?.UniversalAddress
    if (!ua) continue
    const ga = ua.GalacticAddress ?? {}
    const reality: number = ua.RealityIndex ?? 0
    const voxelX = ga.VoxelX ?? null
    const voxelY = ga.VoxelY ?? null
    const voxelZ = ga.VoxelZ ?? null
    const ssi = ga.SolarSystemIndex ?? null

    const address = canonicalAddress(reality, voxelX, voxelY, voxelZ, ssi)
    // Only station endpoints carry system-shaped names ("<System> Station
    // Tau"). Base endpoints are named after the base (by default its planet,
    // e.g. "Shvil Base"), settlements after the settlement ("Einingc's
    // Crossing"), freighters after the ship — none of those name the system,
    // so they only contribute the address. Untyped endpoints (unmapped older
    // formats) keep the permissive old behavior.
    const nameTrusted = ep.TeleporterType === 'Spacestation' || ep.TeleporterType === undefined
    const name =
      nameTrusted && typeof ep.Name === 'string' && ep.Name.trim()
        ? ep.Name.trim()
        : 'Unknown System'

    const existing = systems.get(address)
    // Station endpoints carry the best names — prefer them over placeholders.
    if (!existing || existing.name === 'Unknown System' || ep.TeleporterType === 'Spacestation') {
      systems.set(address, {
        universalAddress: address,
        name,
        galaxy: galaxyName(reality),
        voxelX,
        voxelY,
        voxelZ,
        solarSystemIndex: ssi,
        discoveredBy: existing?.discoveredBy ?? null,
        discoveredAt: existing?.discoveredAt ?? null
      })
    }
  }
}

function extractFromDiscoveryManager(saveRoot: Json, systems: Map<string, ParsedSystem>): void {
  const records: Json[] =
    saveRoot?.DiscoveryManagerData?.['DiscoveryData-v1']?.Store?.Record ??
    saveRoot?.PlayerStateData?.DiscoveryManagerData?.['DiscoveryData-v1']?.Store?.Record
  if (!Array.isArray(records)) return

  for (const rec of records) {
    const dd = rec?.DD
    if (!dd || dd.DT !== 'SolarSystem') continue
    // Hidden records are systems the player never visited: the game caches
    // other players' discoveries (e.g. names shown while browsing the galaxy
    // map) with the H flag set, and they don't appear in the in-game
    // Discoveries list either. Don't catalogue them.
    if (rec.FL?.H) continue
    // UA appears as a hex string in older saves and a plain number in newer ones.
    let uaRaw = dd.UA
    if (typeof uaRaw === 'number' && Number.isFinite(uaRaw)) uaRaw = uaRaw.toString(16)
    if (typeof uaRaw !== 'string') continue

    const decoded = decodeHexAddress(uaRaw)
    if (!decoded) continue
    const reality = decoded.realityIndex

    const address = canonicalAddress(
      reality,
      decoded.voxelX,
      decoded.voxelY,
      decoded.voxelZ,
      decoded.solarSystemIndex
    )

    // Ownership: who got the discovery credit, and when. Note USN is the
    // discoverer's handle — never a system name.
    const own = rec.OWS ?? {}
    const discoveredBy = typeof own.USN === 'string' && own.USN.trim() ? own.USN.trim() : null
    const discoveredAt =
      typeof own.TS === 'number' && own.TS > 0 ? new Date(own.TS * 1000).toISOString() : null

    const existing = systems.get(address)
    if (existing) {
      // Endpoint-named system: the record still contributes its ownership.
      existing.discoveredBy ??= discoveredBy
      existing.discoveredAt ??= discoveredAt
      continue
    }

    systems.set(address, {
      universalAddress: address,
      name: discoveryCustomName(rec) || 'Unknown System',
      galaxy: galaxyName(reality),
      voxelX: decoded.voxelX,
      voxelY: decoded.voxelY,
      voxelZ: decoded.voxelZ,
      solarSystemIndex: decoded.solarSystemIndex,
      discoveredBy,
      discoveredAt
    })
  }
}

export interface DiscoveredPlanet {
  /** Canonical address of the owning system (same key as ParsedSystem). */
  systemAddress: string
  name: string
  planetIndex: number
  /** True when the player renamed it (procedural names aren't in the save). */
  hasCustomName: boolean
  /** Owning system's coordinates, so a system stub can be synthesized when
   *  the save has a Planet record but no SolarSystem record for it. */
  galaxy: string | null
  voxelX: number
  voxelY: number
  voxelZ: number
  solarSystemIndex: number
}

/**
 * Planet discovery records (DT === 'Planet'): every planet the player has
 * been credited with discovering, linked to its system by address. Only
 * player-given names are stored in the save; procedurally named planets
 * get an index-based placeholder.
 */
export function extractPlanets(saveRoot: Json): DiscoveredPlanet[] {
  const records: Json[] =
    saveRoot?.DiscoveryManagerData?.['DiscoveryData-v1']?.Store?.Record ??
    saveRoot?.PlayerStateData?.DiscoveryManagerData?.['DiscoveryData-v1']?.Store?.Record
  if (!Array.isArray(records)) return []

  const planets = new Map<string, DiscoveredPlanet>()
  for (const rec of records) {
    const dd = rec?.DD
    if (!dd || dd.DT !== 'Planet') continue
    let uaRaw = dd.UA
    if (typeof uaRaw === 'number' && Number.isFinite(uaRaw)) uaRaw = uaRaw.toString(16)
    if (typeof uaRaw !== 'string') continue

    const decoded = decodeHexAddress(uaRaw)
    if (!decoded) continue

    const reality = decoded.realityIndex
    const systemAddress = canonicalAddress(
      reality,
      decoded.voxelX,
      decoded.voxelY,
      decoded.voxelZ,
      decoded.solarSystemIndex
    )
    // Note: hidden (FL.H) planet records are kept — they're other players'
    // discoveries cached for systems the player entered, so they're real
    // planets with real names; galaxy-map browsing never caches planets.
    const customName = discoveryCustomName(rec)
    const key = `${systemAddress}#${decoded.planetIndex}`
    // Duplicate records exist (re-discoveries); prefer the named one.
    const existing = planets.get(key)
    if (existing?.hasCustomName && !customName) continue
    planets.set(key, {
      systemAddress,
      name: customName || `Planet ${decoded.planetIndex}`,
      planetIndex: decoded.planetIndex,
      hasCustomName: !!customName,
      galaxy: galaxyName(reality),
      voxelX: decoded.voxelX,
      voxelY: decoded.voxelY,
      voxelZ: decoded.voxelZ,
      solarSystemIndex: decoded.solarSystemIndex
    })
  }
  return [...planets.values()]
}

export interface ParsedBase {
  /** Canonical address of the owning system (same key as ParsedSystem). */
  systemAddress: string
  name: string
  baseType: string
  /** Planet digit within the system; null for freighter bases (their
   *  address is just wherever the freighter was last parked). */
  planetIndex: number | null
  /** Number of placed parts — a rough size/importance signal. */
  parts: number
  /** Owning system's coordinates, for synthesizing a system stub. */
  galaxy: string | null
  voxelX: number
  voxelY: number
  voxelZ: number
  solarSystemIndex: number
}

/**
 * The player's own bases: PlayerStateData.PersistentPlayerBases. Each entry
 * carries a GalacticAddress whose planet digit ties the base to a planet.
 * ExternalPlanetBase entries (other players' bases the player visited) are
 * skipped. The address appears as "0x"-prefixed hex, bare hex, or a number
 * depending on the entry.
 *
 * The player's settlement is not among PersistentPlayerBases, but its
 * teleport endpoint carries a structured UniversalAddress whose PlanetIndex
 * ties it to its planet — surface it alongside the bases.
 */
export function extractBases(saveRoot: Json): ParsedBase[] {
  const playerState = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  const bases: ParsedBase[] = []

  for (const ep of playerState?.TeleportEndpoints ?? []) {
    if (ep?.TeleporterType !== 'Settlement') continue
    const ua = ep.UniversalAddress
    if (!ua) continue
    const ga = ua.GalacticAddress ?? {}
    const reality: number = ua.RealityIndex ?? 0
    bases.push({
      systemAddress: canonicalAddress(
        reality,
        ga.VoxelX ?? null,
        ga.VoxelY ?? null,
        ga.VoxelZ ?? null,
        ga.SolarSystemIndex ?? null
      ),
      name: typeof ep.Name === 'string' && ep.Name.trim() ? ep.Name.trim() : 'Settlement',
      baseType: 'Settlement',
      planetIndex: ga.PlanetIndex ?? null,
      parts: 0,
      galaxy: galaxyName(reality),
      voxelX: ga.VoxelX ?? 0,
      voxelY: ga.VoxelY ?? 0,
      voxelZ: ga.VoxelZ ?? 0,
      solarSystemIndex: ga.SolarSystemIndex ?? 0
    })
  }

  const entries: Json[] = playerState?.PersistentPlayerBases
  if (!Array.isArray(entries)) return bases

  for (const entry of entries) {
    const baseType = entry?.BaseType?.PersistentBaseTypes
    if (baseType !== 'HomePlanetBase' && baseType !== 'FreighterBase') continue

    let gaRaw = entry?.GalacticAddress
    if (typeof gaRaw === 'number' && Number.isFinite(gaRaw)) gaRaw = gaRaw.toString(16)
    if (typeof gaRaw !== 'string') continue
    const decoded = decodeHexAddress(gaRaw)
    if (!decoded) continue

    const isFreighter = baseType === 'FreighterBase'
    const name =
      (typeof entry.Name === 'string' && entry.Name.trim()) ||
      (isFreighter ? 'Freighter Base' : 'Unnamed Base')

    bases.push({
      systemAddress: canonicalAddress(
        decoded.realityIndex,
        decoded.voxelX,
        decoded.voxelY,
        decoded.voxelZ,
        decoded.solarSystemIndex
      ),
      name,
      baseType,
      planetIndex: isFreighter ? null : decoded.planetIndex,
      parts: Array.isArray(entry.Objects) ? entry.Objects.length : 0,
      galaxy: galaxyName(decoded.realityIndex),
      voxelX: decoded.voxelX,
      voxelY: decoded.voxelY,
      voxelZ: decoded.voxelZ,
      solarSystemIndex: decoded.solarSystemIndex
    })
  }
  return bases
}

export interface CurrentLocation {
  universalAddress: string
  galaxy: string | null
  voxelX: number | null
  voxelY: number | null
  voxelZ: number | null
  solarSystemIndex: number | null
  planetIndex: number | null
  /** Human-readable summary straight from the save, e.g. "Aboard X Station". */
  summary: string | null
}

/**
 * The player's current position: PlayerStateData.UniversalAddress
 * (the first field of PlayerStateData in every save format).
 */
export function extractCurrentLocation(saveRoot: Json): CurrentLocation | null {
  const playerState = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  const ua = playerState?.UniversalAddress
  if (!ua || typeof ua !== 'object') return null

  const ga = ua.GalacticAddress ?? {}
  const reality: number = ua.RealityIndex ?? 0
  return {
    universalAddress: canonicalAddress(
      reality,
      ga.VoxelX ?? null,
      ga.VoxelY ?? null,
      ga.VoxelZ ?? null,
      ga.SolarSystemIndex ?? null
    ),
    galaxy: galaxyName(reality),
    voxelX: ga.VoxelX ?? null,
    voxelY: ga.VoxelY ?? null,
    voxelZ: ga.VoxelZ ?? null,
    solarSystemIndex: ga.SolarSystemIndex ?? null,
    planetIndex: ga.PlanetIndex ?? null,
    summary: typeof playerState.SaveSummary === 'string' ? playerState.SaveSummary : null
  }
}

export interface ParsedInventoryItem {
  /** Internal game id with the '^' sigil stripped, e.g. 'PRODFUEL2'. */
  itemId: string
  itemType: 'Product' | 'Substance' | 'Technology' | 'Unknown'
  /** Total across all slots of the container holding this item. */
  amount: number
}

export interface ParsedContainer {
  /** Stable identity across syncs, e.g. 'chest:3' or 'ship:4:cargo'. */
  containerId: string
  /** Broad grouping for the UI: Exosuit, Ship, Freighter, Storage, … */
  group: 'Exosuit' | 'Multi-tool' | 'Ship' | 'Freighter' | 'Storage' | 'Exocraft'
  /** Display label, using the player's custom name where the save has one. */
  label: string
  items: ParsedInventoryItem[]
}

/** Sum an inventory's slots into per-item totals; [] when empty/missing. */
function readItems(inventory: Json): ParsedInventoryItem[] {
  const slots: Json[] = inventory?.Slots
  if (!Array.isArray(slots)) return []
  const totals = new Map<string, ParsedInventoryItem>()
  for (const slot of slots) {
    const rawId = slot?.Id
    if (typeof rawId !== 'string' || rawId.length < 2) continue
    const itemId = rawId.replace(/^\^/, '')
    // A few corrupted procedural entries carry binary garbage as their id;
    // real ids are plain ASCII (letters, digits, '_', '#seed', '?').
    if (!/^[\x20-\x7e]+$/.test(itemId)) continue
    const rawType = slot?.Type?.InventoryType
    const itemType =
      rawType === 'Product' || rawType === 'Substance' || rawType === 'Technology'
        ? rawType
        : 'Unknown'
    // Installed technology reports Amount -1 or a charge level; treat any
    // non-positive amount as "present" so upgrades still show up once.
    const amount = typeof slot.Amount === 'number' && slot.Amount > 0 ? slot.Amount : 1
    const existing = totals.get(itemId)
    if (existing) existing.amount += amount
    else totals.set(itemId, { itemId, itemType, amount })
  }
  return [...totals.values()]
}

/** The save's Name field, unless empty or an unlocalised default key. */
function customName(container: Json): string | null {
  const name = container?.Name
  if (typeof name !== 'string') return null
  const trimmed = name.trim()
  return trimmed && !trimmed.startsWith('BLD_') ? trimmed : null
}

/**
 * Every player-owned item container in the save: exosuit, multi-tools,
 * ships, freighter, the ten storage containers plus capsule/cooking
 * overflow chests, and exocraft. Containers with no items are omitted.
 * WeaponInventory is skipped — it mirrors the active entry of Multitools.
 */
export function extractInventories(saveRoot: Json): ParsedContainer[] {
  const ps = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  if (!ps) return []
  const out: ParsedContainer[] = []
  const add = (
    containerId: string,
    group: ParsedContainer['group'],
    label: string,
    inventory: Json
  ): void => {
    const items = readItems(inventory)
    if (items.length > 0) out.push({ containerId, group, label, items })
  }

  add('exosuit:general', 'Exosuit', 'Exosuit', ps.Inventory)
  add('exosuit:tech', 'Exosuit', 'Exosuit Tech', ps.Inventory_TechOnly)
  add('exosuit:cargo', 'Exosuit', 'Exosuit Cargo', ps.Inventory_Cargo)

  const multitools: Json[] = Array.isArray(ps.Multitools) ? ps.Multitools : []
  multitools.forEach((tool, i) => {
    add(
      `multitool:${i}`,
      'Multi-tool',
      customName(tool) ?? `Multi-tool ${i + 1}`,
      tool?.Store
    )
  })

  const ships: Json[] = Array.isArray(ps.ShipOwnership) ? ps.ShipOwnership : []
  ships.forEach((ship, i) => {
    const name = customName(ship) ?? `Ship ${i + 1}`
    add(`ship:${i}:general`, 'Ship', name, ship?.Inventory)
    add(`ship:${i}:tech`, 'Ship', `${name} Tech`, ship?.Inventory_TechOnly)
    add(`ship:${i}:cargo`, 'Ship', `${name} Cargo`, ship?.Inventory_Cargo)
  })

  add('freighter:general', 'Freighter', 'Freighter', ps.FreighterInventory)
  add('freighter:tech', 'Freighter', 'Freighter Tech', ps.FreighterInventory_TechOnly)
  add('freighter:cargo', 'Freighter', 'Freighter Cargo', ps.FreighterInventory_Cargo)

  // Save fields are Chest1..Chest10, but the in-game containers are
  // labelled 0-9 — mirror the game's numbering.
  for (let n = 1; n <= 10; n++) {
    const chest = ps[`Chest${n}Inventory`]
    add(`chest:${n}`, 'Storage', customName(chest) ?? `Storage ${n - 1}`, chest)
  }
  // Hidden buffers holding materials refunded from deleted base parts — not a
  // container the player visits; emptied in game via a Base Salvage Capsule.
  add('chest:magic1', 'Storage', 'Base Salvage Capsule', ps.ChestMagicInventory)
  add('chest:magic2', 'Storage', 'Base Salvage Capsule 2', ps.ChestMagic2Inventory)
  add('chest:cooking', 'Storage', 'Cooking Storage', ps.CookingInventory)

  const vehicles: Json[] = Array.isArray(ps.VehicleOwnership) ? ps.VehicleOwnership : []
  vehicles.forEach((vehicle, i) => {
    const name = customName(vehicle) ?? `Exocraft ${i + 1}`
    add(`exocraft:${i}:general`, 'Exocraft', name, vehicle?.Inventory)
    add(`exocraft:${i}:tech`, 'Exocraft', `${name} Tech`, vehicle?.Inventory_TechOnly)
  })

  return out
}

/** Archetype from the resource scene filename's model-folder token. */
function shipArchetype(filename: string, isRobot: boolean): ShipArchetype {
  const upper = filename.toUpperCase()
  if (upper.includes('SENTINELSHIP')) return 'Sentinel'
  if (upper.includes('DROPSHIP')) return 'Hauler'
  if (upper.includes('FIGHTER')) return 'Fighter'
  if (upper.includes('SCIENTIFIC')) return 'Explorer'
  if (upper.includes('SHUTTLE')) return 'Shuttle'
  if (upper.includes('SAILSHIP')) return 'Solar'
  if (upper.includes('S-CLASS') || upper.includes('SCLASS')) return 'Exotic'
  if (upper.includes('BIOPART') || upper.includes('BIOSHIP')) return 'Living'
  // BIGGS is the player-built corvette (Voyagers update).
  if (upper.includes('BIGGS')) return 'Corvette'
  // Sentinel interceptors may carry an empty filename but always have the
  // ^ROBOT_SHIP marker stat.
  if (isRobot) return 'Sentinel'
  return 'Unknown'
}

/** Usable slot count of one inventory area (0 when missing). */
function slotCapacity(inventory: Json): number {
  const valid = inventory?.ValidSlotIndices
  return Array.isArray(valid) ? valid.length : 0
}

/** Supercharged (TechBonus) slots of one inventory area. */
function superchargedCount(inventory: Json): number {
  const special = inventory?.SpecialSlots
  if (!Array.isArray(special)) return 0
  return special.filter((s) => s?.Type?.InventorySpecialSlotType === 'TechBonus').length
}

/** BaseStatValues as a map of stat id (sans '^') -> value. */
function baseStats(inventory: Json): Map<string, number> {
  const stats = new Map<string, number>()
  const entries: Json[] = inventory?.BaseStatValues
  if (!Array.isArray(entries)) return stats
  for (const entry of entries) {
    const id = entry?.BaseStatID
    const value = entry?.Value
    if (typeof id === 'string' && typeof value === 'number') {
      stats.set(id.replace(/^\^/, ''), Math.round(value * 10) / 10)
    }
  }
  return stats
}

/**
 * The player's owned starships with the comparison-relevant metadata the
 * save stores per ship: class, base stat bonuses, slot capacities and
 * supercharged slots. The ownership array is fixed-size, and slots are
 * never wiped: unused ones are 1×1 husks, while scrapped/traded-away
 * ships keep their whole inventory as ghost data with only the Resource
 * cleared. A ship is owned iff its Resource (scene filename / seed) is
 * set — verified against a save where the in-game fleet was 3 of the
 * array's 7 populated entries.
 */
export function extractShips(saveRoot: Json): ShipRecord[] {
  const ps = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  const ships: Json[] = Array.isArray(ps?.ShipOwnership) ? ps.ShipOwnership : []
  const primary = typeof ps?.PrimaryShip === 'number' ? ps.PrimaryShip : -1

  const out: ShipRecord[] = []
  ships.forEach((ship, index) => {
    const seedPair = ship?.Resource?.Seed
    const seedSet = Array.isArray(seedPair) && seedPair[0] === true
    const seed = seedSet && typeof seedPair[1] === 'string' ? seedPair[1] : null
    const filename = typeof ship?.Resource?.Filename === 'string' ? ship.Resource.Filename : ''
    if (!filename && !seedSet) return

    const storage = ship?.Inventory
    const tech = ship?.Inventory_TechOnly
    const stats = baseStats(storage)
    const storageSlots = slotCapacity(storage)
    const techSlots = slotCapacity(tech)

    out.push({
      index,
      isPrimary: index === primary,
      name: customName(ship),
      archetype: shipArchetype(filename, stats.has('ROBOT_SHIP')),
      inventoryClass: storage?.Class?.InventoryClass ?? 'C',
      damage: stats.get('SHIP_DAMAGE') ?? null,
      shield: stats.get('SHIP_SHIELD') ?? null,
      hyperdrive: stats.get('SHIP_HYPERDRIVE') ?? null,
      agility: stats.get('SHIP_AGILE') ?? null,
      storageSlots,
      techSlots,
      cargoSlots: slotCapacity(ship?.Inventory_Cargo),
      storageSupercharged: superchargedCount(storage),
      techSupercharged: superchargedCount(tech),
      seed
    })
  })
  return out
}

/** Save's frigate class enum -> the name the game displays. */
const FRIGATE_TYPES: Record<string, FrigateType> = {
  Combat: 'Combat',
  Exploration: 'Exploration',
  Mining: 'Industrial',
  Diplomacy: 'Trade',
  Support: 'Support'
}

/**
 * The player's fleet frigates (PlayerStateData.FleetFrigates). Unlike the
 * ship array there are no husk/ghost slots — the list holds exactly the
 * owned fleet — but an entry with an explicitly unset ResourceSeed is
 * skipped defensively. The stats array is ordered by FrigateStatTypeEnum:
 * Combat, Exploration, Mining, Diplomatic, FuelBurnRate, FuelCapacity,
 * Speed, ExtraLoot, Repair, Invulnerable, Stealth (verified against a real
 * save: each class's primary stat lands on the matching index).
 */
export function extractFrigates(saveRoot: Json): FrigateRecord[] {
  const ps = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  const fleet: Json[] = Array.isArray(ps?.FleetFrigates) ? ps.FleetFrigates : []

  const out: FrigateRecord[] = []
  fleet.forEach((frigate, index) => {
    const seedPair = frigate?.ResourceSeed
    if (Array.isArray(seedPair) && seedPair[0] !== true) return

    const stats: Json[] = Array.isArray(frigate?.Stats) ? frigate.Stats : []
    const stat = (i: number): number => (typeof stats[i] === 'number' ? stats[i] : 0)
    const traits: string[] = (Array.isArray(frigate?.TraitIDs) ? frigate.TraitIDs : [])
      .filter((t: Json) => typeof t === 'string')
      .map((t: string) => t.replace(/^\^/, ''))
      .filter((t: string) => t.length > 0)
    const name = typeof frigate?.CustomName === 'string' ? frigate.CustomName.trim() : ''
    const race = frigate?.Race?.AlienRace

    out.push({
      index,
      name: name || null,
      type: FRIGATE_TYPES[frigate?.FrigateClass?.FrigateClass] ?? 'Unknown',
      inventoryClass: frigate?.InventoryClass?.InventoryClass ?? 'C',
      race: typeof race === 'string' ? race : null,
      combat: stat(0),
      exploration: stat(1),
      industrial: stat(2),
      trade: stat(3),
      fuelBurnRate: stat(4),
      fuelCapacity: stat(5),
      speed: stat(6),
      extraLoot: stat(7),
      repair: stat(8),
      invulnerability: stat(9),
      stealth: stat(10),
      traits,
      expeditions: typeof frigate?.TotalNumberOfExpeditions === 'number'
        ? frigate.TotalNumberOfExpeditions
        : 0,
      successfulEvents: typeof frigate?.TotalNumberOfSuccessfulEvents === 'number'
        ? frigate.TotalNumberOfSuccessfulEvents
        : 0,
      failedEvents: typeof frigate?.TotalNumberOfFailedEvents === 'number'
        ? frigate.TotalNumberOfFailedEvents
        : 0,
      timesDamaged: typeof frigate?.NumberOfTimesDamaged === 'number'
        ? frigate.NumberOfTimesDamaged
        : 0
    })
  })
  return out
}

/**
 * Per-language word-learning progress. The save stores learned word
 * *groups* (PlayerStateData.KnownWordGroups: group id + per-race flags) —
 * the same unit the game's "words learned" counter displays. A group can
 * additionally unlock variant dictionary words; both units are reported,
 * with totals from the bundled vocabulary table. Returns [] when the save
 * has no word data (unmapped older formats), so a stale snapshot is never
 * wiped by a bad parse.
 */
export function extractLanguageProgress(saveRoot: Json): LanguageProgressRecord[] {
  const ps = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  const groups: Json[] = ps?.KnownWordGroups
  if (!Array.isArray(groups)) return []

  const known = new Map<LanguageName, { words: number; groups: number }>()
  for (const entry of groups) {
    const group = entry?.Group
    const races = entry?.Races
    if (typeof group !== 'string' || !Array.isArray(races)) continue
    const words = MULTI_WORD_GROUPS[group] ?? 1
    races.forEach((flag, race) => {
      const language = flag === true ? RACE_LANGUAGES[race] : undefined
      if (!language) return
      const tally = known.get(language) ?? { words: 0, groups: 0 }
      tally.words += words
      tally.groups += 1
      known.set(language, tally)
    })
  }

  return (Object.keys(LANGUAGE_TOTALS) as LanguageName[]).map((language) => ({
    language,
    wordsKnown: known.get(language)?.words ?? 0,
    totalWords: LANGUAGE_TOTALS[language].words,
    groupsKnown: known.get(language)?.groups ?? 0,
    totalGroups: LANGUAGE_TOTALS[language].groups
  }))
}

/** One ^GLOBAL_STATS counter, e.g. ^DIST_WARP; null when absent or never incremented. */
function globalStat(playerState: Json, id: string): number | null {
  const groups: Json[] = playerState?.Stats
  if (!Array.isArray(groups)) return null
  const global = groups.find((g) => g?.GroupId === '^GLOBAL_STATS')
  const entries: Json[] = global?.Stats
  if (!Array.isArray(entries)) return null
  const value = entries.find((e) => e?.Id === id)?.Value?.IntValue
  return typeof value === 'number' ? value : null
}

/**
 * Space-battle cooldown state (see `@shared/freighterBattle` for the
 * thresholds it feeds). The save stamps the play-time and warp counter at
 * every battle; the running warp counter is not a PlayerStateData field —
 * the only counterpart in the save is the ^DIST_WARP global stat, which
 * tracks warps performed (78 in a real save whose WarpsLastSpaceBattle
 * was 71, i.e. 7 warps into the cooldown).
 *
 * Returns null for saves without the fields (older/unmapped formats), so a
 * good snapshot is never wiped by a bad parse.
 */
export function extractFreighterBattle(
  saveRoot: Json
): Omit<FreighterBattleState, 'savedAt'> | null {
  const ps = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  const timeLast = ps?.TimeLastSpaceBattle
  const warpsLast = ps?.WarpsLastSpaceBattle
  // TotalPlayTime is the clock TimeLastSpaceBattle is measured against.
  // Current saves keep it in CommonStateData, beside PlayerStateData; older
  // ones (seen on a legacy Game Pass slot, save version 4655) keep it inside.
  const totalPlayTime = saveRoot?.CommonStateData?.TotalPlayTime ?? ps?.TotalPlayTime
  if (
    typeof timeLast !== 'number' ||
    typeof warpsLast !== 'number' ||
    typeof totalPlayTime !== 'number'
  ) {
    return null
  }

  const active = ps?.ActiveSpaceBattleType?.SpaceBattleType
  return {
    timeLastSpaceBattle: timeLast,
    warpsLastSpaceBattle: warpsLast,
    totalPlayTime,
    warpCount: globalStat(ps, '^DIST_WARP'),
    battlesFought: globalStat(ps, '^SPACE_BATTLES'),
    activeBattleType: typeof active === 'string' ? active : null
  }
}

/** Extract all known systems from a parsed save tree. */
export function extractSystems(saveRoot: Json): ParsedSystem[] {
  const systems = new Map<string, ParsedSystem>()
  const playerState = saveRoot?.PlayerStateData ?? saveRoot?.BaseContext?.PlayerStateData
  if (playerState) extractFromTeleportEndpoints(playerState, systems)
  extractFromDiscoveryManager(saveRoot, systems)
  return [...systems.values()]
}
