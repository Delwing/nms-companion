/** Shared entity models used by main, preload and renderer. */

export type GuildType = 'Merchants' | 'Explorers' | 'Mercenaries' | null

/**
 * What sits at the system's station slot: a normal station (guild envoy
 * aboard), an outlaw station (pirate-controlled, no envoy), or no station
 * at all (abandoned system). The latter two imply no guild.
 */
export type StationStatus = 'normal' | 'pirate' | 'stationless'

export interface SystemRecord {
  universalAddress: string
  name: string
  galaxy: string | null
  voxelX: number | null
  voxelY: number | null
  voxelZ: number | null
  solarSystemIndex: number | null
  isBlackHole: boolean
  guildType: GuildType
  station: StationStatus
  offersSfm: boolean
  multiToolSClass: boolean
  /** Economy descriptor from an OCR system scan, e.g. "Mining · Medium Supply". */
  economy: string | null
  /** Conflict level from an OCR system scan, e.g. "Low". */
  conflict: string | null
  /** Dominant lifeform, e.g. "Gek". */
  race: string | null
  /** Handle of the player credited with the system discovery (from the
   *  save's discovery records); null when unknown. */
  discoveredBy: string | null
  /** ISO timestamp of that discovery; null when unknown. */
  discoveredAt: string | null
  customTags: string[]
  /** Last-seen guild envoy offerings for this system's station. */
  envoyItems: string[]
  notes: string
  updatedAt: string
}

export interface PlanetRecord {
  id: number
  systemAddress: string | null
  name: string
  type: string
  weather: string
  sentinels: string
  flora: string
  fauna: string
  resources: string[]
  /** Planet digit within the system (from save discovery records). */
  planetIndex: number | null
  /** Where the record came from: an OCR scan or the save's discovery data. */
  source: 'ocr' | 'save'
  /** System name seen on the scan's card header when no match was found. */
  systemHint: string | null
  /** Known bases recognised on the scan's card: 0 = card showed none,
   *  null = unknown (save imports, full-frame scans, pre-feature rows). */
  cardBases: number | null
  scannedAt: string
}

/** One of the player's own bases, imported from the save. */
export interface BaseRecord {
  id: number
  systemAddress: string
  /** Planet digit within the system; null for freighter bases. */
  planetIndex: number | null
  name: string
  baseType: 'HomePlanetBase' | 'FreighterBase' | string
  /** Number of placed parts — a rough size signal. */
  parts: number
  updatedAt: string
}

/** One item stack inside a player-owned container, imported from the save. */
export interface InventoryItemRecord {
  id: number
  /** Stable container identity, e.g. 'chest:3' or 'ship:4:cargo'. */
  containerId: string
  /** Broad grouping: Exosuit, Multi-tool, Ship, Freighter, Storage, Exocraft. */
  containerGroup: string
  /** Display label, e.g. 'Storage 4' or the player's custom name. */
  containerLabel: string
  /** Internal game id, '^' stripped, e.g. 'PRODFUEL2'. */
  itemId: string
  itemType: string
  /** Total across the container's slots holding this item. */
  amount: number
  updatedAt: string
}

/** Ship archetype, derived from the resource scene filename in the save. */
export type ShipArchetype =
  | 'Fighter'
  | 'Hauler'
  | 'Explorer'
  | 'Shuttle'
  | 'Solar'
  | 'Exotic'
  | 'Living'
  | 'Sentinel'
  | 'Corvette'
  | 'Unknown'

/**
 * One owned starship, imported from the save. Stat values are the ship's
 * base class bonuses (percentages) stored in the save — the in-game numbers
 * additionally include installed technology, which is computed at runtime.
 */
export interface ShipRecord {
  /** Position in the save's ship array — a stable slot identity. */
  index: number
  /** True for the ship the player is currently flying. */
  isPrimary: boolean
  /** Player-given name, or null when never renamed. */
  name: string | null
  archetype: ShipArchetype
  /** C / B / A / S. */
  inventoryClass: string
  /** Base bonus percentages; null when the save carries no value. */
  damage: number | null
  shield: number | null
  hyperdrive: number | null
  agility: number | null
  storageSlots: number
  techSlots: number
  /** Separate cargo hold; 0 on post-4.0 saves (merged into storage). */
  cargoSlots: number
  /** Supercharged slot counts per inventory area. */
  storageSupercharged: number
  techSupercharged: number
  /** Appearance seed, e.g. "0x59AFD4D4657B140A"; null when unset. */
  seed: string | null
}

