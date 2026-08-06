/**
 * Watches %APPDATA%\HelloGames\NMS\ (Steam `st_*` / GOG `DefaultUser`
 * profile folders) for save.hg changes and syncs systems into the store.
 * Save files are only ever read — never written.
 */
import { watch, type FSWatcher } from 'chokidar'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import type {
  FreighterBattleState,
  FrigateRecord,
  LanguageProgressRecord,
  LocationInfo,
  SaveSlotInfo,
  SaveSyncResult,
  ShipRecord
} from '@shared/types'
import type { CatalogueStore } from './db'
import {
  extractBases,
  extractInventories,
  extractCurrentLocation,
  extractFreighterBattle,
  extractFrigates,
  extractLanguageProgress,
  extractPlanets,
  extractShips,
  extractSystems,
  loadSaveJson,
  type CurrentLocation
} from './saveParser'
import { slotIdentity } from './saveSlots'
import { SummaryNameTracker } from './summaryName'
import { relinkPlanetsByHint } from './systemMatcher'

const SAVE_FILE_RE = /^save\d*\.hg$/i

/**
 * A save read can land in the middle of the game rewriting the file: the
 * open fails with a sharing violation, or we get a truncated buffer that
 * fails to decompress/parse. Those are normal and self-heal on the next
 * attempt, so retry quietly; anything still failing after that is logged
 * and dropped rather than shown, since the next autosave supersedes it.
 */
const READ_RETRIES = 3
const RETRY_DELAY_MS = 600
const TRANSIENT_ERRNOS = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOENT', 'EMFILE', 'ENFILE'])
/** Signatures of a torn read: half a file decompresses/parses to nothing good. */
const TORN_READ_RE = /^LZ4:|Unexpected end of JSON input|Unexpected (token|non-whitespace)|save file is empty/i

/**
 * Scratch files the storage layer drops next to a save while committing it.
 * Xbox writes `data.stream` alongside `data` and holds it exclusively, so
 * chokidar's attempt to watch it fails with EBUSY every single save. They
 * are never save data, so keep them out of the watch entirely.
 */
function isScratchFile(path: string): boolean {
  return /\.(stream|tmp)$/i.test(path)
}

function isTransientReadFailure(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code
  if (typeof code === 'string' && TRANSIENT_ERRNOS.has(code)) return true
  return err instanceof Error && TORN_READ_RE.test(err.message)
}

/** True for a Game Pass save: <...>\xgs\<user>\Slot<N><Auto|Manual>\data */
function isGamePassSave(normalizedPath: string): boolean {
  return /\/xgs\/[^/]+\/Slot\d+(Auto|Manual)\/data$/i.test(normalizedPath)
}

function safeSubdirs(dir: string, predicate: (name: string) => boolean): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && predicate(e.name))
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/**
 * Save locations across platforms:
 * - Steam/GOG: %APPDATA%\HelloGames\NMS\{st_*, DefaultUser}\save*.hg
 * - Xbox Game Pass: %LOCALAPPDATA%\Packages\HelloGames.NoMansSky_*\
 *   SystemAppData\xgs\<user>\Slot<N>{Auto,Manual}\data (same .hg format)
 */
export function locateSaveDirs(): string[] {
  const dirs: string[] = []

  const appData = process.env.APPDATA
  if (appData) {
    const nmsRoot = join(appData, 'HelloGames', 'NMS')
    if (existsSync(nmsRoot)) {
      dirs.push(...safeSubdirs(nmsRoot, (n) => n.startsWith('st_') || n === 'DefaultUser'))
    }
  }

  const localAppData = process.env.LOCALAPPDATA
  if (localAppData) {
    const packages = join(localAppData, 'Packages')
    for (const pkg of safeSubdirs(packages, (n) => n.startsWith('HelloGames.NoMansSky'))) {
      const xgs = join(pkg, 'SystemAppData', 'xgs')
      dirs.push(...safeSubdirs(xgs, () => true))
    }
  }

  return dirs
}

export interface SaveWatcherOptions {
  /** Store to sync a given slot's save data into (per-slot catalogues). */
  storeFor: (slotId: string | null) => CatalogueStore
  /** Optional obfuscated->readable key mapping (userData/nms-keymap.json). */
  keyMapping?: Record<string, string>
  /** Pinned slot id restored from settings; null/undefined = newest save wins. */
  selectedSlot?: string | null
  onSync: (result: SaveSyncResult) => void
  /**
   * Only for the one problem the user can act on: no save directory found
   * at all. Per-file read and watch failures are retried and logged, never
   * shown — they resolve themselves on the next save.
   */
  onError: (message: string) => void
}

interface TrackedSlot extends SaveSlotInfo {
  /** Newest save file seen for this slot. */
  path: string
  mtimeMs: number
}

