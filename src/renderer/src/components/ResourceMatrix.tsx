import { useMemo } from 'react'
import { AlertTriangle, Check, Copy, Home, ScanSearch } from 'lucide-react'
import type { BaseRecord, PlanetRecord, SystemRecord } from '@shared/types'
import { KNOWN_RESOURCES } from '@shared/resources'
import { compareResources, resourceMeta } from '@shared/resourceMeta'
import { ResourceChip, ResourceDiamond } from './ResourceBadge'

interface ResourceMatrixProps {
  systems: SystemRecord[]
  planets: PlanetRecord[]
  bases: BaseRecord[]
  /** Open the catalogue filtered to this resource (to find a spot for a new outpost). */
  onShowResource: (resource: string) => void
  /** Jump to a system card in the catalogue. */
  onJumpToSystem: (address: string) => void
}

interface Column {
  base: BaseRecord
  /** Planet record the base sits on, if we have one. */
  planet: PlanetRecord | null
  /** Distinct-planet key so two bases on one planet count as one covering spot. */
  planetKey: string
  systemName: string
}

type RowStatus = 'missing' | 'multi' | 'ok'

interface Row {
  resource: string
  status: RowStatus
  /** Distinct planets with a base that have this resource. */
  coveredPlanets: number
  /** Catalogued systems where this resource is known to exist. */
  knownSystems: number
}

const STATUS_ORDER: Record<RowStatus, number> = { missing: 0, multi: 1, ok: 2 }

/**
 * Coverage matrix: catalogued resources as rows, planet bases as columns.
 * Flags resources no outpost covers and ones covered from several planets.
 */
