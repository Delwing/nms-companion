import { useMemo, useState } from 'react'
import { Building2, FlaskConical, Home, MapPin, X } from 'lucide-react'
import type { BaseRecord, PlanetRecord, SystemRecord } from '@shared/types'
import { KNOWN_RESOURCES } from '@shared/resources'
import { compareResources } from '@shared/resourceMeta'
import { ResourceDiamond } from './ResourceBadge'

type SidebarTab = 'resources' | 'bases'

interface SidebarProps {
  systems: SystemRecord[]
  planets: PlanetRecord[]
  bases: BaseRecord[]
  selectedResources: string[]
  onToggleResource: (resource: string) => void
  onClearResources: () => void
  /** Jump the catalogue to a system card (clears filters so it's visible). */
  onJumpToSystem: (address: string) => void
}

/** Right-hand panel: resource filters and a base directory for quick jumps. */
export function Sidebar({
  systems,
  planets,
  bases,
  selectedResources,
  onToggleResource,
  onClearResources,
  onJumpToSystem
}: SidebarProps): React.JSX.Element {
  const [tab, setTab] = useState<SidebarTab>('resources')

  // How many catalogued systems have each resource on at least one planet.
  const systemCounts = useMemo(() => {
    const perResource = new Map<string, Set<string>>()
    for (const p of planets) {
      if (!p.systemAddress) continue
      for (const res of p.resources) {
        if (!perResource.has(res)) perResource.set(res, new Set())
        perResource.get(res)!.add(p.systemAddress)
      }
    }
    return new Map([...perResource].map(([res, set]) => [res, set.size]))
  }, [planets])

  // Known resources first by how common they are in the catalogue, then the
  // rest of the recognisable list grouped by game family (dimmed, still
  // selectable) so like-coloured resources cluster together.
  const resourceList = useMemo(() => {
    const catalogued = [...systemCounts.keys()].sort(
      (a, b) => systemCounts.get(b)! - systemCounts.get(a)! || a.localeCompare(b)
    )
    const rest = KNOWN_RESOURCES.filter((r) => !systemCounts.has(r)).sort(compareResources)
    return [...catalogued, ...rest]
  }, [systemCounts])

  const systemName = useMemo(() => {
    const map = new Map(systems.map((s) => [s.universalAddress, s.name]))
    return (address: string): string => map.get(address) ?? address
  }, [systems])

  const planetName = useMemo(() => {
    const map = new Map(
      planets
        .filter((p) => p.systemAddress && p.planetIndex !== null)
        .map((p) => [`${p.systemAddress}:${p.planetIndex}`, p.name])
    )
    return (base: BaseRecord): string | null =>
      base.planetIndex === null ? null : (map.get(`${base.systemAddress}:${base.planetIndex}`) ?? null)
  }, [planets])

  const sortedBases = useMemo(
    () => [...bases].sort((a, b) => a.name.localeCompare(b.name)),
    [bases]
  )

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-slate-700/50 bg-slate-900/60">
      <div className="flex border-b border-slate-700/50 text-xs">
        <button
          onClick={() => setTab('resources')}
          className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 font-medium transition-colors ${
            tab === 'resources'
              ? 'border-b-2 border-cyan-400 bg-cyan-500/10 text-cyan-200'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FlaskConical className="h-3.5 w-3.5" /> Resources
          {selectedResources.length > 0 && (
            <span className="rounded-full bg-cyan-500/30 px-1.5 text-[10px] text-cyan-200">
              {selectedResources.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('bases')}
          className={`flex flex-1 items-center justify-center gap-1.5 px-2 py-2 font-medium transition-colors ${
            tab === 'bases'
              ? 'border-b-2 border-emerald-400 bg-emerald-500/10 text-emerald-200'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Home className="h-3.5 w-3.5" /> Bases
          {bases.length > 0 && (
            <span className="rounded-full bg-emerald-500/30 px-1.5 text-[10px] text-emerald-200">
              {bases.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'resources' ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
            <span className="text-[10px] tracking-wide text-slate-500 uppercase">
              Filter systems by resource
            </span>
            {selectedResources.length > 0 && (
              <button
                onClick={onClearResources}
                className="flex items-center gap-0.5 rounded px-1 text-[10px] text-slate-400 hover:text-red-300"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <div className="flex flex-wrap gap-1.5">
              {resourceList.map((res) => {
                const active = selectedResources.includes(res)
                const count = systemCounts.get(res) ?? 0
                return (
                  <button
                    key={res}
                    onClick={() => onToggleResource(res)}
                    title={
                      count > 0
                        ? `${count} system${count === 1 ? '' : 's'} with ${res}`
                        : `${res} — not catalogued yet`
                    }
                    className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                      active
                        ? 'border-cyan-400/60 bg-cyan-500/25 text-cyan-100'
                        : count > 0
                          ? 'border-slate-600/50 bg-slate-800/60 text-slate-200 hover:border-cyan-400/50'
                          : 'border-slate-700/60 bg-slate-800/40 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <ResourceDiamond
                      name={res}
                      className={count > 0 ? 'h-2 w-2' : 'h-2 w-2 opacity-50'}
                    />
                    {res}
                    {count > 0 && (
                      <span className={active ? 'text-cyan-200/80' : 'text-slate-500'}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          {sortedBases.length === 0 ? (
            <p className="p-3 text-center text-[11px] text-slate-500">
              No bases yet — they're imported from your save.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {sortedBases.map((base) => {
                const planet = planetName(base)
                return (
                  <button
                    key={base.id}
                    onClick={() => onJumpToSystem(base.systemAddress)}
                    title="Show this system in the catalogue"
                    className="group rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-emerald-500/30 hover:bg-emerald-500/5"
                  >
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
                      {base.baseType === 'Settlement' ? (
                        <Building2 className="h-3 w-3 shrink-0 text-amber-400" />
                      ) : (
                        <Home className="h-3 w-3 shrink-0 text-emerald-400" />
                      )}
                      <span className="truncate">{base.name}</span>
                      {base.baseType === 'FreighterBase' && (
                        <span className="rounded bg-slate-700/60 px-1 text-[9px] text-slate-400">
                          freighter
                        </span>
                      )}
                      {base.baseType === 'Settlement' && (
                        <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300">
                          settlement
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1 pl-4.5 text-[10px] text-slate-500 group-hover:text-slate-400">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      <span className="truncate">
                        {systemName(base.systemAddress)}
                        {planet ? ` · ${planet}` : base.planetIndex !== null ? ` · Planet ${base.planetIndex}` : ''}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