/** Frigate speciality, using the in-game names (the save calls Industrial
 *  "Mining" and Trade "Diplomacy"). */
export type FrigateType =
  | 'Combat'
  | 'Exploration'
  | 'Industrial'
  | 'Trade'
  | 'Support'
  | 'Unknown'

/**
 * One fleet frigate, imported from the save. Stat values are the in-game
 * numbers shown on the frigate's info page (traits already applied).
 */
export interface FrigateRecord {
  /** Position in the save's fleet array — a stable identity. */
  index: number
  /** Player-given name, or null when never renamed (procedural names
   *  aren't stored in saves). */
  name: string | null
  type: FrigateType
  /** C / B / A / S. */
  inventoryClass: string
  /** Crew lifeform, e.g. "Traders"; null when the save carries no value. */
  race: string | null
  /** The four expedition stats, in the game's display order. */
  combat: number
  exploration: number
  industrial: number
  trade: number
  /** Tonnes of fuel per expedition — lower is better. */
  fuelBurnRate: number
  /** Remaining stat types of the save's fixed-order stats array; usually 0
   *  unless a trait grants them. */
  fuelCapacity: number
  speed: number
  extraLoot: number
  repair: number
  invulnerability: number
  stealth: number
  /** Trait ids with the '^' sigil stripped, e.g. 'TRADING_SEC_6'. */
  traits: string[]
  expeditions: number
  successfulEvents: number
  failedEvents: number
  timesDamaged: number
}

/**
 * Per-language word-learning progress, imported from the save. Group counts
 * are the unit both the save and the game's "words learned" counter use
 * (verified against a real save + in-game Gek info page); word counts
 * additionally include the variant dictionary words a group unlocks.
 */
export interface LanguageProgressRecord {
  language: string
  wordsKnown: number
  totalWords: number
  groupsKnown: number
  totalGroups: number
}

/** Structured payload produced by the OCR entity parser. */
export interface ParsedPlanetData {
  name?: string
  planetType: string
  weather: string
  sentinels: string
  flora: string
  fauna: string
  resources: string[]
  /** System name read from the Discoveries card header, e.g. "Laerib". */
  systemHint?: string
}

/** Player's standing with one guild, updated by envoy scans or by hand. */
export interface GuildStanding {
  guild: Exclude<GuildType, null>
  /** Canonical ladder rank name (see guildRanks.ts). */
  rank: string
  updatedAt: string
}

/** Structured payload from a Guild Envoy screen scan. */
export interface EnvoyData {
  guild: GuildType
  envoyName: string | null
  guildRank: string | null
  items: string[]
  offersSfm: boolean
}

/** Structured payload from a system-info screen scan (galaxy map / Discoveries). */
export interface SystemInfoData {
  /** System name as read from the panel header, if recognisable. */
  systemName: string | null
  race: string | null
  economy: string | null
  conflict: string | null
}

export interface OcrScanResult {
  ok: boolean
  kind?: 'planet' | 'envoy' | 'system'
  data?: ParsedPlanetData
  envoy?: EnvoyData
  system?: SystemInfoData
  planetId?: number
  /** Universal address of the system auto-updated by an envoy scan. */
  systemPatched?: string | null
  rawText?: string
  durationMs: number
  error?: string
}

export interface OcrStatus {
  state: 'idle' | 'capturing' | 'recognizing' | 'done' | 'error'
  message?: string
}

/**
 * What the host OS can support of the overlay/scanning half of the app. The
 * save catalogue works everywhere; these are the Win32-shaped features, and
 * the flags let the UI say so instead of failing obscurely. See
 * `src/main/services/platform.ts`.
 */
export interface PlatformSupport {
  os: NodeJS.Platform
  /** Linux display server ('wayland' | 'x11'); null on other platforms. */
  session: string | null
  /** Screenshotting the game for OCR. */
  screenCapture: boolean
  /** Alt+C / Alt+S firing while the game holds focus. */
  globalHotkeys: boolean
  /** Alt+S handing the foreground back to the game. */
  gameFocus: boolean
  /** Reading procedural names out of the running game. */
  memoryScan: boolean
  /** One user-facing sentence per unsupported or degraded feature. */
  limitations: string[]
}

