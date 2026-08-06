/**
 * Detail for the region cube currently selected on the map. Clicking a system
 * hands off to the catalogue through the same `onJumpToSystem` callback the
 * bases sidebar uses, so the map needs no navigation plumbing of its own.
 */
import { MapPin, Sparkles } from 'lucide-react'
import type { RegionCell } from '@shared/galaxyMap'
import { boosterCoords, distanceToCoreLy, formatLightYears, regionLabel } from '@shared/galaxy'
import { CURRENT_COLOR, GUILD_COLORS, GUILD_ICONS, GUILD_LABELS, guildKey } from './theme'

interface RegionPanelProps {
  cell: RegionCell | null
  /** Shown when nothing is selected; differs between overview and lattice. */
  emptyHint: string
  /** The player's system, flagged in the list when it sits in this region. */
  currentAddress: string | null
  onJumpToSystem: (address: string) => void
}

export function RegionPanel({
  cell,
  emptyHint,
  currentAddress,
  onJumpToSystem
}: RegionPanelProps): React.JSX.Element {
  if (!cell) {
    return (
      <aside className="flex w-64 shrink-0 flex-col justify-center border-l border-slate-700/50 bg-slate-900/60 p-4">
        <p className="text-center text-[11px] text-slate-500">{emptyHint}</p>
      </aside>
    )
  }

  const key = guildKey(cell.guild)
  const GuildIcon = GUILD_ICONS[key]
  const systems = [...cell.systems].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <aside className="flex w-64 shrink-0 flex-col border-l border-slate-700/50 bg-slate-900/60">
      <div className="border-b border-slate-700/50 px-3 py-2.5">
        <h2 className="text-xs font-medium text-slate-200">
          {regionLabel(cell.x, cell.y, cell.z)}
        </h2>
        <p className="mt-1 flex items-center gap-1.5 text-[10px]" style={{ color: GUILD_COLORS[key] }}>
          <GuildIcon className="h-3 w-3" />
          {GUILD_LABELS[key]}
        </p>
        <p className="mt-1 text-[10px] text-slate-500">
          {formatLightYears(distanceToCoreLy(cell.x, cell.y, cell.z))} from core ·{' '}
          {cell.systems.length} system{cell.systems.length === 1 ? '' : 's'}
        </p>
        <p className="mt-1 font-mono text-[9px] text-slate-600">
          {boosterCoords(cell.x, cell.y, cell.z, 0).split(':').slice(0, 3).join(':')}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1">
          {systems.map((system) => (
            <button
              key={system.universalAddress}
              onClick={() => onJumpToSystem(system.universalAddress)}
              title="Show this system in the catalogue"
              className="group rounded-lg border border-transparent px-2.5 py-1.5 text-left transition-colors hover:border-cyan-500/30 hover:bg-cyan-500/5"
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-200">
                {system.universalAddress === currentAddress ? (
                  <MapPin className="h-3 w-3 shrink-0" style={{ color: CURRENT_COLOR }} />
                ) : system.isBlackHole ? (
                  <Sparkles className="h-3 w-3 shrink-0 text-violet-400" />
                ) : (
                  <MapPin className="h-3 w-3 shrink-0 text-slate-500" />
                )}
                <span className="truncate">{system.name}</span>
                {system.universalAddress === currentAddress && (
                  <span className="shrink-0 text-[9px]" style={{ color: CURRENT_COLOR }}>
                    here
                  </span>
                )}
              </span>
              {(system.economy || system.race) && (
                <span className="mt-0.5 block truncate pl-4.5 text-[10px] text-slate-500 group-hover:text-slate-400">
                  {[system.race, system.economy].filter(Boolean).join(' · ')}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}
