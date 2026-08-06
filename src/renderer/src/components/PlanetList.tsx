import { useState } from 'react'
import { CloudSun, Globe2, Leaf, PawPrint, Shield, Trash2 } from 'lucide-react'
import type { PlanetRecord, SystemRecord } from '@shared/types'
import { ResourceChip } from './ResourceBadge'

interface PlanetListProps {
  planets: PlanetRecord[]
  systems: SystemRecord[]
  onAssignSystem: (id: number, systemAddress: string | null) => void
  onDelete: (id: number) => void
}

/** Compact rows of OCR-scanned planets with their extracted metadata. */
export function PlanetList({
  planets,
  systems,
  onAssignSystem,
  onDelete
}: PlanetListProps): React.JSX.Element {
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  if (planets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-700/60 p-6 text-center text-xs text-slate-500">
        No planets scanned yet — open the Analysis Visor or Discovery panel in-game and press{' '}
        <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-cyan-300">Alt+C</kbd>.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {planets.map((planet) => (
        <div
          key={planet.id}
          className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-slate-700/60 bg-slate-900/70 px-4 py-2.5"
        >
          <div className="flex min-w-40 items-center gap-2">
            <Globe2 className="h-4 w-4 shrink-0 text-cyan-400" />
            <div className="leading-tight">
              <span className="text-sm font-medium text-slate-100">{planet.name}</span>
              {planet.source === 'save' && (
                <span
                  className="ml-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] text-indigo-300"
                  title="Imported from your save's discovery records"
                >
                  save
                </span>
              )}
              <p className="text-[10px] text-slate-500">
                {planet.type}
                {planet.planetIndex !== null && ` · #${planet.planetIndex}`} ·{' '}
                {new Date(planet.scannedAt).toLocaleString()}
              </p>
            </div>
          </div>

          {planet.type === 'Unknown' && planet.source === 'save' ? (
            <span className="text-[11px] text-slate-500 italic">
              Not scanned yet — visit and press Alt+C
            </span>
          ) : (
            <>
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <CloudSun className="h-3 w-3 text-amber-300/80" /> {planet.weather}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Shield className="h-3 w-3 text-red-300/80" /> {planet.sentinels}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <Leaf className="h-3 w-3 text-emerald-300/80" /> {planet.flora}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-slate-400">
                <PawPrint className="h-3 w-3 text-orange-300/80" /> {planet.fauna}
              </span>
            </>
          )}

          {planet.resources.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {planet.resources.map((res) => (
                <ResourceChip key={res} name={res} />
              ))}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {!planet.systemAddress && planet.systemHint && (
              <span
                className="rounded-full border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300"
                title="System name read from the scan's Discoveries header — not yet in your catalogue"
              >
                seen in {planet.systemHint}
              </span>
            )}
            <select
              value={planet.systemAddress ?? ''}
              onChange={(e) => onAssignSystem(planet.id, e.target.value || null)}
              className="max-w-44 rounded border border-slate-700/60 bg-slate-800/80 px-2 py-1 text-[11px] text-slate-300 focus:border-cyan-500/50 focus:outline-none"
              title="Assign to system"
            >
              <option value="">— no system —</option>
              {systems.map((sys) => (
                <option key={sys.universalAddress} value={sys.universalAddress}>
                  {sys.name}
                </option>
              ))}
              {planet.systemAddress &&
                !systems.some((s) => s.universalAddress === planet.systemAddress) && (
                  <option value={planet.systemAddress}>{planet.systemAddress}</option>
                )}
            </select>

            {confirmingId === planet.id ? (
              <button
                onClick={() => {
                  setConfirmingId(null)
                  onDelete(planet.id)
                }}
                onBlur={() => setConfirmingId(null)}
                className="rounded border border-red-500/50 bg-red-500/20 px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/30"
              >
                Confirm?
              </button>
            ) : (
              <button
                onClick={() => setConfirmingId(planet.id)}
                className="rounded border border-slate-700/60 p-1.5 text-slate-500 hover:border-red-500/40 hover:text-red-400"
                title="Delete planet"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
