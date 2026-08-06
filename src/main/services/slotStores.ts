/**
 * One catalogue store per character slot, so each character's systems,
 * planets, bases, inventory and guild standings stay separate. The active
 * (displayed) store follows the pinned slot, or the most recently written
 * save when nothing is pinned — i.e. the character being played.
 *
 * Databases live in userData/slots/<encoded-slot-id>.{db,json}. A legacy
 * shared catalogue (userData/catalogue.*) is migrated once into the newest
 * slot's store, pruning bare address-only systems that other slots
 * contributed; the original files are kept as *.pre-slots backups.
 */
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'fs'
import { join } from 'path'
import { isBareUnknownSystem } from '../../shared/systemStubs'
import { openStore, type CatalogueStore } from './db'
import { encodeSlotId } from './saveSlots'

export class SlotStores {
  private readonly stores = new Map<string, CatalogueStore>()
  private fallback: CatalogueStore | null = null

  constructor(private readonly userDataDir: string) {}

  private slotsDir(): string {
    return join(this.userDataDir, 'slots')
  }

  /** The store for one slot; null = no slot known (no saves found), which
   *  falls back to the legacy shared location. */
  storeFor(slotId: string | null): CatalogueStore {
    if (slotId === null) {
      this.fallback ??= openStore(this.userDataDir)
      return this.fallback
    }
    let store = this.stores.get(slotId)
    if (!store) {
      mkdirSync(this.slotsDir(), { recursive: true })
      store = openStore(this.slotsDir(), encodeSlotId(slotId))
      this.stores.set(slotId, store)
    }
    return store
  }

  /**
   * One-time migration of the legacy shared catalogue into the given slot's
   * store (the newest slot — the one the accumulated data almost entirely
   * describes). Bare address-only systems are pruned: they either belong to
   * this slot and re-import on the next save sync, or they were another
   * slot's contribution and don't belong here. User metadata, names and
   * OCR planets are preserved.
   */
  migrateLegacy(newestSlotId: string): void {
    if (existsSync(this.slotsDir())) return // migrated (or fresh per-slot install)
    const legacyDb = join(this.userDataDir, 'catalogue.db')
    const legacyJson = join(this.userDataDir, 'catalogue.json')
    if (!existsSync(legacyDb) && !existsSync(legacyJson)) return

    // Open+close the legacy store first so a sqlite WAL is checkpointed
    // into the main file before it is copied.
    openStore(this.userDataDir).close()

    mkdirSync(this.slotsDir(), { recursive: true })
    const encoded = encodeSlotId(newestSlotId)
    if (existsSync(legacyDb)) copyFileSync(legacyDb, join(this.slotsDir(), `${encoded}.db`))
    if (existsSync(legacyJson)) copyFileSync(legacyJson, join(this.slotsDir(), `${encoded}.json`))

    const store = this.storeFor(newestSlotId)
    const ocrPlanets = new Map<string, number>()
    for (const planet of store.listPlanets()) {
      if (planet.systemAddress && planet.source === 'ocr') {
        ocrPlanets.set(planet.systemAddress, (ocrPlanets.get(planet.systemAddress) ?? 0) + 1)
      }
    }
    let pruned = 0
    for (const system of store.listSystems()) {
      if (isBareUnknownSystem(system, ocrPlanets.get(system.universalAddress) ?? 0)) {
        if (store.deleteSystem(system.universalAddress)) pruned++
      }
    }
    console.log(`[slots] migrated legacy catalogue -> ${encoded} (${pruned} bare systems pruned)`)

    if (existsSync(legacyDb)) renameSync(legacyDb, `${legacyDb}.pre-slots`)
    if (existsSync(legacyJson)) renameSync(legacyJson, `${legacyJson}.pre-slots`)
  }

  closeAll(): void {
    for (const store of this.stores.values()) store.close()
    this.stores.clear()
    this.fallback?.close()
    this.fallback = null
  }
}
