import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  BaseRecord,
  FreighterBattleState,
  FrigateRecord,
  GuildStanding,
  GuildType,
  InventoryItemRecord,
  LanguageProgressRecord,
  LocationInfo,
  OcrScanResult,
  OcrStatus,
  PlanetRecord,
  SaveSlotState,
  SaveSyncResult,
  ShipRecord,
  SystemPatch,
  SystemRecord
} from '@shared/types'
import {
  Anchor,
  Archive,
  Boxes,
  FlaskConical,
  Hexagon,
  Languages,
  LayoutGrid,
  Orbit,
  Rocket,
  Search,
  Table2,
  X
} from 'lucide-react'
import { ENVOY_STOCK_ROWS } from '@shared/guildRanks'
import { closestToCoreByGalaxy, formatLightYears, portalCode } from '@shared/galaxy'
import { isBareUnknownSystem } from '@shared/systemStubs'
import { OverlayHeader } from './components/OverlayHeader'
import { StationGrid } from './components/StationGrid'
import { GuildStandingStrip } from './components/GuildStandingStrip'
import { PlanetList } from './components/PlanetList'
import { OcrToast } from './components/OcrToast'
import { HudPanel } from './components/HudPanel'
import { Sidebar } from './components/Sidebar'
import { ResourceMatrix } from './components/ResourceMatrix'
import { InventoryView } from './components/InventoryView'
import { ShipComparison } from './components/ShipComparison'
import { FrigateFleet } from './components/FrigateFleet'
import { LanguageProgress } from './components/LanguageProgress'
import { StatusBar } from './components/StatusBar'
import { GalaxyMapView } from './components/galaxyMap/GalaxyMapView'

/** Which dashboard screen is shown: catalogue, resource matrix, region map, inventory, ships, frigates, or languages. */
type DashboardView = 'catalogue' | 'matrix' | 'map' | 'inventory' | 'ships' | 'frigates' | 'languages'

/** Dashboard and HUD are separate windows running the same renderer; main
 * tags each with ?view= so it knows which UI to be. */
const isHudWindow = new URLSearchParams(window.location.search).get('view') === 'hud'

