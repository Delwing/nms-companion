import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { GuildType, OcrScanResult, SaveSlotState, SystemPatch } from '@shared/types'
import { normalizeGuildRank } from '@shared/guildRanks'
import { type CatalogueStore, type PlanetEvidence } from './services/db'
import { SlotStores } from './services/slotStores'
import { newestSlotOnDisk } from './services/saveSlots'
import { harvestDiscoveryNames } from './services/memoryReader'
import { createAssistantNms, type AssistantNmsService } from './services/assistantNms'
import { locateSaveDirs } from './services/saveLocations'
import { SaveWatcher } from './services/saveWatcher'
import { platformSupport } from './services/platform'
import { scanScreen, shutdownOcr, warmUp, type ScanOptions } from './services/ocrService'
import { matchBaseInText, matchSystemInText } from './services/systemMatcher'
import { focusWindowByTitle } from './services/gameFocus'
import appIcon from '../../build/icon.png?asset'

/**
 * Windows draws the taskbar / Alt-Tab icon from the window, falling back to the
 * .exe's embedded icon. Packaged builds already carry it in `NMS Companion.exe`,
 * so this only matters in `npm run dev`, where the window would otherwise show
 * the stock Electron logo. Left unset when packaged: the emitted asset lives
 * inside app.asar, and the exe's icon is the more reliable source.
 */
const windowIcon = app.isPackaged ? undefined : appIcon

let dashboardWindow: BrowserWindow | null = null
let hudWindow: BrowserWindow | null = null
let slotStores: SlotStores
/** The displayed catalogue: the pinned slot's store, or the newest slot's. */
let store: CatalogueStore
let activeSlotId: string | null = null
let assistantNms: AssistantNmsService
let saveWatcher: SaveWatcher | null = null
let clickThrough = false
/** Desired HUD visibility (persisted); the window itself is created lazily. */
let hudShown = true
let scanning = false
/** Pre-maximize bounds; set while the dashboard fills the work area. */
let restoreBounds: Electron.Rectangle | null = null

function send(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

function webPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    zoomFactor: uiZoom()
  }
}

/** Both windows run the same renderer; ?view= picks which UI it renders. */
function loadRenderer(win: BrowserWindow, view: 'dashboard' | 'hud'): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { query: { view } })
  }
}

/** Saved bounds for a window, or null if they no longer land on any display. */
function savedBounds(key: 'dashboardBounds' | 'hudBounds'): Electron.Rectangle | null {
  const bounds = loadSettings()[key]
  if (!bounds) return null
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return (
      bounds.x < a.x + a.width &&
      bounds.x + bounds.width > a.x &&
      bounds.y < a.y + a.height &&
      bounds.y + bounds.height > a.y
    )
  })
  return onScreen ? bounds : null
}

/** Persist the window's bounds (debounced) so it reopens where it was left. */
function trackBounds(win: BrowserWindow, key: 'dashboardBounds' | 'hudBounds'): void {
  let timer: NodeJS.Timeout | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      // The emulated maximize fills the work area — don't record that as
      // the window's home position.
      if (key === 'dashboardBounds' && restoreBounds) return
      if (!win.isDestroyed()) saveSettings({ [key]: win.getBounds() })
    }, 500)
  }
  win.on('moved', save)
  win.on('resized', save)
}

function createDashboardWindow(): void {
  dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    ...(savedBounds('dashboardBounds') ?? {}),
    icon: windowIcon,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: webPreferences()
  })

  dashboardWindow.setAlwaysOnTop(true, 'screen-saver')
  // Chromium may reset per-origin zoom on reloads (dev HMR) — reapply.
  dashboardWindow.webContents.on('did-finish-load', () => {
    dashboardWindow?.webContents.setZoomFactor(uiZoom())
  })
  dashboardWindow.on('ready-to-show', () => dashboardWindow?.show())
  dashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  dashboardWindow.on('closed', () => {
    dashboardWindow = null
  })
  trackBounds(dashboardWindow, 'dashboardBounds')
  loadRenderer(dashboardWindow, 'dashboard')
}

