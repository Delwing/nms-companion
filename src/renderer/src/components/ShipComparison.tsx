import { useMemo } from 'react'
import { Rocket, Star, Zap } from 'lucide-react'
import type { ShipRecord } from '@shared/types'

interface ShipComparisonProps {
  ships: ShipRecord[]
}

/** The four comparable base stats, in the game's display order. */
const STAT_ROWS = [
  { key: 'damage', label: 'Damage' },
  { key: 'shield', label: 'Shield' },
  { key: 'hyperdrive', label: 'Hyperdrive' },
  { key: 'agility', label: 'Agility' }
] as const

type StatKey = (typeof STAT_ROWS)[number]['key']

const CLASS_RANK: Record<string, number> = { S: 3, A: 2, B: 1, C: 0 }

function classBadgeStyle(inventoryClass: string): string {
  switch (inventoryClass) {
    case 'S':
      return 'border-amber-400/60 bg-amber-500/20 text-amber-300'
    case 'A':
      return 'border-violet-400/60 bg-violet-500/20 text-violet-300'
    case 'B':
      return 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300'
    default:
      return 'border-slate-500/60 bg-slate-600/30 text-slate-300'
  }
}

function shipLabel(ship: ShipRecord): string {
  return ship.name ?? `${ship.archetype === 'Unknown' ? 'Ship' : ship.archetype} ${ship.index + 1}`
}

/**
 * Side-by-side cards comparing the owned ships on their save-stored base
 * stat bonuses and slot capacities. Bars are scaled to the fleet's best
 * value per stat; the best ship(s) per stat get a star so the comparison
 * doesn't rely on bar length (or colour) alone.
 */
export function ShipComparison({ ships }: ShipComparisonProps): React.JSX.Element {
  const sorted = useMemo(
    () =>
      [...ships].sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) ||
          (CLASS_RANK[b.inventoryClass] ?? 0) - (CLASS_RANK[a.inventoryClass] ?? 0) ||
          b.storageSlots - a.storageSlots
      ),
    [ships]
  )

  // Fleet best per stat: scales the bars and picks the starred value(s).
  const best = useMemo(() => {
    const out = {} as Record<StatKey, number>
    for (const { key } of STAT_ROWS) {
      out[key] = Math.max(0, ...ships.map((s) => s[key] ?? 0))
    }
    return out
  }, [ships])

  if (ships.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-xs text-slate-500">
          No ships yet — they're imported from your save once it's synced.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
          Owned Ships ({ships.length})
        </h2>
        <p className="text-[10px] text-slate-500">
          Base class bonuses from the save — in-game totals also count installed tech
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
        {sorted.map((ship) => (
          <article
            key={ship.index}
            title={ship.seed ? `Seed ${ship.seed}` : undefined}
            className={`rounded-xl border bg-slate-900/60 p-3.5 ${
              ship.isPrimary ? 'border-cyan-500/50' : 'border-slate-700/50'
            }`}
          >
            <header className="flex items-center gap-2">
              <Rocket
                className={`h-3.5 w-3.5 shrink-0 ${ship.isPrimary ? 'text-cyan-300' : 'text-slate-500'}`}
              />
              <span className="truncate text-xs font-semibold text-slate-100">
                {shipLabel(ship)}
              </span>
              <span
                className={`rounded border px-1.5 font-mono text-[10px] font-bold ${classBadgeStyle(ship.inventoryClass)}`}
              >
                {ship.inventoryClass}
              </span>
              {ship.isPrimary && (
                <span className="rounded-full border border-cyan-500/40 bg-cyan-500/15 px-1.5 text-[9px] text-cyan-200">
                  flying
                </span>
              )}
            </header>
            {/* Unnamed ships already carry the archetype in their label. */}
            {ship.name && (
              <p className="mt-0.5 pl-5.5 text-[10px] text-slate-500">{ship.archetype}</p>
            )}

            <div className="mt-2.5 flex flex-col gap-1.5">
              {STAT_ROWS.map(({ key, label }) => {
                const value = ship[key]
                // Float stat values: "equal to the fleet best" needs a tolerance.
                const isBest = value !== null && best[key] > 0 && best[key] - value < 0.05
                const width = value === null || best[key] === 0 ? 0 : (value / best[key]) * 100
                return (
                  <div key={key} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] tracking-wide text-slate-500 uppercase">
                      {label}
                    </span>
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${isBest ? 'bg-cyan-300' : 'bg-cyan-600/70'}`}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right font-mono text-[10px] text-slate-200">
                      {value === null ? '—' : `+${value}%`}
                    </span>
                    <span className="w-3 shrink-0">
                      {isBest && (
                        <Star
                          className="h-2.5 w-2.5 fill-amber-300 text-amber-300"
                          aria-label="Best in fleet"
                        />
                      )}
                    </span>
                  </div>
                )
              })}
            </div>

            <footer className="mt-2.5 flex items-center gap-3 border-t border-slate-800 pt-2 text-[10px] text-slate-400">
              <span>
                Storage <span className="font-mono text-slate-200">{ship.storageSlots}</span>
              </span>
              <span>
                Tech <span className="font-mono text-slate-200">{ship.techSlots}</span>
              </span>
              {ship.cargoSlots > 0 && (
                <span>
                  Cargo <span className="font-mono text-slate-200">{ship.cargoSlots}</span>
                </span>
              )}
              <span
                className="ml-auto flex items-center gap-0.5 text-amber-300"
                title={`Supercharged slots — storage ${ship.storageSupercharged}, tech ${ship.techSupercharged}`}
              >
                <Zap className="h-3 w-3 fill-amber-300/40" />
                <span className="font-mono">
                  {ship.storageSupercharged + ship.techSupercharged}
                </span>
              </span>
            </footer>
          </article>
        ))}
      </div>
    </div>
  )
}
