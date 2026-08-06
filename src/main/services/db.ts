/**
 * Persistence layer. Primary backend is better-sqlite3 (schema per spec);
 * if the native module is unavailable (e.g. not rebuilt for Electron's ABI)
 * we fall back to a lowdb-style JSON file with the same interface.
 */
import { createRequire } from 'module'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import type {
  BaseRecord,
  GuildStanding,
  GuildType,
  InventoryItemRecord,
  PlanetRecord,
  SystemRecord,
  SystemPatch,
  ParsedPlanetData
} from '@shared/types'
import type { DiscoveredPlanet, ParsedBase, ParsedContainer, ParsedSystem } from './saveParser'
import {
  choosePlaceholderSlot,
  isClaimablePlanet,
  planPlaceholderMerges
} from './systemMatcher'

const require = createRequire(import.meta.url)

/** Index evidence derived from a card scan (base names seen on the card). */
export interface PlanetEvidence {
  /** Exact planet index, when a base on the card identified it. */
  planetIndex?: number | null
  /** Known bases recognised on the card: 0 = none seen, null = unknown. */
  cardBases?: number | null
}

export interface CatalogueStore {
  readonly backend: 'sqlite' | 'json'
  upsertSystems(systems: ParsedSystem[]): number
  patchSystem(universalAddress: string, patch: SystemPatch): SystemRecord | null
  /** Name a system that is still the "Unknown System" placeholder (e.g. from
   *  the experimental memory harvest); never overwrites a real name. */
  setSystemNameIfUnknown(universalAddress: string, name: string): boolean
  /** Name a planet that still has its save-import "Planet N" placeholder;
   *  never overwrites a real (scanned or custom) name. */
  setPlanetNameIfPlaceholder(systemAddress: string, planetIndex: number, name: string): boolean
  /** Remove a system with its save-imported planets and bases; OCR-scanned
   *  planets survive, unassigned. Used by the per-slot store migration. */
  deleteSystem(universalAddress: string): boolean
  listSystems(): SystemRecord[]
  insertPlanet(
    data: ParsedPlanetData,
    systemAddress?: string | null,
    evidence?: PlanetEvidence
  ): PlanetRecord
  upsertDiscoveredPlanets(planets: DiscoveredPlanet[]): number
  /** Fold save-import "Planet N" stubs into already-scanned OCR planets. */
  mergePlaceholderPlanets(): number
  /** Replace each touched system's bases with the save's current set. */
  upsertBases(bases: ParsedBase[]): number
  listBases(): BaseRecord[]
  /** Replace the whole inventory snapshot with the save's current one. */
  replaceInventories(containers: ParsedContainer[]): number
  listInventories(): InventoryItemRecord[]
  listPlanets(): PlanetRecord[]
  setPlanetSystem(id: number, systemAddress: string | null): PlanetRecord | null
  deletePlanet(id: number): boolean
  /** Player's standing with each guild (envoy scans / manual edits). */
  listGuildStandings(): GuildStanding[]
  setGuildStanding(guild: Exclude<GuildType, null>, rank: string): GuildStanding
  close(): void
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS systems (
  universal_address TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  galaxy TEXT,
  voxel_x INTEGER,
  voxel_y INTEGER,
  voxel_z INTEGER,
  solar_system_index INTEGER,
  is_black_hole INTEGER DEFAULT 0,
  guild_type TEXT,
  station TEXT DEFAULT 'normal',
  offers_sfm INTEGER DEFAULT 0,
  multi_tool_s_class INTEGER DEFAULT 0,
  economy TEXT,
  conflict TEXT,
  race TEXT,
  discovered_by TEXT,
  discovered_at TEXT,
  custom_tags TEXT,
  envoy_items TEXT,
  notes TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS planets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_address TEXT,
  name TEXT NOT NULL,
  type TEXT,
  weather TEXT,
  sentinels TEXT,
  flora TEXT,
  fauna TEXT,
  resources TEXT,
  planet_index INTEGER,
  source TEXT DEFAULT 'ocr',
  system_hint TEXT,
  card_bases INTEGER,
  scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_address) REFERENCES systems(universal_address)
);

CREATE TABLE IF NOT EXISTS bases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_address TEXT NOT NULL,
  planet_index INTEGER,
  name TEXT NOT NULL,
  base_type TEXT,
  parts INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (system_address) REFERENCES systems(universal_address)
);