/** Small always-on-top glass overlay; independent of the dashboard window. */
function createHudWindow(): void {
  hudWindow = new BrowserWindow({
    width: 420,
    height: 320,
    ...(savedBounds('hudBounds') ?? {}),
    icon: windowIcon,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: webPreferences()
  })

  hudWindow.setAlwaysOnTop(true, 'screen-saver')
  hudWindow.setIgnoreMouseEvents(clickThrough, { forward: true })
  hudWindow.setFocusable(!clickThrough)
  hudWindow.webContents.on('did-finish-load', () => {
    hudWindow?.webContents.setZoomFactor(uiZoom())
  })
  // Never steal focus from the game or dashboard when appearing.
  hudWindow.once('ready-to-show', () => hudWindow?.showInactive())
  hudWindow.on('closed', () => {
    hudWindow = null
  })
  trackBounds(hudWindow, 'hudBounds')
  loadRenderer(hudWindow, 'hud')
}

async function runScan(): Promise<void> {
  if (scanning) return
  scanning = true
  const started = Date.now()
  send('ocr:status', { state: 'capturing' })

  try {
    send('ocr:status', { state: 'recognizing' })
    const result = await scanScreen(ocrCachePath(), scanOptions())

    let payload: OcrScanResult
    if (result.kind === 'envoy' && result.envoy) {
      // Envoy screens describe the station we're currently docked at, so the
      // scan is applied straight onto the current system.
      const location = saveWatcher?.currentLocation() ?? null
      let systemPatched: string | null = null
      if (location) {
        // Talking to an envoy proves a normal station — clear any stale
        // pirate/stationless marking along the way.
        const patch: SystemPatch = { envoyItems: result.envoy.items, station: 'normal' }
        if (result.envoy.guild) patch.guildType = result.envoy.guild
        if (result.envoy.offersSfm) patch.offersSfm = true
        if (store.patchSystem(location.universalAddress, patch)) {
          systemPatched = location.universalAddress
        }
      }
      // Standing is player-wide, not per-system: the banner's "Rank:" line
      // updates it whenever the read is recognisable.
      const rank = normalizeGuildRank(result.envoy.guildRank)
      if (result.envoy.guild && rank) store.setGuildStanding(result.envoy.guild, rank)
      payload = {
        ok: true,
        kind: 'envoy',
        envoy: result.envoy,
        systemPatched,
        rawText: result.rawText,
        durationMs: Date.now() - started
      }
      console.log(
        `[ocr] envoy scan: ${result.envoy.guild ?? 'unknown guild'}` +
          (rank ? ` (${rank})` : '') +
          `, ${result.envoy.items.length} items` +
          (systemPatched ? ` -> ${systemPatched}` : ' (no current system to patch)')
      )
    } else if (result.kind === 'system' && result.system) {
      // System-info screens may be browsed from anywhere (galaxy map), so a
      // recognised system name beats the player's current location.
      const info = result.system
      let targetAddress: string | null = null
      if (info.systemName) {
        targetAddress =
          matchSystemInText(store.listSystems(), info.systemName)?.universalAddress ?? null
      }
      targetAddress ??= saveWatcher?.currentLocation()?.universalAddress ?? null

      let systemPatched: string | null = null
      if (targetAddress) {
        const patch: SystemPatch = {}
        if (info.economy) patch.economy = info.economy
        if (info.conflict) patch.conflict = info.conflict
        if (info.race) patch.race = info.race
        if (store.patchSystem(targetAddress, patch)) systemPatched = targetAddress
      }
      payload = {
        ok: true,
        kind: 'system',
        system: info,
        systemPatched,
        rawText: result.rawText,
        durationMs: Date.now() - started
      }
      console.log(
        `[ocr] system scan: ${info.race ?? '?'} / ${info.economy ?? '?'} / ${info.conflict ?? '?'}` +
          (systemPatched ? ` -> ${systemPatched}` : ' (no system to patch)')
      )
    } else {
      // A ship/visor scan describes a planet in the system we're currently
      // in. A Discoveries card ("Discovered by:") may be browsing anywhere,
      // but its header names the browsed system — match it against the
      // catalogue (station names double as system names, suffix-stripped).
      const data = result.data!
      const isCard = /covered\s+by:/i.test(result.rawText)
      let address: string | null
      let evidence: PlanetEvidence | undefined
      if (isCard) {
        // For a full-frame read the sidebar lists many systems, so only the
        // extracted header hint is trustworthy; a cropped card panel is safe
        // to match in full.
        const matchText =
          result.zone === 'card'
            ? `${data.systemHint ?? ''}\n${result.rawText}`
            : (data.systemHint ?? '')
        // The card lists the bases built on the planet. A recognised base
        // name pins the exact system and planet index — it beats the
        // stylized header, whose capitals OCR often garbles. A full card
        // read with no base hit is evidence of absence: that planet must
        // not claim a base-bearing index slot.
        const baseHit = matchText.trim()
          ? matchBaseInText(store.listBases(), matchText)
          : null
        if (baseHit) {
          address = baseHit.systemAddress
        } else {
          const matched = matchText.trim()
            ? matchSystemInText(store.listSystems(), matchText)
            : null
          address = matched?.universalAddress ?? null
        }
        evidence = {
          planetIndex: baseHit?.planetIndex ?? null,
          cardBases: result.zone === 'card' ? (baseHit ? 1 : 0) : null
        }
      } else {
        address = saveWatcher?.currentLocation()?.universalAddress ?? null
      }
      const planet = store.insertPlanet(data, address, evidence)
      payload = {
        ok: true,
        kind: 'planet',
        data: result.data,
        planetId: planet.id,
        rawText: result.rawText,
        durationMs: Date.now() - started
      }
      console.log(
        `[ocr] planet scan (${result.zone}): ${planet.name} / ${planet.type}, ` +
          `${planet.resources.length} resources`
      )
    }
    send('ocr:result', payload)
    send('ocr:status', { state: 'done' })
  } catch (err) {
    // A capture failure on a platform that can't reliably screenshot is a
    // platform limit, not a bug in the scan — name it, so the user isn't left
    // debugging a native error message that has no fix.
    const reason = err instanceof Error ? err.message : String(err)
    const support = platformSupport()
    const payload: OcrScanResult = {
      ok: false,
      durationMs: Date.now() - started,
      error: support.screenCapture
        ? reason
        : `Screen capture is not available on ${support.session ?? support.os} — ${reason}`
    }
    send('ocr:result', payload)
    send('ocr:status', { state: 'error', message: payload.error })
  } finally {
    scanning = false
  }
}

