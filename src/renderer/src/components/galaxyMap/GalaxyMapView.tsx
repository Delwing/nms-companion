/**
 * The Galaxy Map screen. Two zoom levels: an overview placing every
 * neighbourhood around the galactic core at true relative position, and a
 * lattice view of one neighbourhood's regions. Click a marker to descend,
 * pick Overview to come back up.
 *
 * This is the only file the rest of the app imports from `galaxyMap/`, and
 * the only place outside this folder that knows the map exists. Nothing here
 * touches the store, IPC or preload — the whole view is a function of the
 * `systems` array the dashboard already holds.
 */
import { useEffect, useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Boxes, Compass, Globe2, MapPin } from 'lucide-react'
import type { RegionCell, RegionCluster } from '@shared/galaxyMap'
import type { SystemRecord } from '@shared/types'
import { formatLightYears, regionLabel } from '@shared/galaxy'
import { Scene } from './Scene'
import { OverviewScene } from './OverviewScene'
import { RegionPanel } from './RegionPanel'
import { clusterId, clusterLabel, findCurrentPlacement, useGalaxyMapData } from './useGalaxyMapData'
import {
  CORE_COLOR,
  CURRENT_COLOR,
  GUILD_COLORS,
  GUILD_ICONS,
  GUILD_KEYS,
  GUILD_LABELS,
  MARKER_COLOR,
  RING_STEP_LY,
  guildKey
} from './theme'

interface GalaxyMapProps {
  systems: SystemRecord[]
  /** Address of the system the player is in, from the newest save. */
  currentAddress: string | null
  /** Jump the catalogue to a system card, as the bases sidebar does. */
  onJumpToSystem: (address: string) => void
}

