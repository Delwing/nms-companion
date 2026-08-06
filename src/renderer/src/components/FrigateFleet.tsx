import { useMemo, useState } from 'react'
import { Coins, Compass, Fuel, Pickaxe, Ship, Star, Swords } from 'lucide-react'
import type { FrigateRecord, FrigateType } from '@shared/types'

interface FrigateFleetProps {
  frigates: FrigateRecord[]
}

/** The four expedition stats every frigate is compared on, in game order. */
const STAT_ROWS = [
  { key: 'combat', label: 'Combat' },
  { key: 'exploration', label: 'Explore' },
  { key: 'industrial', label: 'Industry' },
  { key: 'trade', label: 'Trade' }
] as const

type StatKey = (typeof STAT_ROWS)[number]['key']

const TYPE_ORDER: FrigateType[] = ['Combat', 'Exploration', 'Industrial', 'Trade', 'Support']

const TYPE_ICONS: Record<FrigateType, React.JSX.Element> = {
  Combat: <Swords className="h-3.5 w-3.5" />,
  Exploration: <Compass className="h-3.5 w-3.5" />,
  Industrial: <Pickaxe className="h-3.5 w-3.5" />,
  Trade: <Coins className="h-3.5 w-3.5" />,
  Support: <Fuel className="h-3.5 w-3.5" />,
  Unknown: <Ship className="h-3.5 w-3.5" />
}

const CLASS_RANK: Record<string, number> = { S: 3, A: 2, B: 1, C: 0 }
const GRADE_ORDER = ['S', 'A', 'B', 'C']

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

/** Trait id category token -> the stat it affects, in display terms. */
const TRAIT_CATEGORIES: Record<string, string> = {
  COMBAT: 'Combat',
  EXPLORE: 'Exploration',
  MINING: 'Industry',
  TRADING: 'Trade',
  FUEL: 'Fuel',
  SPEED: 'Speed',
  INVULN: 'Durability',
  LOOT: 'Loot',
  REPAIR: 'Repair',
  STEALTH: 'Stealth'
}

/**
 * Human-readable trait chip from an id like 'TRADING_SEC_6'. The tier token
 * grades the trait: SEC = strong bonus, TER = minor bonus, BAD = penalty.
 * PRI is the class-defining trait every frigate has — redundant with the
 * type shown in the header, so it renders nothing. Unknown shapes fall back
 * to the raw id rather than hiding data.
 */
function traitChip(trait: string): { label: string; tone: 'good' | 'minor' | 'bad' } | null {
  const match = /^([A-Z]+)_(PRI|SEC|TER|BAD)(?:_\d+)?$/.exec(trait)
  if (!match) return { label: trait, tone: 'minor' }
  const [, category, tier] = match
  if (tier === 'PRI') return null
  const label = TRAIT_CATEGORIES[category] ?? category
  if (tier === 'BAD') return { label: `${label} −`, tone: 'bad' }
  if (tier === 'SEC') return { label: `${label} ++`, tone: 'good' }
  return { label: `${label} +`, tone: 'minor' }
}

const TRAIT_TONES = {
  good: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  minor: 'border-slate-600/60 bg-slate-800/60 text-slate-400',
  bad: 'border-red-500/40 bg-red-500/10 text-red-300'
} as const

function frigateLabel(frigate: FrigateRecord): string {
  return frigate.name ?? `${frigate.type} Frigate`
}

/**
 * Fleet overview: one card per frigate with its expedition stats, secondary
 * bonuses and traits, filterable by speciality and grade, with a per-type
 * fleet summary pinned at the bottom. Bars are scaled to the whole fleet's
 * best value per stat (stable while filtering); the fleet-best value(s) get
 * a star.
 */