CREATE TABLE IF NOT EXISTS inventories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id TEXT NOT NULL,
  container_group TEXT NOT NULL,
  container_label TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_type TEXT,
  amount INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS guild_standings (
  guild TEXT PRIMARY KEY,
  rank TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`

function parseTags(json: string | null): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SqliteRow = any

function rowToSystem(row: SqliteRow): SystemRecord {
  return {
    universalAddress: row.universal_address,
    name: row.name,
    galaxy: row.galaxy,
    voxelX: row.voxel_x,
    voxelY: row.voxel_y,
    voxelZ: row.voxel_z,
    solarSystemIndex: row.solar_system_index,
    isBlackHole: !!row.is_black_hole,
    guildType: row.guild_type ?? null,
    station:
      row.station === 'pirate' || row.station === 'stationless' ? row.station : 'normal',
    offersSfm: !!row.offers_sfm,
    multiToolSClass: !!row.multi_tool_s_class,
    economy: row.economy ?? null,
    conflict: row.conflict ?? null,
    race: row.race ?? null,
    discoveredBy: row.discovered_by ?? null,
    discoveredAt: row.discovered_at ?? null,
    customTags: parseTags(row.custom_tags),
    envoyItems: parseTags(row.envoy_items),
    notes: row.notes ?? '',
    updatedAt: row.updated_at
  }
}

function rowToPlanet(row: SqliteRow): PlanetRecord {
  return {
    id: row.id,
    systemAddress: row.system_address,
    name: row.name,
    type: row.type ?? 'Unknown',
    weather: row.weather ?? 'Unknown',
    sentinels: row.sentinels ?? 'Unknown',
    flora: row.flora ?? 'Unknown',
    fauna: row.fauna ?? 'Unknown',
    resources: parseTags(row.resources),
    planetIndex: row.planet_index ?? null,
    source: row.source === 'save' ? 'save' : 'ocr',
    systemHint: row.system_hint ?? null,
    cardBases: row.card_bases ?? null,
    scannedAt: row.scanned_at
  }
}

function rowToInventoryItem(row: SqliteRow): InventoryItemRecord {
  return {
    id: row.id,
    containerId: row.container_id,
    containerGroup: row.container_group,
    containerLabel: row.container_label,
    itemId: row.item_id,
    itemType: row.item_type ?? 'Unknown',
    amount: row.amount ?? 0,
    updatedAt: row.updated_at
  }
}

function rowToBase(row: SqliteRow): BaseRecord {
  return {
    id: row.id,
    systemAddress: row.system_address,
    planetIndex: row.planet_index ?? null,
    name: row.name,
    baseType: row.base_type ?? 'HomePlanetBase',
    parts: row.parts ?? 0,
    updatedAt: row.updated_at
  }
}

class SqliteStore implements CatalogueStore {
  readonly backend = 'sqlite' as const
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any

  constructor(dbPath: string) {
    const Database = require('better-sqlite3')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
    // Migrations for databases created before these columns existed.
    const migrations = [
      'ALTER TABLE systems ADD COLUMN envoy_items TEXT',
      'ALTER TABLE systems ADD COLUMN economy TEXT',
      'ALTER TABLE systems ADD COLUMN conflict TEXT',
      'ALTER TABLE systems ADD COLUMN race TEXT',
      "ALTER TABLE systems ADD COLUMN station TEXT DEFAULT 'normal'",
      'ALTER TABLE planets ADD COLUMN planet_index INTEGER',
      "ALTER TABLE planets ADD COLUMN source TEXT DEFAULT 'ocr'",
      'ALTER TABLE planets ADD COLUMN system_hint TEXT',
      'ALTER TABLE planets ADD COLUMN card_bases INTEGER',
      'ALTER TABLE systems ADD COLUMN discovered_by TEXT',
      'ALTER TABLE systems ADD COLUMN discovered_at TEXT'
    ]
    for (const sql of migrations) {
      try {
        this.db.exec(sql)
      } catch {
        /* column already present */
      }
    }
  }

  upsertSystems(systems: ParsedSystem[]): number {
    // Only sync-owned columns are written; custom metadata (tags, notes,
    // guild, toggles) survives every save-file re-sync untouched.
    const stmt = this.db.prepare(`
      INSERT INTO systems (universal_address, name, galaxy, voxel_x, voxel_y, voxel_z, solar_system_index, discovered_by, discovered_at, custom_tags, notes)
      VALUES (@universalAddress, @name, @galaxy, @voxelX, @voxelY, @voxelZ, @solarSystemIndex, @discoveredBy, @discoveredAt, '[]', '')
      ON CONFLICT(universal_address) DO UPDATE SET
        name = CASE WHEN excluded.name != 'Unknown System' THEN excluded.name ELSE systems.name END,
        galaxy = COALESCE(excluded.galaxy, systems.galaxy),
        voxel_x = COALESCE(excluded.voxel_x, systems.voxel_x),
        voxel_y = COALESCE(excluded.voxel_y, systems.voxel_y),
        voxel_z = COALESCE(excluded.voxel_z, systems.voxel_z),
        solar_system_index = COALESCE(excluded.solar_system_index, systems.solar_system_index),
        discovered_by = COALESCE(excluded.discovered_by, systems.discovered_by),
        discovered_at = COALESCE(excluded.discovered_at, systems.discovered_at),
        updated_at = CURRENT_TIMESTAMP
    `)
    const run = this.db.transaction((rows: ParsedSystem[]) => {
      for (const row of rows) stmt.run(row)
    })
    run(systems)
    return systems.length
  }

  setSystemNameIfUnknown(universalAddress: string, name: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE systems SET name = @name, updated_at = CURRENT_TIMESTAMP
         WHERE universal_address = @universalAddress AND name = 'Unknown System'`
      )
      .run({ universalAddress, name })
    return result.changes > 0
  }

  setPlanetNameIfPlaceholder(systemAddress: string, planetIndex: number, name: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE planets SET name = @name
         WHERE system_address = @systemAddress AND planet_index = @planetIndex
           AND name = @placeholder`
      )
      .run({ systemAddress, planetIndex, name, placeholder: `Planet ${planetIndex}` })
    return result.changes > 0
  }

  deleteSystem(universalAddress: string): boolean {
    const run = this.db.transaction((ua: string) => {
      this.db.prepare("DELETE FROM planets WHERE system_address = ? AND source = 'save'").run(ua)
      this.db.prepare('UPDATE planets SET system_address = NULL WHERE system_address = ?').run(ua)
      this.db.prepare('DELETE FROM bases WHERE system_address = ?').run(ua)
      return this.db.prepare('DELETE FROM systems WHERE universal_address = ?').run(ua).changes
    })
    return run(universalAddress) > 0
  }

  patchSystem(universalAddress: string, patch: SystemPatch): SystemRecord | null {
    const sets: string[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const params: Record<string, any> = { universalAddress }
    if (patch.guildType !== undefined) {
      sets.push('guild_type = @guildType')
      params.guildType = patch.guildType
    }
    if (patch.station !== undefined) {
      sets.push('station = @station')
      params.station = patch.station
    }
    if (patch.offersSfm !== undefined) {
      sets.push('offers_sfm = @offersSfm')
      params.offersSfm = patch.offersSfm ? 1 : 0
    }
    if (patch.multiToolSClass !== undefined) {
      sets.push('multi_tool_s_class = @multiToolSClass')
      params.multiToolSClass = patch.multiToolSClass ? 1 : 0
    }
    if (patch.isBlackHole !== undefined) {
      sets.push('is_black_hole = @isBlackHole')
      params.isBlackHole = patch.isBlackHole ? 1 : 0
    }
    if (patch.customTags !== undefined) {
      sets.push('custom_tags = @customTags')
      params.customTags = JSON.stringify(patch.customTags)
    }
    if (patch.envoyItems !== undefined) {
      sets.push('envoy_items = @envoyItems')
      params.envoyItems = JSON.stringify(patch.envoyItems)
    }
    if (patch.economy !== undefined) {
      sets.push('economy = @economy')
      params.economy = patch.economy
    }
    if (patch.conflict !== undefined) {
      sets.push('conflict = @conflict')
      params.conflict = patch.conflict
    }
    if (patch.race !== undefined) {
      sets.push('race = @race')
      params.race = patch.race
    }
    if (patch.notes !== undefined) {
      sets.push('notes = @notes')
      params.notes = patch.notes
    }
    if (sets.length > 0) {
      this.db
        .prepare(
          `UPDATE systems SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE universal_address = @universalAddress`
        )
        .run(params)
    }
    const row = this.db
      .prepare('SELECT * FROM systems WHERE universal_address = ?')
      .get(universalAddress)
    return row ? rowToSystem(row) : null
  }

  listSystems(): SystemRecord[] {
    return this.db
      .prepare('SELECT * FROM systems ORDER BY updated_at DESC')
      .all()
      .map(rowToSystem)
  }

  insertPlanet(
    data: ParsedPlanetData,
    systemAddress?: string | null,
    evidence?: PlanetEvidence
  ): PlanetRecord {
    const planetIndex = evidence?.planetIndex ?? null
    const cardBases = evidence?.cardBases ?? null

    // Re-scanning a named planet refreshes it instead of duplicating it.
    // A weak read (flight HUD, partial crop) parses fields as 'Unknown' —
    // those must never clobber data an earlier full scan already captured.
    const existing = data.name
      ? this.db.prepare('SELECT * FROM planets WHERE name = ?').get(data.name)
      : undefined

    // A base-anchored index is certain; whoever currently holds that slot
    // guessed it. A claimable row ("Planet N" stub or nameless scan) merges
    // into this scan (deleted below or claimed as the slot); a mis-slotted
    // OCR planet loses its index and gets re-paired by a later merge.
    if (systemAddress && planetIndex !== null) {
      const holder = this.db
        .prepare(
          'SELECT id, source, type, name FROM planets WHERE system_address = ? AND planet_index = ?'
        )
        .get(systemAddress, planetIndex)
      if (holder && holder.id !== existing?.id) {
        if (!isClaimablePlanet(holder)) {
          this.db.prepare('UPDATE planets SET planet_index = NULL WHERE id = ?').run(holder.id)
        } else if (existing) {
          this.db.prepare('DELETE FROM planets WHERE id = ?').run(holder.id)
        }
      }
    }

    if (existing) {
      const keep = (incoming: string, current: string | null): string =>
        incoming !== 'Unknown' ? incoming : (current ?? 'Unknown')
      const resources =
        data.resources.length > 0 ? data.resources : parseTags(existing.resources)
      this.db
        .prepare(
          `UPDATE planets SET type = ?, weather = ?, sentinels = ?, flora = ?, fauna = ?,
             resources = ?, system_address = COALESCE(?, system_address),
             system_hint = COALESCE(?, system_hint),
             planet_index = COALESCE(?, planet_index),
             card_bases = COALESCE(?, card_bases),
             source = 'ocr', scanned_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .run(
          keep(data.planetType, existing.type),
          keep(data.weather, existing.weather),
          keep(data.sentinels, existing.sentinels),
          keep(data.flora, existing.flora),
          keep(data.fauna, existing.fauna),
          JSON.stringify(resources),
          systemAddress ?? null,
          data.systemHint ?? null,
          planetIndex,
          cardBases,
          existing.id
        )
      return rowToPlanet(this.db.prepare('SELECT * FROM planets WHERE id = ?').get(existing.id))
    }

    // A named scan in a system with claimable rows — save-import "Planet N"
    // stubs or nameless "Uncharted Planet" scans — is almost certainly one
    // of them: claim a row instead of growing the list (the slot choice
    // lives in choosePlaceholderSlot).
    if (systemAddress && data.name) {
      const candidates = this.db
        .prepare(
          'SELECT id, planet_index, source, type, name FROM planets WHERE system_address = ?'
        )
        .all(systemAddress)
        .filter(isClaimablePlanet)
        .map((r: SqliteRow) => ({ id: r.id as number, planetIndex: r.planet_index ?? null }))
      const baseRows = this.db
        .prepare('SELECT planet_index, base_type FROM bases WHERE system_address = ?')
        .all(systemAddress)
        .map((r: SqliteRow) => ({
          planetIndex: r.planet_index ?? null,
          baseType: r.base_type ?? ''
        }))
      const chosenId = choosePlaceholderSlot(candidates, baseRows, planetIndex, cardBases)
      if (chosenId !== null) {
        this.db
          .prepare(
            `UPDATE planets SET name = ?, type = ?, weather = ?, sentinels = ?, flora = ?,
               fauna = ?, resources = ?, system_hint = COALESCE(?, system_hint),
               planet_index = COALESCE(?, planet_index), card_bases = ?,
               source = 'ocr', scanned_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .run(
            data.name,
            data.planetType,
            data.weather,
            data.sentinels,
            data.flora,
            data.fauna,
            JSON.stringify(data.resources),
            data.systemHint ?? null,
            planetIndex,
            cardBases,
            chosenId
          )
        return rowToPlanet(this.db.prepare('SELECT * FROM planets WHERE id = ?').get(chosenId))
      }
    }

    const info = this.db
      .prepare(
        `INSERT INTO planets (system_address, name, type, weather, sentinels, flora, fauna, resources, system_hint, planet_index, card_bases)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        systemAddress ?? null,
        data.name || 'Uncharted Planet',
        data.planetType,
        data.weather,
        data.sentinels,
        data.flora,
        data.fauna,
        JSON.stringify(data.resources),
        data.systemHint ?? null,
        planetIndex,
        cardBases
      )
    const row = this.db.prepare('SELECT * FROM planets WHERE id = ?').get(info.lastInsertRowid)
    return rowToPlanet(row)
  }

  upsertDiscoveredPlanets(planets: DiscoveredPlanet[]): number {
    const byIndex = this.db.prepare(
      'SELECT id, name FROM planets WHERE system_address = ? AND planet_index = ?'
    )
    const byName = this.db.prepare(
      'SELECT id, system_address, planet_index FROM planets WHERE name = ?'
    )
    const rename = this.db.prepare('UPDATE planets SET name = ? WHERE id = ?')
    const link = this.db.prepare(
      'UPDATE planets SET system_address = ?, planet_index = ? WHERE id = ?'
    )
    const insert = this.db.prepare(
      `INSERT INTO planets (system_address, name, type, weather, sentinels, flora, fauna, resources, planet_index, source)
       VALUES (?, ?, 'Unknown', 'Unknown', 'Unknown', 'Unknown', 'Unknown', '[]', ?, 'save')`
    )
    let changed = 0
    const run = this.db.transaction((rows: DiscoveredPlanet[]) => {
      for (const p of rows) {
        const existing = byIndex.get(p.systemAddress, p.planetIndex)
        if (existing) {
          // Only a player-given rename may overwrite; OCR data stays intact.
          if (p.hasCustomName && existing.name !== p.name) {
            rename.run(p.name, existing.id)
            changed++
          }
          continue
        }
        if (p.hasCustomName) {
          // A prior OCR scan of the same planet: link instead of duplicating.
          const named = byName.get(p.name)
          if (named) {
            if (named.system_address !== p.systemAddress || named.planet_index !== p.planetIndex) {
              link.run(p.systemAddress, p.planetIndex, named.id)
              changed++
            }
            continue
          }
        }
        insert.run(p.systemAddress, p.name, p.planetIndex)
        changed++
      }
    })
    run(planets)
    return changed
  }

  mergePlaceholderPlanets(): number {
    const merges = planPlaceholderMerges(this.listPlanets(), this.listBases())
    if (merges.length === 0) return 0
    const claim = this.db.prepare('UPDATE planets SET planet_index = ? WHERE id = ?')
    const drop = this.db.prepare('DELETE FROM planets WHERE id = ?')
    const run = this.db.transaction(() => {
      for (const m of merges) {
        claim.run(m.planetIndex, m.keepId)
        drop.run(m.dropId)
      }
    })
    run()
    return merges.length
  }

  upsertBases(bases: ParsedBase[]): number {
    if (bases.length === 0) return 0
    // Bases are wholly save-owned (no user edits), so each touched system's
    // set is replaced outright — renames and demolished bases don't linger.
    // Systems from other save slots are never touched.
    const clear = this.db.prepare('DELETE FROM bases WHERE system_address = ?')
    const clearFreighters = this.db.prepare("DELETE FROM bases WHERE base_type = 'FreighterBase'")
    const insert = this.db.prepare(
      `INSERT INTO bases (system_address, planet_index, name, base_type, parts)
       VALUES (@systemAddress, @planetIndex, @name, @baseType, @parts)`
    )
    const run = this.db.transaction((rows: ParsedBase[]) => {
      // The freighter base travels with the freighter, so its address is just
      // wherever it was last summoned — copies left in previously visited
      // systems are stale, not extra bases. Newest save wins outright.
      if (rows.some((b) => b.baseType === 'FreighterBase')) clearFreighters.run()
      for (const address of new Set(rows.map((b) => b.systemAddress))) clear.run(address)
      for (const b of rows) {
        insert.run({
          systemAddress: b.systemAddress,
          planetIndex: b.planetIndex,
          name: b.name,
          baseType: b.baseType,
          parts: b.parts
        })
      }
    })
    run(bases)
    return bases.length
  }

  listBases(): BaseRecord[] {
    return this.db.prepare('SELECT * FROM bases ORDER BY parts DESC').all().map(rowToBase)
  }

  replaceInventories(containers: ParsedContainer[]): number {
    // Inventories are wholly save-owned and describe one character's stuff:
    // the snapshot is replaced outright, so the most recently written save
    // slot wins (matching how the current-location display behaves). An
    // empty extraction (old save format) must not wipe a good snapshot.
    if (containers.length === 0) return 0
    const insert = this.db.prepare(
      `INSERT INTO inventories (container_id, container_group, container_label, item_id, item_type, amount)
       VALUES (@containerId, @containerGroup, @containerLabel, @itemId, @itemType, @amount)`
    )
    let count = 0
    const run = this.db.transaction((rows: ParsedContainer[]) => {
      this.db.prepare('DELETE FROM inventories').run()
      for (const container of rows) {
        for (const item of container.items) {
          insert.run({
            containerId: container.containerId,
            containerGroup: container.group,
            containerLabel: container.label,
            itemId: item.itemId,
            itemType: item.itemType,
            amount: item.amount
          })
          count++
        }
      }
    })
    run(containers)
    return count
  }

  listInventories(): InventoryItemRecord[] {
    return this.db
      .prepare('SELECT * FROM inventories ORDER BY container_id, amount DESC')
      .all()
      .map(rowToInventoryItem)
  }

  listPlanets(): PlanetRecord[] {
    return this.db.prepare('SELECT * FROM planets ORDER BY scanned_at DESC').all().map(rowToPlanet)
  }

  setPlanetSystem(id: number, systemAddress: string | null): PlanetRecord | null {
    this.db.prepare('UPDATE planets SET system_address = ? WHERE id = ?').run(systemAddress, id)
    const row = this.db.prepare('SELECT * FROM planets WHERE id = ?').get(id)
    return row ? rowToPlanet(row) : null
  }

  deletePlanet(id: number): boolean {
    return this.db.prepare('DELETE FROM planets WHERE id = ?').run(id).changes > 0
  }

  listGuildStandings(): GuildStanding[] {
    return this.db
      .prepare('SELECT * FROM guild_standings')
      .all()
      .map((row: SqliteRow) => ({ guild: row.guild, rank: row.rank, updatedAt: row.updated_at }))
  }

  setGuildStanding(guild: Exclude<GuildType, null>, rank: string): GuildStanding {
    this.db
      .prepare(
        `INSERT INTO guild_standings (guild, rank) VALUES (?, ?)
         ON CONFLICT(guild) DO UPDATE SET rank = excluded.rank, updated_at = CURRENT_TIMESTAMP`
      )
      .run(guild, rank)
    const row = this.db.prepare('SELECT * FROM guild_standings WHERE guild = ?').get(guild)
    return { guild: row.guild, rank: row.rank, updatedAt: row.updated_at }
  }

  close(): void {
    this.db.close()
  }
}

