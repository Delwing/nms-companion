/**
 * Live item catalogue from the Assistant for No Man's Sky project
 * (github.com/AssistantNMS/App): game-extracted datasets fetched as raw
 * JSON and cached on disk, so values survive game patches without a
 * rebuild and the app still works fully offline.
 *
 * Datasets are generic — trade items are wired first, further families
 * (Products, RawMaterials, Cooking, ...) just need an entry in DATASETS.
 * Live entries are matched back to save-file item ids by normalised
 * display name (plus a small override table where the community names
 * diverge) and merged over the bundled static table in itemInfo.ts.
 *
 * The same datasets also feed hover tooltips: itemDetails() builds a
 * name-keyed map of group/description/colour/value, and icon() serves
 * the item's PNG (fetched once, cached under cacheDir/images).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
// Relative imports (not @shared alias): runtime dependencies, and the test
// build's tsc output does not rewrite path aliases.
import { ITEM_NAMES, normaliseItemName } from '../../shared/itemNames'
import { itemInfoTuple, type ItemInfoTuple } from '../../shared/itemInfo'
import type { ItemDetail } from '../../shared/types'

/** AssistantNMS dataset files under assets/json/en, keyed by family. */
export const DATASETS: Record<string, string> = {
  tradeItems: 'TradeItems.lang.json'
}

/**
 * Datasets feeding the tooltip detail map, in priority order — when a
 * display name appears in several families the earliest file wins, so
 * canonical substances beat cooking/product homonyms.
 */
export const DETAIL_DATASETS: string[] = [
  'RawMaterials.lang.json',
  'TradeItems.lang.json',
  'Products.lang.json',
  'Curiosity.lang.json',
  'Cooking.lang.json',
  'Technology.lang.json',
  'Others.lang.json'
]

const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/AssistantNMS/App/master/assets/json/en'
const DEFAULT_IMAGES_URL =
  'https://raw.githubusercontent.com/AssistantNMS/App/master/assets/images'
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // game data changes on game patches, not daily

/** The subset of an AssistantNMS item entry this app consumes. */
export interface AssistantNmsEntry {
  Id: string
  Icon?: string
  Name: string
  Group: string
  Description?: string
  BaseValueUnits: number
  CurrencyType: string
  MaxStackSize?: number
  Colour?: string
  CdnUrl?: string
}

/** AssistantNMS display name -> save-file id, where name matching fails. */
const NAME_OVERRIDES: Record<string, string> = {
  '5D Torus': 'TRA_ALLOY4',
  'Mesh Decouplers': 'TRA_COMPONENT3',
  'Vector Compressors': 'TRA_COMPONENT5',
  'De-Scented Bottles': 'TRA_EXOTICS1',
  'Decommissioned Circuits': 'TRA_TECH1'
}

const CURRENCY_CODE: Record<string, number> = { Credits: 0, Nanites: 1, Quicksilver: 2 }

const normalise = normaliseItemName

let nameToId: Map<string, string> | null = null

/** Reverse ITEM_NAMES (first id wins on shared display names). */
function reverseNameMap(): Map<string, string> {
  if (!nameToId) {
    nameToId = new Map()
    for (const [id, name] of Object.entries(ITEM_NAMES)) {
      const key = normalise(name)
      if (!nameToId.has(key)) nameToId.set(key, id)
    }
  }
  return nameToId
}

/**
 * Match live entries to save-file item ids and pack them as itemInfo
 * tuples. The live value/group wins; usage flags come from the static
 * table, with the trade-good bit set for trade/smuggled families.
 */
export function buildLiveTuples(entries: AssistantNmsEntry[]): Record<string, ItemInfoTuple> {
  const byName = reverseNameMap()
  const tuples: Record<string, ItemInfoTuple> = {}
  for (const entry of entries) {
    const gameId = NAME_OVERRIDES[entry.Name] ?? byName.get(normalise(entry.Name))
    if (!gameId) continue
    const isTrade = entry.Group.startsWith('Trade Goods') || entry.Group === 'Smuggled Goods'
    const staticFlags = itemInfoTuple(gameId)?.[3] ?? 0
    tuples[gameId] = [
      entry.BaseValueUnits,
      CURRENCY_CODE[entry.CurrencyType] ?? 0,
      entry.Group,
      (staticFlags & ~1) | (isTrade ? 1 : 0)
    ]
  }
  return tuples
}

/**
 * Merge dataset entries into the tooltip detail map, keyed by normalised
 * display name. Lists arrive in priority order and the first entry
 * claiming a name wins.
 */
export function buildItemDetails(datasets: AssistantNmsEntry[][]): Record<string, ItemDetail> {
  const details: Record<string, ItemDetail> = {}
  for (const entries of datasets) {
    for (const entry of entries) {
      const key = normalise(entry.Name)
      if (!key || details[key]) continue
      details[key] = {
        name: entry.Name,
        group: entry.Group,
        description: entry.Description ?? '',
        colour: entry.Colour ?? null,
        baseValue: entry.BaseValueUnits,
        currency: CURRENCY_CODE[entry.CurrencyType] ?? 0,
        icon: entry.Icon ?? null
      }
    }
  }
  return details
}

interface CacheMeta {
  etag: string | null
  fetchedAt: number
}

export interface AssistantNmsOptions {
  /** Directory for cached dataset JSON (created on demand). */
  cacheDir: string
  baseUrl?: string
  /** Base URL for item icon PNGs (AssistantNMS assets/images tree). */
  imagesBaseUrl?: string
  ttlMs?: number
  fetchImpl?: typeof fetch
}