export function ResourceMatrix({
  systems,
  planets,
  bases,
  onShowResource,
  onJumpToSystem
}: ResourceMatrixProps): React.JSX.Element {
  const systemName = useMemo(() => {
    const map = new Map(systems.map((s) => [s.universalAddress, s.name]))
    return (address: string): string => map.get(address) ?? address
  }, [systems])

  // Best planet record per system:planetIndex slot (prefer ones with scan data).
  const planetByKey = useMemo(() => {
    const map = new Map<string, PlanetRecord>()
    for (const p of planets) {
      if (!p.systemAddress || p.planetIndex === null) continue
      const key = `${p.systemAddress}:${p.planetIndex}`
      const existing = map.get(key)
      if (!existing || (existing.resources.length === 0 && p.resources.length > 0)) {
        map.set(key, p)
      }
    }
    return map
  }, [planets])

  const freighterBases = useMemo(() => bases.filter((b) => b.planetIndex === null), [bases])

  const columns = useMemo<Column[]>(() => {
    return bases
      .filter((b) => b.planetIndex !== null)
      .map((base) => {
        const planetKey = `${base.systemAddress}:${base.planetIndex}`
        return {
          base,
          planet: planetByKey.get(planetKey) ?? null,
          planetKey,
          systemName: systemName(base.systemAddress)
        }
      })
      .sort(
        (a, b) =>
          a.systemName.localeCompare(b.systemName) ||
          (a.base.planetIndex ?? 0) - (b.base.planetIndex ?? 0) ||
          a.base.name.localeCompare(b.base.name)
      )
  }, [bases, planetByKey, systemName])

  const rows = useMemo<Row[]>(() => {
    // Which catalogued systems have each resource somewhere.
    const knownSystems = new Map<string, Set<string>>()
    for (const p of planets) {
      if (!p.systemAddress) continue
      for (const res of p.resources) {
        if (!knownSystems.has(res)) knownSystems.set(res, new Set())
        knownSystems.get(res)!.add(p.systemAddress)
      }
    }

    // Distinct base planets covering each resource.
    const coverage = new Map<string, Set<string>>()
    for (const col of columns) {
      for (const res of col.planet?.resources ?? []) {
        if (!coverage.has(res)) coverage.set(res, new Set())
        coverage.get(res)!.add(col.planetKey)
      }
    }

    const resources = new Set([...knownSystems.keys(), ...coverage.keys()])
    return [...resources]
      .map((resource) => {
        const coveredPlanets = coverage.get(resource)?.size ?? 0
        const status: RowStatus =
          coveredPlanets === 0 ? 'missing' : coveredPlanets > 1 ? 'multi' : 'ok'
        return {
          resource,
          status,
          coveredPlanets,
          knownSystems: knownSystems.get(resource)?.size ?? 0
        }
      })
      // Within a status band, cluster by game family so like colours sit
      // together — the grouping the game's own panel colours imply.
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          compareResources(a.resource, b.resource)
      )
  }, [planets, columns])

  const missing = rows.filter((r) => r.status === 'missing').length
  const multi = rows.filter((r) => r.status === 'multi').length
  const ok = rows.filter((r) => r.status === 'ok').length
  const unscannedColumns = columns.filter(
    (c) => !c.planet || c.planet.resources.length === 0
  ).length
  const neverSeen = KNOWN_RESOURCES.filter((r) => !rows.some((row) => row.resource === r))

  if (columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
        <div>
          <Home className="mx-auto mb-2 h-6 w-6 text-slate-600" />
          No planet bases catalogued yet — they're imported from your save.
          {freighterBases.length > 0 && (
            <p className="mt-1 text-xs">
              ({freighterBases.length} freighter base{freighterBases.length === 1 ? '' : 's'} excluded
              — a freighter doesn't mine planetary resources.)
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/50 bg-slate-900/70 px-5 py-2.5 text-[11px]">
        <span className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/15 px-2.5 py-0.5 text-red-200">
          <AlertTriangle className="h-3 w-3" /> {missing} without an outpost
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-amber-200">
          <Copy className="h-3 w-3" /> {multi} covered from several planets
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-emerald-200">
          <Check className="h-3 w-3" /> {ok} covered once
        </span>
        <span className="flex-1" />
        {unscannedColumns > 0 && (
          <span
            className="flex items-center gap-1.5 text-amber-300/80"
            title="These base planets have no resource scan — hit Alt+C on their Discoveries card to fill them in."
          >
            <ScanSearch className="h-3.5 w-3.5" /> {unscannedColumns} base planet
            {unscannedColumns === 1 ? '' : 's'} unscanned
          </span>
        )}
        {freighterBases.length > 0 && (
          <span className="text-slate-500">
            {freighterBases.length} freighter base{freighterBases.length === 1 ? '' : 's'} excluded
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <table className="border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 border-b border-slate-700/50 bg-slate-950 px-3 pb-2 text-left align-bottom font-semibold tracking-wide text-slate-400">
                Resource
              </th>
              <th
                className="border-b border-slate-700/50 px-2 pb-2 text-center align-bottom font-normal text-slate-500"
                title="Distinct base planets that have this resource"
              >
                Cover
              </th>
              {columns.map((col) => {
                const unscanned = !col.planet || col.planet.resources.length === 0
                return (
                  <th
                    key={col.base.id}
                    className="h-36 min-w-8 border-b border-slate-700/50 px-0.5 pb-2 align-bottom"
                  >
                    <button
                      onClick={() => onJumpToSystem(col.base.systemAddress)}
                      title={
                        `${col.base.name} — ${col.systemName}` +
                        (col.planet ? ` · ${col.planet.name}` : ` · Planet ${col.base.planetIndex}`) +
                        (unscanned ? ' · no resource scan yet' : '') +
                        ' (click to open in catalogue)'
                      }
                      className="mx-auto flex h-full items-end"
                    >
                      <span
                        className={`block max-h-32 overflow-hidden rotate-180 text-[10px] font-medium text-ellipsis whitespace-nowrap [writing-mode:vertical-rl] ${
                          unscanned ? 'text-amber-300/70' : 'text-slate-300 hover:text-cyan-200'
                        }`}
                      >
                        {col.base.name}
                      </span>
                    </button>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tint =
                row.status === 'missing'
                  ? 'bg-red-500/[0.06]'
                  : row.status === 'multi'
                    ? 'bg-amber-500/[0.05]'
                    : ''
              return (
                <tr key={row.resource} className={tint}>
                  <td
                    className={`sticky left-0 z-10 border-b border-slate-800/60 bg-slate-950 px-3 py-1 whitespace-nowrap ${
                      row.status === 'missing' ? 'text-red-300' : 'text-slate-200'
                    }`}
                  >
                    {row.status === 'missing' ? (
                      <button
                        onClick={() => onShowResource(row.resource)}
                        title={
                          row.knownSystems > 0
                            ? `No outpost — but ${row.knownSystems} catalogued system${row.knownSystems === 1 ? ' has' : 's have'} it. Click to find one.`
                            : 'No outpost, and no catalogued system has it either.'
                        }
                        className="flex items-center gap-1.5 hover:text-red-100 hover:underline"
                      >
                        <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
                        <ResourceDiamond name={row.resource} />
                        {row.resource}
                        {row.knownSystems > 0 && (
                          <span className="text-[10px] text-slate-500">
                            in {row.knownSystems} sys
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5" title={resourceMeta(row.resource).group}>
                        {row.status === 'multi' && (
                          <Copy className="h-3 w-3 shrink-0 text-amber-400" />
                        )}
                        <ResourceDiamond name={row.resource} />
                        {row.resource}
                      </span>
                    )}
                  </td>
                  <td
                    className={`border-b border-slate-800/60 px-2 py-1 text-center font-mono text-[10px] ${
                      row.status === 'missing'
                        ? 'text-red-400'
                        : row.status === 'multi'
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                    }`}
                  >
                    {row.coveredPlanets}
                  </td>
                  {columns.map((col) => {
                    const unscanned = !col.planet || col.planet.resources.length === 0
                    const covered = col.planet?.resources.includes(row.resource) ?? false
                    return (
                      <td
                        key={col.base.id}
                        className="border-b border-slate-800/60 px-0.5 py-1 text-center"
                        title={
                          covered
                            ? `${row.resource} @ ${col.base.name}`
                            : unscanned
                              ? `${col.base.name}: planet not scanned`
                              : undefined
                        }
                      >
                        {covered ? (
                          <span className="mx-auto block h-2.5 w-2.5 rounded-full bg-emerald-400/90" />
                        ) : unscanned ? (
                          <span className="text-[10px] text-slate-600">?</span>
                        ) : null}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>

        {neverSeen.length > 0 && (
          <div className="mt-6 max-w-2xl">
            <h3 className="mb-2 text-[10px] font-semibold tracking-[0.2em] text-slate-500 uppercase">
              Not seen in the catalogue yet
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {[...neverSeen].sort(compareResources).map((res) => (
                <ResourceChip key={res} name={res} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