export function FrigateFleet({ frigates }: FrigateFleetProps): React.JSX.Element {
  const [typeFilter, setTypeFilter] = useState<FrigateType | null>(null)
  const [gradeFilter, setGradeFilter] = useState<string | null>(null)

  const sorted = useMemo(
    () =>
      [...frigates].sort(
        (a, b) =>
          (CLASS_RANK[b.inventoryClass] ?? 0) - (CLASS_RANK[a.inventoryClass] ?? 0) ||
          b.combat + b.exploration + b.industrial + b.trade -
            (a.combat + a.exploration + a.industrial + a.trade)
      ),
    [frigates]
  )

  const shown = useMemo(
    () =>
      sorted.filter(
        (f) =>
          (typeFilter === null || f.type === typeFilter) &&
          (gradeFilter === null || f.inventoryClass === gradeFilter)
      ),
    [sorted, typeFilter, gradeFilter]
  )

  const best = useMemo(() => {
    const out = {} as Record<StatKey, number>
    for (const { key } of STAT_ROWS) {
      out[key] = Math.max(0, ...frigates.map((f) => f[key]))
    }
    return out
  }, [frigates])

  // Per-type tally for the summary bar: count plus the grade letters, so
  // "which ones do I have" is answerable without scrolling the cards.
  const summary = useMemo(
    () =>
      TYPE_ORDER.filter((t) => frigates.some((f) => f.type === t)).map((type) => {
        const grades = frigates
          .filter((f) => f.type === type)
          .map((f) => f.inventoryClass)
          .sort((a, b) => (CLASS_RANK[b] ?? 0) - (CLASS_RANK[a] ?? 0))
        return { type, grades }
      }),
    [frigates]
  )

  const grades = useMemo(
    () => GRADE_ORDER.filter((g) => frigates.some((f) => f.inventoryClass === g)),
    [frigates]
  )

  if (frigates.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-center text-xs text-slate-500">
          No frigates yet — your fleet is imported from your save once it's synced.
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Speciality + grade filters, outside the scroll area. */}
      <div className="flex items-center gap-1.5 border-b border-slate-700/50 bg-slate-900/70 px-5 py-2.5">
        <FilterChip active={typeFilter === null} label="All" onClick={() => setTypeFilter(null)} />
        {summary.map(({ type, grades: typeGrades }) => (
          <FilterChip
            key={type}
            active={typeFilter === type}
            icon={TYPE_ICONS[type]}
            label={`${type} · ${typeGrades.length}`}
            onClick={() => setTypeFilter((t) => (t === type ? null : type))}
          />
        ))}
        {grades.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5">
            {grades.map((grade) => (
              <button
                key={grade}
                onClick={() => setGradeFilter((g) => (g === grade ? null : grade))}
                title={`Only ${grade}-class frigates`}
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold transition-colors ${
                  gradeFilter === null || gradeFilter === grade
                    ? classBadgeStyle(grade)
                    : 'border-slate-700/60 bg-slate-900/60 text-slate-600'
                } ${gradeFilter === grade ? 'ring-1 ring-cyan-400/60' : ''}`}
              >
                {grade}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
            Fleet Frigates ({shown.length === frigates.length ? frigates.length : `${shown.length} of ${frigates.length}`})
          </h2>
          <p className="text-[10px] text-slate-500">
            Stats from the save — the numbers on the frigate's in-game info page
          </p>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
          {shown.map((frigate) => (
            <FrigateCard key={frigate.index} frigate={frigate} best={best} />
          ))}
        </div>
      </div>

      {/* Fleet composition summary, pinned below the cards. */}
      <div className="flex items-center gap-3 border-t border-slate-700/50 bg-slate-900/70 px-5 py-2 text-[10px] text-slate-400">
        <span className="font-semibold tracking-wider text-slate-500 uppercase">Fleet</span>
        <span>
          <span className="font-mono text-slate-200">{frigates.length}</span>/30
        </span>
        {summary.map(({ type, grades: typeGrades }) => (
          <button
            key={type}
            onClick={() => setTypeFilter((t) => (t === type ? null : type))}
            title={`Show only ${type} frigates`}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors ${
              typeFilter === type ? 'bg-cyan-500/15 text-cyan-200' : 'hover:text-slate-200'
            }`}
          >
            <span className="text-slate-500">{TYPE_ICONS[type]}</span>
            {type} <span className="font-mono text-slate-200">×{typeGrades.length}</span>
            <span className="font-mono text-slate-500">({typeGrades.join(' ')})</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function FilterChip({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean
  icon?: React.JSX.Element
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
          : 'border-slate-700/60 bg-slate-900/60 text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon} {label}
    </button>
  )
}

function FrigateCard({
  frigate,
  best
}: {
  frigate: FrigateRecord
  best: Record<StatKey, number>
}): React.JSX.Element {
  const chips = frigate.traits
    .map(traitChip)
    .filter((c): c is NonNullable<ReturnType<typeof traitChip>> => c !== null)

  // Secondary stats a trait can grant; usually 0, so only shown when present.
  const extras = [
    frigate.fuelCapacity > 0 && `+${frigate.fuelCapacity} fuel cap`,
    frigate.speed > 0 && `+${frigate.speed} speed`,
    frigate.extraLoot > 0 && `+${frigate.extraLoot} loot`,
    frigate.repair > 0 && `+${frigate.repair} repair`,
    frigate.invulnerability > 0 && `+${frigate.invulnerability} durability`,
    frigate.stealth > 0 && `+${frigate.stealth} stealth`
  ].filter(Boolean) as string[]

  const events = frigate.successfulEvents + frigate.failedEvents
  const successPct = events > 0 ? Math.round((frigate.successfulEvents / events) * 100) : null

  return (
    <article className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3.5">
      <header className="flex items-center gap-2">
        <span className="shrink-0 text-slate-500">{TYPE_ICONS[frigate.type]}</span>
        <span className="truncate text-xs font-semibold text-slate-100">
          {frigateLabel(frigate)}
        </span>
        <span
          className={`rounded border px-1.5 font-mono text-[10px] font-bold ${classBadgeStyle(frigate.inventoryClass)}`}
        >
          {frigate.inventoryClass}
        </span>
      </header>
      <p className="mt-0.5 pl-5.5 text-[10px] text-slate-500">
        {[frigate.name && frigate.type, frigate.race, `Fuel ${frigate.fuelBurnRate}t`]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {STAT_ROWS.map(({ key, label }) => {
          const value = frigate[key]
          const isBest = best[key] > 0 && value === best[key]
          const width = best[key] === 0 ? 0 : (value / best[key]) * 100
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
              <span className="w-8 shrink-0 text-right font-mono text-[10px] text-slate-200">
                {value}
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

      {(extras.length > 0 || chips.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {chips.map((chip, i) => (
            <span
              key={i}
              className={`rounded-full border px-1.5 py-0.5 text-[9px] ${TRAIT_TONES[chip.tone]}`}
            >
              {chip.label}
            </span>
          ))}
          {extras.map((extra) => (
            <span
              key={extra}
              className="rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] text-sky-300"
            >
              {extra}
            </span>
          ))}
        </div>
      )}

      <footer className="mt-2.5 flex items-center gap-3 border-t border-slate-800 pt-2 text-[10px] text-slate-400">
        <span>
          Expeditions <span className="font-mono text-slate-200">{frigate.expeditions}</span>
        </span>
        {successPct !== null && (
          <span title={`${frigate.successfulEvents} events succeeded, ${frigate.failedEvents} failed`}>
            Events <span className="font-mono text-slate-200">{successPct}%</span>
          </span>
        )}
        {frigate.timesDamaged > 0 && (
          <span className="ml-auto" title="Times this frigate returned damaged">
            Damaged <span className="font-mono text-amber-300">{frigate.timesDamaged}×</span>
          </span>
        )}
      </footer>
    </article>
  )
}