export class SaveWatcher {
  private watcher: FSWatcher | null = null
  private readonly opts: SaveWatcherOptions
  private location: LocationInfo | null = null
  private locationMtimeMs = 0
  /** Per-slot: newest save mtime whose inventory has been written. */
  private inventoryMtimes = new Map<string, number>()
  private ships: ShipRecord[] = []
  private shipsMtimeMs = 0
  private frigates: FrigateRecord[] = []
  private frigatesMtimeMs = 0
  private languages: LanguageProgressRecord[] = []
  private languagesMtimeMs = 0
  private battle: FreighterBattleState | null = null
  private battleMtimeMs = 0
  private slots = new Map<string, TrackedSlot>()
  private selectedSlot: string | null
  private summaryNames = new SummaryNameTracker()
  /** Pending retries of transient read failures, keyed by save path. */
  private retries = new Map<string, NodeJS.Timeout>

  constructor(opts: SaveWatcherOptions) {
    this.opts = opts
    this.selectedSlot = opts.selectedSlot ?? null
  }

  /** Best-known current location: the newest save slot wins. */
  currentLocation(): LocationInfo | null {
    return this.location
  }

  /** Every character slot seen on disk, most recently played first. */
  listSlots(): SaveSlotInfo[] {
    return [...this.slots.values()]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .map(({ id, label, savedAt, sizeBytes }) => ({ id, label, savedAt, sizeBytes }))
  }

  selectedSlotId(): string | null {
    return this.selectedSlot
  }

  /** Most recently written slot seen so far — the one being played. */
  newestSlotId(): string | null {
    return this.listSlots()[0]?.id ?? null
  }

  /** Owned-ship snapshot from the pinned (or newest) save slot. */
  listShips(): ShipRecord[] {
    return this.ships
  }

  /** Fleet-frigate snapshot from the pinned (or newest) save slot. */
  listFrigates(): FrigateRecord[] {
    return this.frigates
  }

  /** Language word-progress snapshot from the pinned (or newest) save slot. */
  listLanguageProgress(): LanguageProgressRecord[] {
    return this.languages
  }

  /** Space-battle cooldown snapshot from the pinned (or newest) save slot. */
  freighterBattle(): FreighterBattleState | null {
    return this.battle
  }

  /**
   * Pin the inventory/location snapshot to one slot (null = newest wins
   * again), then rebuild the snapshot immediately from that slot's latest
   * save so the UI doesn't wait for the next autosave.
   */
  setSlot(slotId: string | null): void {
    this.selectedSlot = slotId
    this.locationMtimeMs = 0
    this.shipsMtimeMs = 0
    this.frigatesMtimeMs = 0
    this.languagesMtimeMs = 0
    this.battleMtimeMs = 0
    this.location = null
    this.ships = []
    this.frigates = []
    this.languages = []
    this.battle = null
    const candidates = [...this.slots.values()]
      .filter((s) => slotId === null || s.id === slotId)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
    if (candidates.length > 0) this.syncFile(candidates[0].path)
  }

  /** Inventory/location may only come from the pinned slot, if one is set. */
  private slotAllowed(savePath: string): boolean {
    if (this.selectedSlot === null) return true
    return slotIdentity(savePath)?.id === this.selectedSlot
  }

  private trackSlot(savePath: string): void {
    const identity = slotIdentity(savePath)
    if (!identity) return
    let mtimeMs = Date.now()
    let sizeBytes = 0
    try {
      const stat = statSync(savePath)
      mtimeMs = stat.mtimeMs
      sizeBytes = stat.size
    } catch {
      /* keep defaults */
    }
    const known = this.slots.get(identity.id)
    if (known && known.mtimeMs >= mtimeMs) return
    this.slots.set(identity.id, {
      ...identity,
      path: savePath,
      mtimeMs,
      sizeBytes,
      savedAt: new Date(mtimeMs).toISOString()
    })
  }

  start(): string[] {
    const dirs = locateSaveDirs()
    if (dirs.length === 0) {
      this.opts.onError('No NMS save directory found under %APPDATA%\\HelloGames\\NMS')
      return []
    }

    this.watcher = watch(dirs, {
      ignoreInitial: false,
      depth: 2,
      ignored: (path) => isScratchFile(path),
      // Saves are written in bursts; wait until the game finishes flushing.
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 250 }
    })