interface JsonShape {
  systems: SystemRecord[]
  planets: PlanetRecord[]
  bases: BaseRecord[]
  inventories: InventoryItemRecord[]
  guildStandings: GuildStanding[]
  nextPlanetId: number
  nextBaseId: number
  nextInventoryId: number
}

class JsonStore implements CatalogueStore {
  readonly backend = 'json' as const
  private data: JsonShape
  private readonly path: string

  constructor(filePath: string) {
    this.path = filePath
    this.data = {
      systems: [],
      planets: [],
      bases: [],
      inventories: [],
      guildStandings: [],
      nextPlanetId: 1,
      nextBaseId: 1,
      nextInventoryId: 1
    }
    if (existsSync(filePath)) {
      try {
        this.data = { ...this.data, ...JSON.parse(readFileSync(filePath, 'utf8')) }
        // Backfill fields added after the store was first written.
        for (const sys of this.data.systems) {
          sys.envoyItems ??= []
          sys.economy ??= null
          sys.conflict ??= null
          sys.race ??= null
          sys.station ??= 'normal'
          sys.discoveredBy ??= null
          sys.discoveredAt ??= null
        }
        for (const planet of this.data.planets) {
          planet.planetIndex ??= null
          planet.source ??= 'ocr'
          planet.systemHint ??= null
          planet.cardBases ??= null
        }
      } catch {
        // Corrupt store: keep the bad file aside rather than silently losing it.
        renameSync(filePath, `${filePath}.corrupt-${Date.now()}`)
      }
    }
  }