export default function App(): React.JSX.Element {
  const [view, setView] = useState<DashboardView>('catalogue')
  const [hudVisible, setHudVisible] = useState(true)
  const [clickThrough, setClickThrough] = useState(false)
  const [systems, setSystems] = useState<SystemRecord[]>([])
  const [planets, setPlanets] = useState<PlanetRecord[]>([])
  const [bases, setBases] = useState<BaseRecord[]>([])
  const [inventories, setInventories] = useState<InventoryItemRecord[]>([])
  const [ships, setShips] = useState<ShipRecord[]>([])
  const [frigates, setFrigates] = useState<FrigateRecord[]>([])
  const [languages, setLanguages] = useState<LanguageProgressRecord[]>([])
  const [standings, setStandings] = useState<GuildStanding[]>([])
  const [lastScan, setLastScan] = useState<OcrScanResult | null>(null)
  const [toastVisible, setToastVisible] = useState(false)
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>({ state: 'idle' })
  const [lastSync, setLastSync] = useState<SaveSyncResult | null>(null)
  const [location, setLocation] = useState<LocationInfo | null>(null)
  const [pinnedPortal, setPinnedPortal] = useState<string | null>(null)
  const [battle, setBattle] = useState<FreighterBattleState | null>(null)
  const [slotState, setSlotState] = useState<SaveSlotState>({ slots: [], selected: null })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [groupByRegion, setGroupByRegion] = useState(false)
  const [selectedResources, setSelectedResources] = useState<string[]>([])
  const [focusAddress, setFocusAddress] = useState<string | null>(null)
  const [harvest, setHarvest] = useState<{ busy: boolean; message: string | null }>({
    busy: false,
    message: null
  })

  const refresh = useCallback(async () => {
    const [sys, pls, bss, inv, shp, frg, stnd, langs] = await Promise.all([
      window.api.listSystems(),
      window.api.listPlanets(),
      window.api.listBases(),
      window.api.listInventories(),
      window.api.listShips(),
      window.api.listFrigates(),
      window.api.listGuildStandings(),
      window.api.listLanguageProgress()
    ])
    setSystems(sys)
    setPlanets(pls)
    setBases(bss)
    setInventories(inv)
    setShips(shp)
    setFrigates(frg)
    setStandings(stnd)
    setLanguages(langs)
  }, [])

  useEffect(() => {
    void refresh()
    void window.api.getLocation().then(setLocation)
    void window.api.getFreighterBattle().then(setBattle)
    void window.api.listSlots().then(setSlotState)
    void window.api.getPinnedPortal().then(setPinnedPortal)
    if (!isHudWindow) void window.api.isHudVisible().then(setHudVisible)

    const offResult = window.api.onOcrResult((result) => {
      setLastScan(result)
      setToastVisible(true)
      if (result.ok) void refresh()
    })
    const offStatus = window.api.onOcrStatus(setOcrStatus)
    const offSync = window.api.onSaveSynced((sync) => {
      setLastSync(sync)
      if (sync.location) setLocation(sync.location)
      if (sync.freighterBattle) setBattle(sync.freighterBattle)
      setSaveError(null)
      void refresh()
      // New save writes may reveal slots that weren't on disk at startup.
      void window.api.listSlots().then(setSlotState)
    })
    const offSaveError = window.api.onSaveError(setSaveError)
    const offClick = window.api.onClickThrough(setClickThrough)
    const offPinned = window.api.onPortalPinned(setPinnedPortal)
    // The displayed catalogue is per save slot; refetch when it switches
    // (slot pinned/unpinned, or another character started playing).
    const offStore = window.api.onStoreSwitched(() => {
      void refresh()
      void window.api.getLocation().then(setLocation)
      void window.api.getFreighterBattle().then(setBattle)
      void window.api.listSlots().then(setSlotState)
    })

    return () => {
      offResult()
      offStatus()
      offSync()
      offSaveError()
      offClick()
      offPinned()
      offStore()
    }
  }, [refresh])

  useEffect(() => {
    if (!toastVisible) return
    const timer = setTimeout(() => setToastVisible(false), 6000)
    return () => clearTimeout(timer)
  }, [toastVisible, lastScan])

  const selectSlot = useCallback(
    async (slotId: string | null) => {
      setSlotState(await window.api.selectSlot(slotId))
      // The pinned slot's save is re-parsed synchronously in main, so the
      // fresh snapshot is already queryable.
      setLocation(await window.api.getLocation())
      setBattle(await window.api.getFreighterBattle())
      void refresh()
    },
    [refresh]
  )

  const patchSystem = useCallback(
    async (address: string, patch: SystemPatch) => {
      const updated = await window.api.patchSystem(address, patch)
      // Splice the result in place: a full refresh re-sorts by updated_at,
      // teleporting the card mid-interaction (e.g. while cycling its guild
      // chip). The fresh order applies on the next natural refresh.
      if (updated) {
        setSystems((prev) => prev.map((s) => (s.universalAddress === address ? updated : s)))
      } else {
        void refresh()
      }
    },
    [refresh]
  )

  const assignPlanetSystem = useCallback(
    async (id: number, systemAddress: string | null) => {
      await window.api.assignPlanetSystem(id, systemAddress)
      void refresh()
    },
    [refresh]
  )

  const deletePlanet = useCallback(
    async (id: number) => {
      await window.api.deletePlanet(id)
      void refresh()
    },
    [refresh]
  )

  const setGuildStanding = useCallback(
    async (guild: Exclude<GuildType, null>, rank: string) => {
      const updated = await window.api.setGuildStanding(guild, rank)
      setStandings((prev) => [...prev.filter((s) => s.guild !== guild), updated])
    },
    []
  )

  const toggleHud = useCallback(async () => {
    setHudVisible(await window.api.toggleHud())
  }, [])

  const unassignedPlanets = planets.filter((p) => !p.systemAddress)

  const toggleResource = useCallback((resource: string) => {
    setSelectedResources((prev) =>
      prev.includes(resource) ? prev.filter((r) => r !== resource) : [...prev, resource]
    )
  }, [])

  // Jump from the sidebar or matrix to a system card; clear filters so it's visible.
  const jumpToSystem = useCallback((address: string) => {
    setView('catalogue')
    setFilter('')
    setSelectedResources([])
    setFocusAddress(address)
  }, [])

  // From the matrix: find catalogued systems that have an uncovered resource.
  const showResourceInCatalogue = useCallback((resource: string) => {
    setView('catalogue')
    setFilter('')
    setSelectedResources([resource])
  }, [])

  const focusHandled = useCallback(() => setFocusAddress(null), [])

  // Experimental: read procedural names for unknown systems out of the
  // running game's memory. Read-only; validated against known names in main.
  const pullNamesFromGame = useCallback(async () => {
    setHarvest({ busy: true, message: null })
    try {
      const result = await window.api.harvestNames()
      if (result.ok) {
        const parts = []
        if (result.named.length > 0) {
          parts.push(`${result.named.length} system${result.named.length === 1 ? '' : 's'}`)
        }
        if (result.namedPlanets.length > 0) {
          parts.push(
            `${result.namedPlanets.length} planet${result.namedPlanets.length === 1 ? '' : 's'}`
          )
        }
        setHarvest({
          busy: false,
          message: parts.length > 0 ? `Named ${parts.join(' + ')}` : 'No new names found'
        })
        if (parts.length > 0) void refresh()
      } else {
        const messages: Record<string, string> = {
          'game-not-running': 'NMS is not running',
          'calibration-failed': 'Memory layout not recognised (game update?)',
          'unsupported-platform': 'Windows only',
          'open-failed': 'Could not open game process'
        }
        setHarvest({ busy: false, message: messages[result.error ?? ''] ?? 'Scan failed' })
      }
    } catch {
      setHarvest({ busy: false, message: 'Scan failed' })
    }
  }, [refresh])

  useEffect(() => {
    if (!harvest.message) return
    const timer = setTimeout(() => setHarvest((h) => ({ ...h, message: null })), 8000)
    return () => clearTimeout(timer)
  }, [harvest.message])

  const unknownCount = useMemo(
    () =>
      systems.filter((s) => s.name === 'Unknown System').length +
      planets.filter((p) => p.name === `Planet ${p.planetIndex}`).length,
    [systems, planets]
  )

  // What the catalogue shows: bare address-only records (warp pass-throughs,
  // cached foreign discoveries) are hidden unless the player is currently
  // there or has a base there.
  const catalogueSystems = useMemo(() => {
    const planetCounts = new Map<string, number>()
    for (const p of planets) {
      if (p.systemAddress) {
        planetCounts.set(p.systemAddress, (planetCounts.get(p.systemAddress) ?? 0) + 1)
      }
    }
    const baseAddresses = new Set(bases.map((b) => b.systemAddress))
    return systems.filter(
      (s) =>
        s.universalAddress === location?.universalAddress ||
        baseAddresses.has(s.universalAddress) ||
        !isBareUnknownSystem(s, planetCounts.get(s.universalAddress) ?? 0)
    )
  }, [systems, planets, bases, location])

  // Mirror the pinned (last-copied) portal address into the OS window
  // title (taskbar, alt-tab) — the in-app title bar is custom.
  useEffect(() => {
    document.title = pinnedPortal ? `NMS Companion · ${pinnedPortal}` : 'NMS Companion'
  }, [pinnedPortal])

  const unpinPortal = useCallback(() => void window.api.pinPortal(null), [])

  // Arriving in the pinned portal's system means the glyphs served their
  // purpose — unpin automatically on the next save sync. The planet digit
  // (first glyph) is ignored: any planet in the system counts as arrival.
  useEffect(() => {
    if (!pinnedPortal || !location) return
    const s = systems.find((sys) => sys.universalAddress === location.universalAddress)
    if (
      !s ||
      s.voxelX === null ||
      s.voxelY === null ||
      s.voxelZ === null ||
      s.solarSystemIndex === null
    ) {
      return
    }
    const here = portalCode(s.voxelX, s.voxelY, s.voxelZ, s.solarSystemIndex)
    if (here.slice(1) === pinnedPortal.slice(1)) void window.api.pinPortal(null)
  }, [pinnedPortal, location, systems])

  // Jump target for the "Nearest core" button: the closest-to-core system
  // in the player's current galaxy, or the overall closest when unknown.
  const coreTarget = useMemo(() => {
    const byGalaxy = closestToCoreByGalaxy(catalogueSystems)
    const currentGalaxy = location
      ? (catalogueSystems.find((s) => s.universalAddress === location.universalAddress)?.galaxy ??
        location.galaxy)
      : null
    const pick =
      byGalaxy.get(currentGalaxy) ??
      [...byGalaxy.values()].reduce<{ universalAddress: string; ly: number } | null>(
        (min, c) => (min && min.ly <= c.ly ? min : c),
        null
      )
    if (!pick) return null
    const system = catalogueSystems.find((s) => s.universalAddress === pick.universalAddress)
    return system ? { system, ly: pick.ly } : null
  }, [catalogueSystems, location])

  if (isHudWindow) {
    return (
      <div className="h-full w-full">
        <HudPanel
          clickThrough={clickThrough}
          lastScan={lastScan}
          ocrStatus={ocrStatus}
          location={location}
          pinnedPortal={pinnedPortal}
          systemCount={catalogueSystems.length}
          planetCount={planets.length}
          onExpand={() => void window.api.focusDashboard()}
          onUnpin={unpinPortal}
        />
        <ScanToasts lastScan={lastScan} visible={toastVisible} />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-cyan-500/20 bg-slate-950/95 text-slate-100 shadow-2xl">
      <OverlayHeader
        hudVisible={hudVisible}
        clickThrough={clickThrough}
        ocrStatus={ocrStatus}
        lastSync={lastSync}
        location={location}
        pinnedPortal={pinnedPortal}
        slotState={slotState}
        saveError={saveError}
        onToggleHud={() => void toggleHud()}
        onUnpin={unpinPortal}
        onScan={() => void window.api.scanNow()}
        onSelectSlot={(id) => void selectSlot(id)}
      />

      {/* View switcher: catalogue vs base/resource coverage matrix. */}
      <div className="flex items-center gap-1 border-b border-slate-700/50 bg-slate-900/40 px-5">
        <ViewTab
          active={view === 'catalogue'}
          icon={<LayoutGrid className="h-3.5 w-3.5" />}
          label="Catalogue"
          onClick={() => setView('catalogue')}
        />
        <ViewTab
          active={view === 'matrix'}
          icon={<Table2 className="h-3.5 w-3.5" />}
          label="Resource Matrix"
          onClick={() => setView('matrix')}
        />
        <ViewTab
          active={view === 'map'}
          icon={<Boxes className="h-3.5 w-3.5" />}
          label="Galaxy Map"
          onClick={() => setView('map')}
        />
        <ViewTab
          active={view === 'inventory'}
          icon={<Archive className="h-3.5 w-3.5" />}
          label="Inventory"
          onClick={() => setView('inventory')}
        />
        <ViewTab
          active={view === 'ships'}
          icon={<Rocket className="h-3.5 w-3.5" />}
          label="Ships"
          onClick={() => setView('ships')}
        />
        <ViewTab
          active={view === 'frigates'}
          icon={<Anchor className="h-3.5 w-3.5" />}
          label="Frigates"
          onClick={() => setView('frigates')}
        />
        <ViewTab
          active={view === 'languages'}
          icon={<Languages className="h-3.5 w-3.5" />}
          label="Languages"
          onClick={() => setView('languages')}
        />
      </div>

      {view === 'languages' ? (
        <LanguageProgress languages={languages} />
      ) : view === 'ships' ? (
        <ShipComparison ships={ships} />
      ) : view === 'frigates' ? (
        <FrigateFleet frigates={frigates} />
      ) : view === 'inventory' ? (
        <InventoryView items={inventories} systems={systems} />
      ) : view === 'map' ? (
        <GalaxyMapView
          systems={systems}
          currentAddress={location?.universalAddress ?? null}
          onJumpToSystem={jumpToSystem}
        />
      ) : view === 'matrix' ? (
        <ResourceMatrix
          systems={systems}
          planets={planets}
          bases={bases}
          onShowResource={showResourceInCatalogue}
          onJumpToSystem={jumpToSystem}
        />
      ) : (
        <>
          {/* Filter bar lives outside the scroll area, so it always stays on top. */}
          <div className="flex items-center gap-2 border-b border-slate-700/50 bg-slate-900/70 px-5 py-2.5">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5">
              <Search className="h-3.5 w-3.5 text-slate-500" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter by name, galaxy, race, economy, guild, tag or notes…"
                className="w-full bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none"
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="text-slate-500 hover:text-slate-200"
                  title="Clear filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {selectedResources.map((res) => (
              <button
                key={res}
                onClick={() => toggleResource(res)}
                title="Remove resource filter"
                className="flex items-center gap-1 rounded-full border border-cyan-400/60 bg-cyan-500/25 px-2 py-0.5 text-[10px] text-cyan-100 hover:border-red-400/60 hover:text-red-200"
              >
                {res} <X className="h-2.5 w-2.5" />
              </button>
            ))}
            {unknownCount > 0 && (
              <button
                onClick={() => void pullNamesFromGame()}
                disabled={harvest.busy}
                title={`Experimental: recover the ${unknownCount} missing system/planet name${unknownCount === 1 ? '' : 's'} by reading the running game's memory (read-only). No Man's Sky must be running.`}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-amber-300 transition-colors hover:border-amber-400/60 hover:bg-amber-500/20 hover:text-amber-200 disabled:cursor-wait disabled:opacity-60"
              >
                <FlaskConical className="h-3.5 w-3.5" />
                {harvest.busy ? 'Reading game…' : (harvest.message ?? 'Pull names from game')}
              </button>
            )}
            {coreTarget && (
              <button
                onClick={() => jumpToSystem(coreTarget.system.universalAddress)}
                title={`Jump to ${coreTarget.system.name} — ${formatLightYears(coreTarget.ly)} from the core of ${coreTarget.system.galaxy ?? 'its galaxy'}`}
                className="flex items-center gap-1.5 rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-fuchsia-300 transition-colors hover:border-fuchsia-400/60 hover:bg-fuchsia-500/20 hover:text-fuchsia-200"
              >
                <Orbit className="h-3.5 w-3.5" /> Nearest core
              </button>
            )}
            <button
              onClick={() => setGroupByRegion((g) => !g)}
              title="Systems sharing a voxel are in the same in-game region"
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                groupByRegion
                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
                  : 'border-slate-700/60 bg-slate-900/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Hexagon className="h-3.5 w-3.5" /> Group by region
            </button>
          </div>

          <div className="flex min-h-0 flex-1">
            <main className="flex-1 overflow-y-auto p-5">
              <section>
                <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
                  Catalogued Systems &amp; Stations ({catalogueSystems.length})
                </h2>
                <GuildStandingStrip
                  standings={standings}
                  onSet={(guild, rank) => void setGuildStanding(guild, rank)}
                />
                <StationGrid
                  systems={catalogueSystems}
                  planets={planets}
                  bases={bases}
                  standings={standings}
                  currentAddress={location?.universalAddress ?? null}
                  filter={filter}
                  groupByRegion={groupByRegion}
                  selectedResources={selectedResources}
                  focusAddress={focusAddress}
                  onFocusHandled={focusHandled}
                  onPatch={patchSystem}
                  onUnassignPlanet={(id) => void assignPlanetSystem(id, null)}
                  onDeletePlanet={(id) => void deletePlanet(id)}
                />
              </section>

              {unassignedPlanets.length > 0 && (
                <section className="mt-8">
                  <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
                    Unassigned Planet Scans ({unassignedPlanets.length})
                  </h2>
                  <PlanetList
                    planets={unassignedPlanets}
                    systems={systems}
                    onAssignSystem={(id, address) => void assignPlanetSystem(id, address)}
                    onDelete={(id) => void deletePlanet(id)}
                  />
                </section>
              )}
            </main>

            <Sidebar
              systems={systems}
              planets={planets}
              bases={bases}
              selectedResources={selectedResources}
              onToggleResource={toggleResource}
              onClearResources={() => setSelectedResources([])}
              onJumpToSystem={jumpToSystem}
            />
          </div>
        </>
      )}

      <StatusBar battle={battle} />

      <ScanToasts lastScan={lastScan} visible={toastVisible} />
    </div>
  )
}