/**
 * Alt+S: bounce focus between the game and the dashboard. Toward the game
 * the HUD turns into click-through glass and the dashboard drops off the
 * topmost band — so it slides behind the game on the same screen but stays
 * visible on a second monitor. Toward the dashboard it comes to the front
 * focused and the HUD becomes solid/draggable again.
 */
function toggleFocus(): void {
  setGameFocus(dashboardWindow?.isFocused() ?? false)
}

function setGameFocus(toGame: boolean): void {
  clickThrough = toGame
  if (hudWindow && !hudWindow.isDestroyed()) {
    // Click-through glass while playing; solid and draggable otherwise.
    hudWindow.setIgnoreMouseEvents(toGame, { forward: true })
    hudWindow.setFocusable(!toGame)
    // setFocusable can drop a frameless window out of the topmost band.
    hudWindow.setAlwaysOnTop(true, 'screen-saver')
  }
  send('hud:clickthrough', clickThrough)
  if (toGame) {
    dashboardWindow?.setAlwaysOnTop(false)
    // Dropping our focus alone doesn't activate the game — Windows just
    // picks the next window in z-order and NMS stays inactive until
    // clicked. Hand it the foreground explicitly.
    if (!focusWindowByTitle(gameWindowTitle())) {
      console.warn(`[hud] game window "${gameWindowTitle()}" not found to focus`)
      dashboardWindow?.blur()
    }
  } else if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.setAlwaysOnTop(true, 'screen-saver')
    if (dashboardWindow.isMinimized()) dashboardWindow.restore()
    dashboardWindow.show()
    dashboardWindow.focus()
  }
}

function ocrCachePath(): string {
  return join(app.getPath('userData'), 'tesseract')
}

function debugDir(): string {
  return join(app.getPath('userData'), 'debug')
}

function paddleDir(): string {
  return join(app.getPath('userData'), 'paddle-ocr')
}

/** Exact window title Alt+S hands focus to; override via config.json "gameWindowTitle". */
function gameWindowTitle(): string {
  const configPath = join(app.getPath('userData'), 'config.json')
  try {
    const title = JSON.parse(readFileSync(configPath, 'utf8')).gameWindowTitle
    if (typeof title === 'string' && title.trim()) return title
  } catch {
    // missing or malformed config — use the default
  }
  return "No Man's Sky"
}