export function GalaxyMapView({
  systems,
  currentAddress,
  onJumpToSystem
}: GalaxyMapProps): React.JSX.Element {
  const { clusters, galaxies, unplaced } = useGalaxyMapData(systems)
  const [galaxy, setGalaxy] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [hoveredCell, setHoveredCell] = useState<RegionCell | null>(null)
  const [hoveredCluster, setHoveredCluster] = useState<RegionCluster | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Where the player is, on the lattice. Null when their system isn't
  // catalogued or has no coordinates — nothing to mark then.
  const current = useMemo(
    () => findCurrentPlacement(clusters, currentAddress),
    [clusters, currentAddress]
  )
  const currentClusterId = current ? clusterId(current.cluster) : null

  // Unless the user picked a galaxy, show the one they're standing in.
  const currentGalaxy = galaxy ?? (current ? current.cluster.galaxy : (galaxies[0] ?? null))
  const visible = useMemo(
    () => clusters.filter((c) => c.galaxy === currentGalaxy),
    [clusters, currentGalaxy]
  )

  const cluster = useMemo(
    () => visible.find((c) => clusterId(c) === activeId) ?? null,
    [visible, activeId]
  )

  // The lattice only marks the player when they're inside the open
  // neighbourhood; elsewhere the overview carries the marker.
  const inCluster = cluster != null && clusterId(cluster) === currentClusterId

  // Leaving a neighbourhood invalidates any selection inside it.
  useEffect(() => {
    setSelectedKey(null)
    setHoveredCell(null)
    setHoveredCluster(null)
  }, [cluster])

  const selectedCell = useMemo(
    () => cluster?.cells.find((c) => c.key === selectedKey) ?? null,
    [cluster, selectedKey]
  )

  if (visible.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-slate-500">
        <Boxes className="h-8 w-8 opacity-40" />
        <p className="text-xs">No systems with coordinates to map yet.</p>
        {unplaced > 0 && (
          <p className="text-[10px]">
            {unplaced} catalogued system{unplaced === 1 ? '' : 's'} carry no address.
          </p>
        )}
      </div>
    )
  }

  const totalSystems = visible.reduce((sum, c) => sum + c.systemCount, 0)

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-56 shrink-0 flex-col border-r border-slate-700/50 bg-slate-900/60">
        {galaxies.length > 1 && (
          <select
            value={currentGalaxy ?? ''}
            onChange={(e) => {
              setGalaxy(e.target.value || null)
              setActiveId(null)
            }}
            className="border-b border-slate-700/50 bg-slate-900/80 px-3 py-2 text-[11px] text-slate-200 outline-none"
          >
            {galaxies.map((name) => (
              <option key={name ?? '?'} value={name ?? ''}>
                {name ?? 'Unknown galaxy'}
              </option>
            ))}
          </select>
        )}

        <div className="p-2">
          <button
            onClick={() => setActiveId(null)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
              !cluster
                ? 'border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-100'
                : 'border-transparent text-slate-300 hover:border-slate-600/50 hover:bg-slate-800/40'
            }`}
          >
            <Globe2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="block text-[11px] font-medium">Overview</span>
              <span className={`block text-[10px] ${!cluster ? 'text-fuchsia-300/70' : 'text-slate-500'}`}>
                {visible.length} neighbourhood{visible.length === 1 ? '' : 's'} · {totalSystems}{' '}
                systems
              </span>
            </span>
          </button>
        </div>

        <div className="px-3 pb-1.5 text-[10px] tracking-wide text-slate-500 uppercase">
          Neighbourhoods
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <div className="flex flex-col gap-1">
            {visible.map((entry) => {
              const id = clusterId(entry)
              const active = entry === cluster
              const here = id === currentClusterId
              return (
                <button
                  key={id}
                  onClick={() => setActiveId(id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                    active
                      ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100'
                      : 'border-transparent text-slate-300 hover:border-slate-600/50 hover:bg-slate-800/40'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[11px] font-medium">
                    {here && (
                      <MapPin
                        className="h-3 w-3 shrink-0"
                        style={{ color: CURRENT_COLOR }}
                        aria-label="You are here"
                      />
                    )}
                    <span className="truncate">{clusterLabel(entry)}</span>
                  </span>
                  <span
                    className={`mt-0.5 block text-[10px] ${active ? 'text-cyan-300/70' : 'text-slate-500'}`}
                  >
                    {entry.cells.length} region{entry.cells.length === 1 ? '' : 's'} ·{' '}
                    {entry.systemCount} system{entry.systemCount === 1 ? '' : 's'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {unplaced > 0 && (
          <p className="border-t border-slate-700/50 px-3 py-2 text-[10px] text-slate-500">
            {unplaced} system{unplaced === 1 ? '' : 's'} without coordinates can't be placed.
          </p>
        )}
      </div>

      <div
        className="relative min-h-0 flex-1 bg-slate-950"
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect()
          setPointer({ x: e.clientX - box.left, y: e.clientY - box.top })
        }}
      >
        <Canvas
          frameloop="demand"
          dpr={[1, 2]}
          camera={{ fov: 50, near: 0.1, far: 4000 }}
          gl={{ antialias: true }}
        >
          {cluster ? (
            <Scene
              cluster={cluster}
              selectedKey={selectedKey}
              hoveredKey={hoveredCell?.key ?? null}
              currentKey={inCluster ? (current?.cell.key ?? null) : null}
              currentAddress={inCluster ? currentAddress : null}
              onHover={setHoveredCell}
              onSelect={(cell) => setSelectedKey(cell.key)}
            />
          ) : (
            <OverviewScene
              clusters={visible}
              activeId={activeId}
              currentId={currentClusterId}
              idOf={clusterId}
              onHover={setHoveredCluster}
              onSelect={(entry) => setActiveId(clusterId(entry))}
            />
          )}
        </Canvas>

        {(hoveredCell || hoveredCluster) && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border border-slate-600/60 bg-slate-900/95 px-2 py-1.5 text-[10px] shadow-lg"
            style={{ left: pointer.x + 14, top: pointer.y + 14 }}
          >
            {hoveredCell ? (
              <>
                <span className="block font-medium text-slate-100">
                  {regionLabel(hoveredCell.x, hoveredCell.y, hoveredCell.z)}
                </span>
                <span className="block text-slate-400">
                  {hoveredCell.systems.length} system
                  {hoveredCell.systems.length === 1 ? '' : 's'} ·{' '}
                  {GUILD_LABELS[guildKey(hoveredCell.guild)]}
                </span>
                {inCluster && hoveredCell.key === current?.cell.key && (
                  <span className="block" style={{ color: CURRENT_COLOR }}>
                    You are here — {current.system.name}
                  </span>
                )}
              </>
            ) : (
              hoveredCluster && (
                <>
                  <span className="block font-medium text-slate-100">
                    {clusterLabel(hoveredCluster)}
                  </span>
                  <span className="block text-slate-400">
                    {hoveredCluster.cells.length} region
                    {hoveredCluster.cells.length === 1 ? '' : 's'} · {hoveredCluster.systemCount}{' '}
                    system{hoveredCluster.systemCount === 1 ? '' : 's'}
                  </span>
                  <span className="block text-slate-500">
                    {formatLightYears(hoveredCluster.coreLy)} from core
                  </span>
                  {clusterId(hoveredCluster) === currentClusterId && (
                    <span className="block" style={{ color: CURRENT_COLOR }}>
                      You are here — {current?.system.name}
                    </span>
                  )}
                </>
              )
            )}
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5 rounded-lg border border-slate-700/50 bg-slate-900/80 px-3 py-2 text-[10px]">
          {cluster ? (
            <>
              {GUILD_KEYS.map((key) => {
                const Icon = GUILD_ICONS[key]
                return (
                  <span key={key} className="flex items-center gap-1.5 text-slate-300">
                    <span
                      className="h-2 w-2 rounded-[2px]"
                      style={{ backgroundColor: GUILD_COLORS[key] }}
                    />
                    <Icon className="h-3 w-3 opacity-70" />
                    {GUILD_LABELS[key]}
                  </span>
                )
              })}
              {inCluster && (
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className="h-2 w-2 rounded-[2px]"
                    style={{ backgroundColor: CURRENT_COLOR }}
                  />
                  <MapPin className="h-3 w-3 opacity-70" />
                  You are here
                </span>
              )}
              <span className="mt-0.5 flex items-center gap-1.5 border-t border-slate-700/50 pt-1.5 text-slate-400">
                <Compass className="h-3 w-3 opacity-70" />
                Core {formatLightYears(cluster.coreLy)} — arrow shows direction, not scale
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: CORE_COLOR }}
                />
                Galactic core
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: MARKER_COLOR }}
                />
                Neighbourhood — size by system count
              </span>
              {current && (
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: CURRENT_COLOR }}
                  />
                  <MapPin className="h-3 w-3 opacity-70" />
                  You are here
                </span>
              )}
              <span className="mt-0.5 border-t border-slate-700/50 pt-1.5 text-slate-400">
                Rings every {formatLightYears(RING_STEP_LY)} · true relative positions
              </span>
            </>
          )}
        </div>

        <div className="pointer-events-none absolute top-3 right-3 rounded-lg border border-slate-700/50 bg-slate-900/80 px-3 py-1.5 text-[10px] text-slate-400">
          Drag to orbit · scroll to zoom · click a {cluster ? 'cube' : 'neighbourhood'}
        </div>
      </div>

      <RegionPanel
        cell={selectedCell}
        emptyHint={
          cluster
            ? 'Click a region cube to see the systems inside it.'
            : 'Click a neighbourhood to open its regions.'
        }
        currentAddress={currentAddress}
        onJumpToSystem={onJumpToSystem}
      />
    </div>
  )
}