  private flush(): void {
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.path)
  }

  upsertSystems(systems: ParsedSystem[]): number {
    const now = new Date().toISOString()
    for (const sys of systems) {
      const existing = this.data.systems.find(
        (s) => s.universalAddress === sys.universalAddress
      )
      if (existing) {
        if (sys.name !== 'Unknown System') existing.name = sys.name
        existing.galaxy = sys.galaxy ?? existing.galaxy
        existing.voxelX = sys.voxelX ?? existing.voxelX
        existing.voxelY = sys.voxelY ?? existing.voxelY
        existing.voxelZ = sys.voxelZ ?? existing.voxelZ
        existing.solarSystemIndex = sys.solarSystemIndex ?? existing.solarSystemIndex
        existing.discoveredBy = sys.discoveredBy ?? existing.discoveredBy
        existing.discoveredAt = sys.discoveredAt ?? existing.discoveredAt
        existing.updatedAt = now
      } else {
        this.data.systems.push({
          ...sys,
          isBlackHole: false,
          guildType: null,
          station: 'normal',
          offersSfm: false,
          multiToolSClass: false,
          economy: null,
          conflict: null,
          race: null,
          customTags: [],
          envoyItems: [],
          notes: '',
          updatedAt: now
        })
      }
    }
    this.flush()
    return systems.length
  }

  setSystemNameIfUnknown(universalAddress: string, name: string): boolean {
    const sys = this.data.systems.find((s) => s.universalAddress === universalAddress)
    if (!sys || sys.name !== 'Unknown System') return false
    sys.name = name
    sys.updatedAt = new Date().toISOString()
    this.flush()
    return true
  }

  setPlanetNameIfPlaceholder(systemAddress: string, planetIndex: number, name: string): boolean {
    const planet = this.data.planets.find(
      (p) =>
        p.systemAddress === systemAddress &&
        p.planetIndex === planetIndex &&
        p.name === `Planet ${planetIndex}`
    )
    if (!planet) return false
    planet.name = name
    this.flush()
    return true
  }

  deleteSystem(universalAddress: string): boolean {
    const index = this.data.systems.findIndex((s) => s.universalAddress === universalAddress)
    if (index < 0) return false
    this.data.systems.splice(index, 1)
    this.data.planets = this.data.planets.filter(
      (p) => !(p.systemAddress === universalAddress && p.source === 'save')
    )
    for (const p of this.data.planets) {
      if (p.systemAddress === universalAddress) p.systemAddress = null
    }
    this.data.bases = this.data.bases.filter((b) => b.systemAddress !== universalAddress)
    this.flush()
    return true
  }

  patchSystem(universalAddress: string, patch: SystemPatch): SystemRecord | null {
    const sys = this.data.systems.find((s) => s.universalAddress === universalAddress)
    if (!sys) return null
    if (patch.guildType !== undefined) sys.guildType = patch.guildType
    if (patch.station !== undefined) sys.station = patch.station
    if (patch.offersSfm !== undefined) sys.offersSfm = patch.offersSfm
    if (patch.multiToolSClass !== undefined) sys.multiToolSClass = patch.multiToolSClass
    if (patch.isBlackHole !== undefined) sys.isBlackHole = patch.isBlackHole
    if (patch.customTags !== undefined) sys.customTags = patch.customTags
    if (patch.envoyItems !== undefined) sys.envoyItems = patch.envoyItems
    if (patch.notes !== undefined) sys.notes = patch.notes
    if (patch.economy !== undefined) sys.economy = patch.economy
    if (patch.conflict !== undefined) sys.conflict = patch.conflict
    if (patch.race !== undefined) sys.race = patch.race
    sys.updatedAt = new Date().toISOString()
    this.flush()
    return sys
  }

  listSystems(): SystemRecord[] {
    return [...this.data.systems].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  insertPlanet(
    data: ParsedPlanetData,
    systemAddress?: string | null,
    evidence?: PlanetEvidence
  ): PlanetRecord {
    const planetIndex = evidence?.planetIndex ?? null
    const cardBases = evidence?.cardBases ?? null

    const existing = data.name
      ? this.data.planets.find((p) => p.name === data.name)
      : undefined

    // A base-anchored index is certain; whoever holds that slot guessed it
    // (see SqliteStore.insertPlanet).
    if (systemAddress && planetIndex !== null) {
      const holder = this.data.planets.find(
        (p) => p.systemAddress === systemAddress && p.planetIndex === planetIndex
      )
      if (holder && holder !== existing) {
        if (!isClaimablePlanet(holder)) holder.planetIndex = null
        else if (existing) this.data.planets = this.data.planets.filter((p) => p !== holder)
      }
    }

    if (existing) {
      // Weak reads ('Unknown' fields) must not clobber earlier full scans.
      const keep = (incoming: string, current: string): string =>
        incoming !== 'Unknown' ? incoming : current
      existing.type = keep(data.planetType, existing.type)
      existing.weather = keep(data.weather, existing.weather)
      existing.sentinels = keep(data.sentinels, existing.sentinels)
      existing.flora = keep(data.flora, existing.flora)
      existing.fauna = keep(data.fauna, existing.fauna)
      if (data.resources.length > 0) existing.resources = data.resources
      existing.systemAddress = systemAddress ?? existing.systemAddress
      existing.systemHint = data.systemHint ?? existing.systemHint
      existing.planetIndex = planetIndex ?? existing.planetIndex
      existing.cardBases = cardBases ?? existing.cardBases
      existing.source = 'ocr'
      existing.scannedAt = new Date().toISOString()
      this.flush()
      return existing
    }

    // Claim a save-import stub or nameless-scan row when one exists (the
    // slot choice lives in choosePlaceholderSlot).
    if (systemAddress && data.name) {
      const claimable = this.data.planets.filter(
        (p) => p.systemAddress === systemAddress && isClaimablePlanet(p)
      )
      const chosenId = choosePlaceholderSlot(
        claimable.map((p) => ({ id: p.id, planetIndex: p.planetIndex })),
        this.data.bases
          .filter((b) => b.systemAddress === systemAddress)
          .map((b) => ({ planetIndex: b.planetIndex, baseType: b.baseType })),
        planetIndex,
        cardBases
      )
      const placeholder = claimable.find((p) => p.id === chosenId)
      if (placeholder) {
        placeholder.name = data.name
        placeholder.type = data.planetType
        placeholder.weather = data.weather
        placeholder.sentinels = data.sentinels
        placeholder.flora = data.flora
        placeholder.fauna = data.fauna
        placeholder.resources = data.resources
        placeholder.systemHint = data.systemHint ?? placeholder.systemHint
        placeholder.planetIndex = planetIndex ?? placeholder.planetIndex
        placeholder.cardBases = cardBases
        placeholder.source = 'ocr'
        placeholder.scannedAt = new Date().toISOString()
        this.flush()
        return placeholder
      }
    }

    const planet: PlanetRecord = {
      id: this.data.nextPlanetId++,
      systemAddress: systemAddress ?? null,
      name: data.name || 'Uncharted Planet',
      type: data.planetType,
      weather: data.weather,
      sentinels: data.sentinels,
      flora: data.flora,
      fauna: data.fauna,
      resources: data.resources,
      planetIndex,
      source: 'ocr',
      systemHint: data.systemHint ?? null,
      cardBases,
      scannedAt: new Date().toISOString()
    }
    this.data.planets.push(planet)
    this.flush()
    return planet
  }

  upsertDiscoveredPlanets(planets: DiscoveredPlanet[]): number {
    let changed = 0
    for (const p of planets) {
      const existing = this.data.planets.find(
        (row) => row.systemAddress === p.systemAddress && row.planetIndex === p.planetIndex
      )
      if (existing) {
        // Only a player-given rename may overwrite; OCR data stays intact.
        if (p.hasCustomName && existing.name !== p.name) {
          existing.name = p.name
          changed++
        }
        continue
      }
      if (p.hasCustomName) {
        // A prior OCR scan of the same planet: link instead of duplicating.
        const named = this.data.planets.find((row) => row.name === p.name)
        if (named) {
          if (named.systemAddress !== p.systemAddress || named.planetIndex !== p.planetIndex) {
            named.systemAddress = p.systemAddress
            named.planetIndex = p.planetIndex
            changed++
          }
          continue
        }
      }
      this.data.planets.push({
        id: this.data.nextPlanetId++,
        systemAddress: p.systemAddress,
        name: p.name,
        type: 'Unknown',
        weather: 'Unknown',
        sentinels: 'Unknown',
        flora: 'Unknown',
        fauna: 'Unknown',
        resources: [],
        planetIndex: p.planetIndex,
        source: 'save',
        systemHint: null,
        cardBases: null,
        scannedAt: new Date().toISOString()
      })
      changed++
    }
    if (changed > 0) this.flush()
    return changed
  }

  upsertBases(bases: ParsedBase[]): number {
    if (bases.length === 0) return 0
    // Save-owned data: replace each touched system's set (see SqliteStore).
    // Freighter bases travel with the freighter — old copies are stale.
    const touched = new Set(bases.map((b) => b.systemAddress))
    const hasFreighter = bases.some((b) => b.baseType === 'FreighterBase')
    this.data.bases = this.data.bases.filter(
      (b) => !touched.has(b.systemAddress) && !(hasFreighter && b.baseType === 'FreighterBase')
    )
    const now = new Date().toISOString()
    for (const b of bases) {
      this.data.bases.push({
        id: this.data.nextBaseId++,
        systemAddress: b.systemAddress,
        planetIndex: b.planetIndex,
        name: b.name,
        baseType: b.baseType,
        parts: b.parts,
        updatedAt: now
      })
    }
    this.flush()
    return bases.length
  }

  listBases(): BaseRecord[] {
    return [...this.data.bases].sort((a, b) => b.parts - a.parts)
  }

  replaceInventories(containers: ParsedContainer[]): number {
    // Save-owned snapshot: replace outright, newest slot wins (see
    // SqliteStore). An empty extraction must not wipe a good snapshot.
    if (containers.length === 0) return 0
    const now = new Date().toISOString()
    this.data.inventories = []
    for (const container of containers) {
      for (const item of container.items) {
        this.data.inventories.push({
          id: this.data.nextInventoryId++,
          containerId: container.containerId,
          containerGroup: container.group,
          containerLabel: container.label,
          itemId: item.itemId,
          itemType: item.itemType,
          amount: item.amount,
          updatedAt: now
        })
      }
    }
    this.flush()
    return this.data.inventories.length
  }

  listInventories(): InventoryItemRecord[] {
    return [...this.data.inventories].sort(
      (a, b) => a.containerId.localeCompare(b.containerId) || b.amount - a.amount
    )
  }

  mergePlaceholderPlanets(): number {
    const merges = planPlaceholderMerges(this.data.planets, this.data.bases)
    if (merges.length === 0) return 0
    for (const m of merges) {
      const keep = this.data.planets.find((p) => p.id === m.keepId)
      if (keep) keep.planetIndex = m.planetIndex
      this.data.planets = this.data.planets.filter((p) => p.id !== m.dropId)
    }
    this.flush()
    return merges.length
  }

  listPlanets(): PlanetRecord[] {
    return [...this.data.planets].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt))
  }

  setPlanetSystem(id: number, systemAddress: string | null): PlanetRecord | null {
    const planet = this.data.planets.find((p) => p.id === id)
    if (!planet) return null
    planet.systemAddress = systemAddress
    this.flush()
    return planet
  }

  deletePlanet(id: number): boolean {
    const before = this.data.planets.length
    this.data.planets = this.data.planets.filter((p) => p.id !== id)
    if (this.data.planets.length === before) return false
    this.flush()
    return true
  }

  listGuildStandings(): GuildStanding[] {
    return [...this.data.guildStandings]
  }

  setGuildStanding(guild: Exclude<GuildType, null>, rank: string): GuildStanding {
    const now = new Date().toISOString()
    let standing = this.data.guildStandings.find((s) => s.guild === guild)
    if (standing) {
      standing.rank = rank
      standing.updatedAt = now
    } else {
      standing = { guild, rank, updatedAt: now }
      this.data.guildStandings.push(standing)
    }
    this.flush()
    return standing
  }

  close(): void {
    this.flush()
  }
}

/** Open the catalogue store, preferring SQLite and falling back to JSON. */
export function openStore(userDataDir: string, baseName = 'catalogue'): CatalogueStore {
  try {
    return new SqliteStore(join(userDataDir, `${baseName}.db`))
  } catch (err) {
    console.warn(
      '[db] better-sqlite3 unavailable, falling back to JSON store:',
      err instanceof Error ? err.message : err
    )
    return new JsonStore(join(userDataDir, `${baseName}.json`))
  }
}