/**
 * Extra save locations from config.json ("saveDirs"). The escape hatch for
 * installs the platform defaults can't find — chiefly a non-Steam Wine/Proton
 * prefix on Linux (Heroic, Lutris, a manual WINEPREFIX).
 */
function configSaveDirs(): string[] {
  const configPath = join(app.getPath('userData'), 'config.json')
  try {
    const dirs = JSON.parse(readFileSync(configPath, 'utf8')).saveDirs
    if (Array.isArray(dirs)) return dirs.filter((d): d is string => typeof d === 'string')
  } catch {
    // missing or malformed config — platform defaults only
  }
  return []
}

/** UI zoom from config.json ("uiZoom"); the compact HUD styling reads small at native scale. */
function uiZoom(): number {
  const configPath = join(app.getPath('userData'), 'config.json')
  try {
    const zoom = JSON.parse(readFileSync(configPath, 'utf8')).uiZoom
    if (typeof zoom === 'number' && zoom >= 0.5 && zoom <= 3) return zoom
  } catch {
    // missing or malformed config — use the default
  }
  return 1.15
}

/**
 * Screen regions covered by the app's own windows (HUD overlay, dashboard),
 * in physical pixels of the captured display — the OCR pipeline blacks them
 * out so overlay text is never read as game UI. Window bounds are DIP and
 * desktop-global; the frame is physical pixels of one display.
 */
function overlayExcludeRects(display?: number | string): ScanOptions['excludeRects'] {
  const target =
    (display !== undefined &&
      screen.getAllDisplays().find((d) => String(d.id) === String(display))) ||
    screen.getPrimaryDisplay()
  const scale = target.scaleFactor
  const rects: NonNullable<ScanOptions['excludeRects']> = []
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !win.isVisible()) continue
    const b = win.getBounds()
    // Pad a few pixels: rounded corners and DIP->pixel rounding leave
    // sub-pixel slivers of the window edge otherwise.
    const pad = 4
    rects.push({
      left: (b.x - target.bounds.x - pad) * scale,
      top: (b.y - target.bounds.y - pad) * scale,
      width: (b.width + 2 * pad) * scale,
      height: (b.height + 2 * pad) * scale
    })
  }
  return rects
}

/** Optional userData/config.json: { "display": id, "zones": [{key,left,top,width,height}], "ocrEngine": "paddle" | "tesseract", "uiZoom": 1.15, "gameWindowTitle": "No Man's Sky", "saveDirs": ["/path/to/prefix/.../HelloGames/NMS"] } */
function scanOptions(): ScanOptions {
  const opts: ScanOptions = { debugDir: debugDir(), paddleDir: paddleDir() }
  const configPath = join(app.getPath('userData'), 'config.json')
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'))
      if (config.display !== undefined) opts.display = config.display
      if (Array.isArray(config.zones)) opts.zones = config.zones
      if (config.ocrEngine === 'tesseract' || config.ocrEngine === 'paddle') {
        opts.engine = config.ocrEngine
      }
    } catch (err) {
      console.warn('[config] failed to parse config.json:', err)
    }
  }
  opts.excludeRects = overlayExcludeRects(opts.display)
  return opts
}

/** App-written preferences (userData/settings.json) — distinct from the hand-edited config.json. */
interface AppSettings {
  /** Pinned save slot id, or null for "newest save wins". */
  saveSlot?: string | null
  /** Last dashboard window bounds; restored on launch. */
  dashboardBounds?: Electron.Rectangle
  /** Last HUD overlay bounds; restored on launch. */
  hudBounds?: Electron.Rectangle
  /** Whether the HUD overlay is shown. */
  hudVisible?: boolean
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    return JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(patch: AppSettings): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify({ ...loadSettings(), ...patch }, null, 2))
  } catch (err) {
    console.warn('[settings] failed to write settings.json:', err)
  }
}

function loadKeyMapping(): Record<string, string> | undefined {
  // Optional: obfuscated->readable save-key mapping dropped in by the user.
  const mappingPath = join(app.getPath('userData'), 'nms-keymap.json')
  if (!existsSync(mappingPath)) return undefined
  try {
    return JSON.parse(readFileSync(mappingPath, 'utf8'))
  } catch {
    return undefined
  }
}