function ViewTab({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon: React.JSX.Element
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function ScanToasts({
  lastScan,
  visible
}: {
  lastScan: OcrScanResult | null
  visible: boolean
}): React.JSX.Element | null {
  if (!visible || !lastScan) return null

  if (!lastScan.ok) {
    return (
      <div className="fixed right-6 bottom-6 z-50 rounded-lg border border-red-500/40 bg-red-950/90 px-4 py-2 text-xs text-red-200">
        Scan failed: {lastScan.error}
      </div>
    )
  }

  if (lastScan.kind === 'system' && lastScan.system) {
    const info = lastScan.system
    return (
      <div className="fixed top-6 right-6 z-50 rounded-xl border border-sky-500/30 bg-slate-900/85 px-4 py-3 text-white shadow-2xl backdrop-blur-md">
        <h4 className="text-sm font-semibold text-slate-100">
          {info.systemName ?? 'System Info Captured'}
        </h4>
        <p className="mt-0.5 text-xs text-slate-400">
          {[info.race, info.economy, info.conflict && `Conflict: ${info.conflict}`]
            .filter(Boolean)
            .join(' · ')}
          {lastScan.systemPatched ? ' · saved' : ' · no matching system found'}
        </p>
      </div>
    )
  }

  if (lastScan.kind === 'envoy' && lastScan.envoy) {
    const envoy = lastScan.envoy
    return (
      <div className="fixed top-6 right-6 z-50 rounded-xl border border-amber-500/30 bg-slate-900/85 px-4 py-3 text-white shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold text-slate-100">
            {envoy.guild ? `${envoy.guild} Guild Envoy` : 'Guild Envoy'}
          </h4>
          {envoy.guildRank && (
            <span className="rounded-full border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] text-amber-300">
              {envoy.guildRank}
            </span>
          )}
          {envoy.offersSfm && (
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
              SFM
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-slate-400">
          {envoy.items.length} items recorded
          {lastScan.systemPatched ? ' · saved to current system' : ' · no current system found'}
        </p>
        {envoy.items.length !== ENVOY_STOCK_ROWS && (
          <p className="mt-0.5 text-xs text-amber-300">
            Captured {envoy.items.length}/{ENVOY_STOCK_ROWS} stock rows — rescan recommended
          </p>
        )}
      </div>
    )
  }

  return <OcrToast data={lastScan.data} visible />
}
