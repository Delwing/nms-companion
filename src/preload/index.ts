import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  BaseRecord,
  FreighterBattleState,
  FrigateRecord,
  GuildStanding,
  GuildType,
  HarvestResult,
  InventoryItemRecord,
  ItemDetail,
  LanguageProgressRecord,
  LocationInfo,
  OcrScanResult,
  OcrStatus,
  PlanetRecord,
  PlatformSupport,
  SaveSlotState,
  SaveSyncResult,
  ShipRecord,
  SystemPatch,
  SystemRecord
} from '@shared/types'
import type { ItemInfoTuple } from '@shared/itemInfo'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  listSystems: (): Promise<SystemRecord[]> => ipcRenderer.invoke('systems:list'),
  patchSystem: (address: string, patch: SystemPatch): Promise<SystemRecord | null> =>
    ipcRenderer.invoke('systems:patch', address, patch),
  /** Experimental: pull procedural names for unnamed systems from the
   *  running game's memory (read-only scan; NMS must be running). */
  harvestNames: (): Promise<HarvestResult> => ipcRenderer.invoke('systems:harvestNames'),
  listPlanets: (): Promise<PlanetRecord[]> => ipcRenderer.invoke('planets:list'),
  listBases: (): Promise<BaseRecord[]> => ipcRenderer.invoke('bases:list'),
  listInventories: (): Promise<InventoryItemRecord[]> => ipcRenderer.invoke('inventories:list'),
  /** Owned starships from the pinned (or newest) save slot. */
  listShips: (): Promise<ShipRecord[]> => ipcRenderer.invoke('ships:list'),
  /** Fleet frigates from the pinned (or newest) save slot. */
  listFrigates: (): Promise<FrigateRecord[]> => ipcRenderer.invoke('frigates:list'),
  /** Per-language word-learning progress from the pinned (or newest) save slot. */
  listLanguageProgress: (): Promise<LanguageProgressRecord[]> =>
    ipcRenderer.invoke('languages:list'),
  /** Space-battle cooldown snapshot from the pinned (or newest) save slot. */
  getFreighterBattle: (): Promise<FreighterBattleState | null> =>
    ipcRenderer.invoke('freighterBattle:get'),
  /** Live AssistantNMS item tuples by game id (cached; may be empty offline). */
  liveItemInfo: (): Promise<Record<string, ItemInfoTuple>> => ipcRenderer.invoke('items:liveInfo'),
  /** Tooltip details keyed by normalised display name (cached; may be empty offline). */
  itemDetails: (): Promise<Record<string, ItemDetail>> => ipcRenderer.invoke('items:details'),
  /** Item icon PNG as a data URL, disk-cached in the main process. */
  itemIcon: (iconPath: string): Promise<string | null> =>
    ipcRenderer.invoke('items:icon', iconPath),
  assignPlanetSystem: (id: number, systemAddress: string | null): Promise<PlanetRecord | null> =>
    ipcRenderer.invoke('planets:assignSystem', id, systemAddress),
  deletePlanet: (id: number): Promise<boolean> => ipcRenderer.invoke('planets:delete', id),
  /** Player's standing with each guild (from envoy scans / manual edits). */
  listGuildStandings: (): Promise<GuildStanding[]> => ipcRenderer.invoke('guilds:standings'),
  setGuildStanding: (guild: Exclude<GuildType, null>, rank: string): Promise<GuildStanding> =>
    ipcRenderer.invoke('guilds:setStanding', guild, rank),
  scanNow: (): Promise<void> => ipcRenderer.invoke('ocr:scan'),
  appInfo: (): Promise<{
    backend: string
    clickThrough: boolean
    version: string
    /** Which overlay/scanning features this OS supports. */
    platform: PlatformSupport
  }> => ipcRenderer.invoke('app:info'),
  minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  /** Toggle work-area "maximize"; resolves to the new maximized state. */
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:maximize'),
  closeWindow: (): Promise<void> => ipcRenderer.invoke('window:close'),
  openDebugFolder: (): Promise<void> => ipcRenderer.invoke('debug:open'),
  getLocation: (): Promise<LocationInfo | null> => ipcRenderer.invoke('location:get'),
  listSlots: (): Promise<SaveSlotState> => ipcRenderer.invoke('slots:list'),
  /** Pin inventory/location to one save slot (null = newest save wins). */
  selectSlot: (slotId: string | null): Promise<SaveSlotState> =>
    ipcRenderer.invoke('slots:select', slotId),

  /** Pin the last-copied portal address (HUD glyph strip + window title);
   *  null unpins. Broadcast back to every window via onPortalPinned. */
  pinPortal: (code: string | null): Promise<void> => ipcRenderer.invoke('portal:pin', code),
  getPinnedPortal: (): Promise<string | null> => ipcRenderer.invoke('portal:getPinned'),

  /** Show/hide the HUD overlay window; resolves to the new visibility. */
  toggleHud: (): Promise<boolean> => ipcRenderer.invoke('hud:toggle'),
  isHudVisible: (): Promise<boolean> => ipcRenderer.invoke('hud:isVisible'),
  /** Bring the dashboard window to the front and focus it. */
  focusDashboard: (): Promise<void> => ipcRenderer.invoke('dashboard:focus'),

  onOcrResult: (cb: (r: OcrScanResult) => void) => subscribe('ocr:result', cb),
  onOcrStatus: (cb: (s: OcrStatus) => void) => subscribe('ocr:status', cb),
  onSaveSynced: (cb: (r: SaveSyncResult) => void) => subscribe('save:synced', cb),
  /** Fired when the displayed per-slot catalogue changes (pin change, or the
   *  newest-save slot flipped because another character is being played). */
  onStoreSwitched: (cb: (slotId: string | null) => void) => subscribe('store:switched', cb),
  onSaveError: (cb: (message: string) => void) => subscribe('save:error', cb),
  onClickThrough: (cb: (enabled: boolean) => void) => subscribe('hud:clickthrough', cb),
  onPortalPinned: (cb: (code: string | null) => void) => subscribe('portal:pinned', cb)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