function registerIpc(): void {
  ipcMain.handle('systems:list', () => store.listSystems())
  ipcMain.handle('systems:patch', (_e, address: string, patch: SystemPatch) =>
    store.patchSystem(address, patch)
  )
  // Experimental: resolve procedural names for unnamed systems and planets
  // by scanning the running game's memory (read-only); calibration-gated in
  // the service.
  ipcMain.handle('systems:harvestNames', async () => {
    const result = await harvestDiscoveryNames(store.listSystems(), store.listPlanets())
    if (result.ok) {
      result.named = result.named.filter((n) =>
        store.setSystemNameIfUnknown(n.universalAddress, n.name)
      )
      result.namedPlanets = result.namedPlanets.filter((p) =>
        store.setPlanetNameIfPlaceholder(p.systemAddress, p.planetIndex, p.name)
      )
    }
    return result
  })
  ipcMain.handle('planets:list', () => store.listPlanets())
  ipcMain.handle('bases:list', () => store.listBases())
  ipcMain.handle('inventories:list', () => store.listInventories())
  ipcMain.handle('ships:list', () => saveWatcher?.listShips() ?? [])
  ipcMain.handle('frigates:list', () => saveWatcher?.listFrigates() ?? [])
  ipcMain.handle('languages:list', () => saveWatcher?.listLanguageProgress() ?? [])
  ipcMain.handle('freighterBattle:get', () => saveWatcher?.freighterBattle() ?? null)
  ipcMain.handle('items:liveInfo', () => assistantNms.liveItemInfo())
  ipcMain.handle('items:details', () => assistantNms.itemDetails())
  ipcMain.handle('items:icon', (_e, iconPath: string) => assistantNms.icon(iconPath))
  ipcMain.handle('planets:assignSystem', (_e, id: number, systemAddress: string | null) => {
    const planet = store.setPlanetSystem(id, systemAddress)
    // The assigned system may hold a save-import "Planet N" stub for this
    // very planet — fold it in rather than showing both.
    if (planet && systemAddress) store.mergePlaceholderPlanets()
    return planet
  })
  ipcMain.handle('planets:delete', (_e, id: number) => store.deletePlanet(id))
  ipcMain.handle('guilds:standings', () => store.listGuildStandings())
  ipcMain.handle('guilds:setStanding', (_e, guild: Exclude<GuildType, null>, rank: string) =>
    store.setGuildStanding(guild, rank)
  )
  ipcMain.handle('ocr:scan', () => runScan())
  ipcMain.handle('app:info', () => ({
    backend: store.backend,
    clickThrough,
    version: app.getVersion(),
    platform: platformSupport()
  }))
  // Last-copied portal address, pinned so the HUD (over the game) and the
  // window title keep showing it while the player dials the portal.
  let pinnedPortal: string | null = null
  ipcMain.handle('portal:getPinned', () => pinnedPortal)
  ipcMain.handle('portal:pin', (_e, code: string | null) => {
    pinnedPortal = code
    send('portal:pinned', pinnedPortal)
  })
  // HUD overlay visibility, driven by the dashboard header toggle.
  ipcMain.handle('hud:isVisible', () => hudShown)
  ipcMain.handle('hud:toggle', () => {
    hudShown = !hudShown
    if (!hudShown) {
      hudWindow?.hide()
    } else if (hudWindow && !hudWindow.isDestroyed()) {
      hudWindow.showInactive()
    } else {
      createHudWindow()
    }
    saveSettings({ hudVisible: hudShown })
    return hudShown
  })
  // HUD expand button: same path as Alt+S toward the dashboard.
  ipcMain.handle('dashboard:focus', () => setGameFocus(false))
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
  // Transparent frameless windows can't use native maximize on Windows, so
  // emulate it by filling the current display's work area.
  ipcMain.handle('window:maximize', () => {
    if (!dashboardWindow) return false
    if (restoreBounds) {
      dashboardWindow.setBounds(restoreBounds)
      restoreBounds = null
      return false
    }
    restoreBounds = dashboardWindow.getBounds()
    dashboardWindow.setBounds(screen.getDisplayMatching(restoreBounds).workArea)
    return true
  })
  // The dashboard's X is the app's only close affordance — quit outright
  // rather than leaving an orphaned HUD overlay behind.
  ipcMain.handle('window:close', () => app.quit())
  ipcMain.handle('debug:open', () => shell.openPath(debugDir()))
  ipcMain.handle('location:get', () => saveWatcher?.currentLocation() ?? null)
  ipcMain.handle('slots:list', () => slotState())
  ipcMain.handle('slots:select', (_e, slotId: string | null) => {
    saveWatcher?.setSlot(slotId)
    saveSettings({ saveSlot: slotId })
    updateActiveStore()
    return slotState()
  })
}