export interface AssistantNmsService {
  /** Parsed dataset (network or cache), or null when neither is available. */
  dataset(file: string): Promise<AssistantNmsEntry[] | null>
  /** Live item tuples for every wired dataset, keyed by save-file item id. */
  liveItemInfo(): Promise<Record<string, ItemInfoTuple>>
  /** Tooltip details keyed by normalised display name; empty offline with a cold cache. */
  itemDetails(): Promise<Record<string, ItemDetail>>
  /** Icon PNG as a data URL (disk-cached), or null when unavailable. */
  icon(iconPath: string): Promise<string | null>
}

/** Icon paths come from the datasets, but never trust them with the filesystem. */
const ICON_PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*(\/[A-Za-z0-9][A-Za-z0-9_-]*)*\.png$/

export function createAssistantNms(options: AssistantNmsOptions): AssistantNmsService {
  const { cacheDir, baseUrl = DEFAULT_BASE_URL, ttlMs = DEFAULT_TTL_MS } = options
  const imagesBaseUrl = options.imagesBaseUrl ?? DEFAULT_IMAGES_URL
  const fetchImpl = options.fetchImpl ?? fetch
  const inFlight = new Map<string, Promise<AssistantNmsEntry[] | null>>()
  const iconsInFlight = new Map<string, Promise<string | null>>()
  let detailsPromise: Promise<Record<string, ItemDetail>> | null = null

  function readCache(file: string): { entries: AssistantNmsEntry[]; meta: CacheMeta } | null {
    try {
      const entries = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'))
      const meta = JSON.parse(readFileSync(join(cacheDir, `${file}.meta.json`), 'utf8'))
      if (Array.isArray(entries)) return { entries, meta }
    } catch {
      // missing or corrupt cache — refetch
    }
    return null
  }

  function writeCache(file: string, body: string | null, meta: CacheMeta): void {
    mkdirSync(cacheDir, { recursive: true })
    if (body !== null) writeFileSync(join(cacheDir, file), body, 'utf8')
    writeFileSync(join(cacheDir, `${file}.meta.json`), JSON.stringify(meta), 'utf8')
  }

  async function refresh(file: string): Promise<AssistantNmsEntry[] | null> {
    const cached = readCache(file)
    if (cached && Date.now() - cached.meta.fetchedAt < ttlMs) return cached.entries

    try {
      const headers: Record<string, string> = {}
      if (cached?.meta.etag) headers['If-None-Match'] = cached.meta.etag
      const res = await fetchImpl(`${baseUrl}/${file}`, { headers })
      if (res.status === 304 && cached) {
        writeCache(file, null, { ...cached.meta, fetchedAt: Date.now() })
        return cached.entries
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.text()
      const entries = JSON.parse(body)
      if (!Array.isArray(entries)) throw new Error('unexpected payload shape')
      writeCache(file, body, { etag: res.headers.get('etag'), fetchedAt: Date.now() })
      console.log(`[assistantnms] refreshed ${file} (${entries.length} entries)`)
      return entries
    } catch (err) {
      // Offline or upstream trouble: stale data beats no data.
      console.warn(`[assistantnms] using ${cached ? 'stale cache' : 'bundled data'} for ${file}:`, err)
      return cached?.entries ?? null
    }
  }

  function dataset(file: string): Promise<AssistantNmsEntry[] | null> {
    let pending = inFlight.get(file)
    if (!pending) {
      pending = refresh(file).finally(() => inFlight.delete(file))
      inFlight.set(file, pending)
    }
    return pending
  }

  async function liveItemInfo(): Promise<Record<string, ItemInfoTuple>> {
    const merged: Record<string, ItemInfoTuple> = {}
    for (const file of Object.values(DATASETS)) {
      const entries = await dataset(file)
      if (entries) Object.assign(merged, buildLiveTuples(entries))
    }
    return merged
  }

  function itemDetails(): Promise<Record<string, ItemDetail>> {
    detailsPromise ??= (async () => {
      const lists = await Promise.all(DETAIL_DATASETS.map((file) => dataset(file)))
      const details = buildItemDetails(
        lists.filter((list): list is AssistantNmsEntry[] => list !== null)
      )
      // A cold cache while offline yields nothing — leave the door open to
      // retry once the network is back instead of memoising the miss.
      if (Object.keys(details).length === 0) detailsPromise = null
      return details
    })()
    return detailsPromise
  }

  const toDataUrl = (buf: Buffer): string => `data:image/png;base64,${buf.toString('base64')}`

  async function fetchIcon(iconPath: string): Promise<string | null> {
    const diskPath = join(cacheDir, 'images', iconPath)
    try {
      return toDataUrl(readFileSync(diskPath))
    } catch {
      // not cached yet
    }
    try {
      const res = await fetchImpl(`${imagesBaseUrl}/${iconPath}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      mkdirSync(dirname(diskPath), { recursive: true })
      writeFileSync(diskPath, buf)
      return toDataUrl(buf)
    } catch (err) {
      console.warn(`[assistantnms] icon fetch failed for ${iconPath}:`, err)
      return null
    }
  }

  function icon(iconPath: string): Promise<string | null> {
    if (!ICON_PATH_RE.test(iconPath)) return Promise.resolve(null)
    let pending = iconsInFlight.get(iconPath)
    if (!pending) {
      // Failures are not memoised: the disk cache remembers successes and a
      // later hover may find the network back.
      pending = fetchIcon(iconPath).finally(() => iconsInFlight.delete(iconPath))
      iconsInFlight.set(iconPath, pending)
    }
    return pending
  }

  return { dataset, liveItemInfo, itemDetails, icon }
}