/** One save slot (character) discovered on disk; auto+manual saves collapse into one slot. */
export interface SaveSlotInfo {
  /** Stable identity: profile dir + slot pair, e.g. "st_123/Slot2". */
  id: string
  /** Short display name, e.g. "Slot 2". */
  label: string
  /** Newest save-file write time for this slot (ISO). */
  savedAt: string
  /** Newest save-file size — a rough proxy for character progress. */
  sizeBytes: number
}

export interface SaveSlotState {
  slots: SaveSlotInfo[]
  /** Pinned slot id, or null for "newest save wins". */
  selected: string | null
}

/** Player's current position, from the most recently written save slot. */
export interface LocationInfo {
  universalAddress: string
  /** Save's own description, e.g. "Aboard Elunbod Station Minor". */
  summary: string | null
  /** Catalogued system name at this address, if we know one. */
  systemName: string | null
  galaxy: string | null
  planetIndex: number | null
  slot: string
  savedAt: string
}

/**
 * Space-battle cooldown state read from the save. The game gates
 * freighter-rescue (and pirate) ambushes on warp-in behind two counters it
 * stamps at every battle; the thresholds themselves live in the game's
 * GAMEPLAYGLOBALS, not the save (see `@shared/freighterBattle`).
 */
export interface FreighterBattleState {
  /** Play-time seconds at the last space battle (same clock as totalPlayTime). */
  timeLastSpaceBattle: number
  /** Warp counter's value at the last space battle. */
  warpsLastSpaceBattle: number
  /** Character's total play time in seconds — the battle timer's clock. */
  totalPlayTime: number
  /** Warps performed so far (^DIST_WARP stat); null when the save has no stats block. */
  warpCount: number | null
  /** Space battles fought (^SPACE_BATTLES stat); null when unavailable. */
  battlesFought: number | null
  /** In-progress battle, e.g. "PirateFreighter"; "None" when idle. */
  activeBattleType: string | null
  /** Write time of the save this snapshot came from (ISO). */
  savedAt: string
}

export interface SaveSyncResult {
  systemsUpserted: number
  /** Planets imported/refreshed from the save's discovery records. */
  planetsUpserted: number
  /** Player bases imported from the save. */
  basesUpserted: number
  /** Inventory item stacks imported from the save's containers. */
  inventoryItems: number
  /** OCR planets tied into their system (hint relinks + stub merges). */
  planetsLinked: number
  savePath: string
  syncedAt: string
  /** Best-known current location (newest save slot wins). */
  location: LocationInfo | null
  /** Space-battle cooldown snapshot (newest save slot wins); null until parsed. */
  freighterBattle: FreighterBattleState | null
}

/**
 * Result of the experimental read-only game-memory name harvest.
 * `named` / `namedPlanets` list previously-unnamed entries that received
 * a name.
 */
export interface HarvestResult {
  ok: boolean
  /** 'game-not-running' | 'unsupported-platform' | 'open-failed' |
   *  'calibration-failed' | 'scan-failed' */
  error?: string
  named: { universalAddress: string; name: string }[]
  namedPlanets: { systemAddress: string; planetIndex: number; name: string }[]
  /** Agreement with already-known names — the guard against layout drift. */
  calibration: { matched: number; compared: number }
  planetCalibration: { matched: number; compared: number }
}

/** Fields on a system the user may edit from the UI. */
export interface SystemPatch {
  guildType?: GuildType
  station?: StationStatus
  offersSfm?: boolean
  multiToolSClass?: boolean
  customTags?: string[]
  envoyItems?: string[]
  notes?: string
  isBlackHole?: boolean
  economy?: string | null
  conflict?: string | null
  race?: string | null
}

/**
 * Tooltip-grade item lore from the AssistantNMS datasets, keyed by
 * normalised display name (see normaliseItemName in itemNames.ts).
 */
export interface ItemDetail {
  name: string
  /** In-game subtitle, e.g. "Refined Stellar Metal: Yellow". */
  group: string
  /** Raw NMS markup text, e.g. "A <STELLAR>chromatic metal<>, …". */
  description: string
  /** Hex tint NMS paints the item's icon with (no leading '#'). */
  colour: string | null
  baseValue: number
  /** 0 units / 1 nanites / 2 quicksilver (matches ItemInfoTuple). */
  currency: number
  /** Icon path within the AssistantNMS image tree, e.g. 'rawMaterials/19.png'. */
  icon: string | null
}