function slotState(): SaveSlotState {
  return {
    slots: saveWatcher?.listSlots() ?? [],
    selected: saveWatcher?.selectedSlotId() ?? null
  }
}

/**
 * Re-resolve which slot's catalogue is displayed: the pinned slot, else the
 * newest-written one — i.e. the character currently being played (the game
 * rewrites its save every few minutes, so in auto mode the catalogue follows
 * an in-game character switch by itself). Notifies the renderer on change.
 */
function updateActiveStore(initialSlot: string | null = null): void {
  const slotId =
    saveWatcher?.selectedSlotId() ?? saveWatcher?.newestSlotId() ?? initialSlot
  if (store && slotId === activeSlotId) return
  activeSlotId = slotId
  store = slotStores.storeFor(slotId)
  console.log(`[slots] active catalogue: ${slotId ?? '(no slot found)'}`)
  send('store:switched', slotId)
}

app.whenReady().then(() => {
  slotStores = new SlotStores(app.getPath('userData'))
  // Which slot is being played right now (or was last played): the one whose
  // save file was written most recently. A legacy shared catalogue migrates
  // into that slot's store once.
  const newestSlot = newestSlotOnDisk(locateSaveDirs(configSaveDirs()))
  if (newestSlot) slotStores.migrateLegacy(newestSlot)
  updateActiveStore(loadSettings().saveSlot ?? newestSlot)
  assistantNms = createAssistantNms({ cacheDir: join(app.getPath('userData'), 'assistantnms') })
  // Warm the item-data caches so the first inventory render gets live
  // values and the first tooltip hover finds its details ready.
  void assistantNms.liveItemInfo()
  void assistantNms.itemDetails()
  hudShown = loadSettings().hudVisible ?? true
  createDashboardWindow()
  if (hudShown) createHudWindow()
  registerIpc()
  warmUp(ocrCachePath(), paddleDir())

  saveWatcher = new SaveWatcher({
    storeFor: (slotId) => slotStores.storeFor(slotId),
    keyMapping: loadKeyMapping(),
    selectedSlot: loadSettings().saveSlot ?? null,
    extraSaveDirs: configSaveDirs(),
    onSync: (result) => {
      console.log(
        `[saveWatcher] synced ${result.systemsUpserted} systems, ${result.basesUpserted} bases, ${result.inventoryItems} inventory stacks from ${result.savePath}` +
          (result.planetsLinked > 0 ? `, linked ${result.planetsLinked} orphan planets` : '')
      )
      // In auto mode a save write may make a different slot the newest —
      // the displayed catalogue follows the character being played.
      updateActiveStore()
      send('save:synced', result)
    },
    onError: (message) => {
      console.warn('[saveWatcher]', message)
      send('save:error', message)
    }
  })
  const dirs = saveWatcher.start()
  console.log('[saveWatcher] watching:', dirs.length ? dirs : 'no dirs found')

  // Registration fails silently where the display server grants no global
  // grab (Wayland) — say so once rather than leaving the hotkeys dead.
  const hotkeys: [string, () => void][] = [
    ['Alt+C', () => void runScan()],
    ['Alt+S', toggleFocus]
  ]
  for (const [accelerator, handler] of hotkeys) {
    if (!globalShortcut.register(accelerator, handler)) {
      console.warn(`[hotkeys] ${accelerator} could not be registered on this platform`)
    }
  }
  for (const limitation of platformSupport().limitations) {
    console.warn('[platform]', limitation)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createDashboardWindow()
  })
})

app.on('will-quit', async (event) => {
  event.preventDefault()
  globalShortcut.unregisterAll()
  await saveWatcher?.stop().catch(() => undefined)
  await shutdownOcr().catch(() => undefined)
  slotStores?.closeAll()
  app.exit(0)
})

app.on('window-all-closed', () => {
  app.quit()
})