    const handle = (path: string): void => {
      const normalized = path.replace(/\\/g, '/')
      const base = normalized.split('/').pop() ?? ''
      if (SAVE_FILE_RE.test(base) || isGamePassSave(normalized)) this.syncFile(path)
    }
    this.watcher.on('add', handle)
    this.watcher.on('change', handle)
    // Console only. Watch failures are per-file and transient — a save being
    // rewritten, a handle briefly locked — and the file is picked up again on
    // the next event. Surfacing them replaced the sync status with a warning
    // that had already resolved itself by the time it rendered.
    this.watcher.on('error', (err) =>
      console.warn(`[saveWatcher] watch failed: ${err instanceof Error ? err.message : err}`)
    )
    return dirs
  }

  /** Parse one save file and upsert into its slot's own store. Read-only. */
  syncFile(savePath: string, attempt = 0): void {
    clearTimeout(this.retries.get(savePath))
    this.retries.delete(savePath)
    try {
      this.trackSlot(savePath)
      // Each slot's data lands in that slot's catalogue.
      const slotId = slotIdentity(savePath)?.id ?? null
      const store = this.opts.storeFor(slotId)
      const raw = readFileSync(savePath)
      // A zero-byte read means the game has truncated the file and not
      // written the new contents yet — retryable, not a broken save.
      if (raw.length === 0) throw new Error('save file is empty')
      const saveRoot = loadSaveJson(raw, this.opts.keyMapping)
      const systems = extractSystems(saveRoot)
      const planets = extractPlanets(saveRoot)
      const bases = extractBases(saveRoot)

      // Planets and bases can reference systems the save has no SolarSystem
      // record for; synthesize stubs so their FK targets always exist.
      const known = new Set(systems.map((s) => s.universalAddress))
      for (const ref of [...planets, ...bases]) {
        if (known.has(ref.systemAddress)) continue
        known.add(ref.systemAddress)
        systems.push({
          universalAddress: ref.systemAddress,
          name: 'Unknown System',
          galaxy: ref.galaxy,
          voxelX: ref.voxelX,
          voxelY: ref.voxelY,
          voxelZ: ref.voxelZ,
          solarSystemIndex: ref.solarSystemIndex,
          discoveredBy: null,
          discoveredAt: null
        })
      }

      const count = systems.length > 0 ? store.upsertSystems(systems) : 0
      const planetCount = planets.length > 0 ? store.upsertDiscoveredPlanets(planets) : 0
      const baseCount = store.upsertBases(bases)
      const inSlot = this.slotAllowed(savePath)
      const inventoryCount = this.syncInventories(savePath, saveRoot, slotId, store)
      if (inSlot) this.syncShips(savePath, saveRoot)
      if (inSlot) this.syncFrigates(savePath, saveRoot)
      if (inSlot) this.syncLanguages(savePath, saveRoot)
      if (inSlot) this.syncFreighterBattle(savePath, saveRoot)
      // Newly arrived system names may resolve hints stored on planets that
      // were scanned before their system was catalogued; freshly imported
      // "Planet N" stubs may duplicate planets already scanned via OCR.
      const linked = count > 0 ? relinkPlanetsByHint(store) : 0
      const merged = store.mergePlaceholderPlanets()
      if (inSlot) this.updateLocation(savePath, saveRoot, store)
      if (count === 0 && planetCount === 0 && baseCount === 0 && !this.location) return

      this.opts.onSync({
        systemsUpserted: count,
        planetsUpserted: planetCount,
        basesUpserted: baseCount,
        inventoryItems: inventoryCount,
        planetsLinked: linked + merged,
        savePath,
        syncedAt: new Date().toISOString(),
        location: this.location,
        freighterBattle: this.battle
      })
    } catch (err) {
      if (attempt < READ_RETRIES && isTransientReadFailure(err)) {
        const timer = setTimeout(() => this.syncFile(savePath, attempt + 1), RETRY_DELAY_MS)
        // Don't hold the app open just to retry a save read.
        timer.unref?.()
        this.retries.set(savePath, timer)
        return
      }
      // Console only, never the UI: a save we can't read is almost always
      // one the game is mid-write on, and the next autosave supersedes it
      // within minutes. Replacing the sync status with a warning that
      // resolves itself is noise. onError stays for setup-level problems
      // (no save directory, dead watcher) that the user can act on.
      console.warn(
        `[saveWatcher] giving up on ${savePath}: ${err instanceof Error ? err.message : err}`
      )
    }
  }

  /**
   * Replace the slot's inventory snapshot from this save, unless a newer
   * save of the same slot has already provided one — a slot's auto and
   * manual saves fire in arbitrary order on startup.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private syncInventories(savePath: string, saveRoot: any, slotId: string | null, store: CatalogueStore): number {
    const containers = extractInventories(saveRoot)
    if (containers.length === 0) return 0
    let mtimeMs = Date.now()
    try {
      mtimeMs = statSync(savePath).mtimeMs
    } catch {
      /* keep now() */
    }
    const key = slotId ?? ''
    if (mtimeMs < (this.inventoryMtimes.get(key) ?? 0)) return 0
    this.inventoryMtimes.set(key, mtimeMs)
    return store.replaceInventories(containers)
  }

  /**
   * Replace the ship snapshot from this save; same newest-slot-wins gating
   * as the inventory snapshot, and an empty extraction (old save format)
   * never wipes a good snapshot.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private syncShips(savePath: string, saveRoot: any): void {
    const ships = extractShips(saveRoot)
    if (ships.length === 0) return
    let mtimeMs = Date.now()
    try {
      mtimeMs = statSync(savePath).mtimeMs
    } catch {
      /* keep now() */
    }
    if (mtimeMs < this.shipsMtimeMs) return
    this.shipsMtimeMs = mtimeMs
    this.ships = ships
  }

  /**
   * Replace the frigate snapshot from this save; same newest-slot-wins
   * gating as the ship snapshot, and an empty extraction (old save format,
   * or a character with no fleet yet) never wipes a good snapshot.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private syncFrigates(savePath: string, saveRoot: any): void {
    const frigates = extractFrigates(saveRoot)
    if (frigates.length === 0) return
    let mtimeMs = Date.now()
    try {
      mtimeMs = statSync(savePath).mtimeMs
    } catch {
      /* keep now() */
    }
    if (mtimeMs < this.frigatesMtimeMs) return
    this.frigatesMtimeMs = mtimeMs
    this.frigates = frigates
  }

  /**
   * Replace the language-progress snapshot from this save; same
   * newest-slot-wins gating, and an empty extraction (save format without
   * word data) never wipes a good snapshot.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private syncLanguages(savePath: string, saveRoot: any): void {
    const languages = extractLanguageProgress(saveRoot)
    if (languages.length === 0) return
    let mtimeMs = Date.now()
    try {
      mtimeMs = statSync(savePath).mtimeMs
    } catch {
      /* keep now() */
    }
    if (mtimeMs < this.languagesMtimeMs) return
    this.languagesMtimeMs = mtimeMs
    this.languages = languages
  }

  /**
   * Replace the space-battle cooldown snapshot from this save; same
   * newest-slot-wins gating as the other snapshots, and a save without the
   * fields never wipes a good snapshot.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private syncFreighterBattle(savePath: string, saveRoot: any): void {
    const battle = extractFreighterBattle(saveRoot)
    if (!battle) return
    let mtimeMs = Date.now()
    try {
      mtimeMs = statSync(savePath).mtimeMs
    } catch {
      /* keep now() */
    }
    if (mtimeMs < this.battleMtimeMs) return
    this.battleMtimeMs = mtimeMs
    this.battle = { ...battle, savedAt: new Date(mtimeMs).toISOString() }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private updateLocation(savePath: string, saveRoot: any, store: CatalogueStore): void {
    const loc = extractCurrentLocation(saveRoot)
    if (!loc) return
    let mtimeMs = Date.now()
    try {
      mtimeMs = statSync(savePath).mtimeMs
    } catch {
      /* keep now() */
    }
    if (mtimeMs < this.locationMtimeMs) return

    // Stationless, unrenamed systems have no name source besides the
    // summary text — harvest it once the tracker has confirmed the pair.
    const confirmed = this.summaryNames.observe(loc.universalAddress, loc.summary, mtimeMs)
    if (confirmed) this.applySummaryName(loc, confirmed, store)

    // Game Pass slots are directories ("Slot2Auto\data"); .hg files carry
    // the slot in the filename.
    const base = basename(savePath)
    const slot = base.toLowerCase() === 'data' ? basename(dirname(savePath)) : base

    const systemName =
      store.listSystems().find((s) => s.universalAddress === loc.universalAddress)?.name ?? null

    this.locationMtimeMs = mtimeMs
    this.location = {
      universalAddress: loc.universalAddress,
      summary: loc.summary,
      systemName: systemName === 'Unknown System' ? null : systemName,
      galaxy: loc.galaxy,
      planetIndex: loc.planetIndex,
      slot,
      savedAt: new Date(mtimeMs).toISOString()
    }
  }

  /** Name the current system from its confirmed summary; never overwrites a
   *  name that came from a station endpoint or a player rename. */
  private applySummaryName(loc: CurrentLocation, name: string, store: CatalogueStore): void {
    const existing = store
      .listSystems()
      .find((s) => s.universalAddress === loc.universalAddress)
    if (existing && existing.name !== 'Unknown System') return
    store.upsertSystems([
      {
        universalAddress: loc.universalAddress,
        name,
        galaxy: loc.galaxy,
        voxelX: loc.voxelX,
        voxelY: loc.voxelY,
        voxelZ: loc.voxelZ,
        solarSystemIndex: loc.solarSystemIndex,
        discoveredBy: null,
        discoveredAt: null
      }
    ])
    // The fresh name may resolve OCR scans that stored it as a text hint.
    relinkPlanetsByHint(store)
  }

  async stop(): Promise<void> {
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
    await this.watcher?.close()
    this.watcher = null
  }
}
