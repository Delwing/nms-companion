import { useEffect, useMemo, useState } from 'react'
import {
  Building2,
  CircleDot,
  CircleOff,
  Coins,
  Compass,
  Globe2,
  Hexagon,
  Home,
  Landmark,
  MapPin,
  NotebookPen,
  Orbit,
  Skull,
  Swords,
  Trash2,
  Unlink,
  Users,
  Wrench
} from 'lucide-react'
import type {
  BaseRecord,
  GuildStanding,
  GuildType,
  PlanetRecord,
  SystemPatch,
  SystemRecord
} from '@shared/types'
import { ENVOY_STOCK_ROWS, envoyItemLocked, GUILD_RANKS } from '@shared/guildRanks'
import {
  boosterCoords,
  closestToCoreByGalaxy,
  distanceToCoreLy,
  formatLightYears,
  portalCode,
  regionKey,
  regionLabel
} from '@shared/galaxy'
import { inferredGuildFor, inferRegionGuilds } from '@shared/regionGuilds'
import { PortalChip } from './PortalChip'
import { ResourceChip } from './ResourceBadge'

interface StationGridProps {
  systems: SystemRecord[]
  planets: PlanetRecord[]
  bases: BaseRecord[]
  /** Player's per-guild standing; decides which envoy stock badges are locked. */
  standings: GuildStanding[]
  /** Universal address of the player's current system; its card is pinned on top. */
  currentAddress: string | null
  /** Free-text filter (name, galaxy, race, economy, tags, notes, planets, bases). */
  filter: string
  groupByRegion: boolean
  /** Only show systems that have every one of these resources on some planet. */
  selectedResources: string[]
  /** Card to scroll into view and flash (e.g. from the bases sidebar). */
  focusAddress: string | null
  onFocusHandled: () => void
  onPatch: (address: string, patch: SystemPatch) => void
  onUnassignPlanet: (id: number) => void
  onDeletePlanet: (id: number) => void
}

const GUILDS: { value: GuildType; label: string; icon: React.JSX.Element }[] = [
  { value: 'Merchants', label: 'Merchants', icon: <Landmark className="h-3 w-3" /> },
  { value: 'Explorers', label: 'Explorers', icon: <Compass className="h-3 w-3" /> },
  { value: 'Mercenaries', label: 'Mercenaries', icon: <Swords className="h-3 w-3" /> }
]

/**
 * The station slot is one mutually-exclusive state: unknown, one of the
 * three guilds, an outlaw station (pirate), or no station at all.
 */
type StationSlot = GuildType | 'pirate' | 'stationless'

const SLOT_ORDER: StationSlot[] = [
  null,
  'Merchants',
  'Explorers',
  'Mercenaries',
  'pirate',
  'stationless'
]

/** Text-filter keywords for the non-normal station states. */
const STATION_SEARCH: Record<'pirate' | 'stationless', string> = {
  pirate: 'pirate outlaw',
  stationless: 'stationless no station abandoned'
}

function Toggle({
  active,
  label,
  icon,
  onClick
}: {
  active: boolean
  label: string
  icon: React.JSX.Element
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
          : 'border-slate-600/60 bg-slate-800/60 text-slate-400 hover:border-slate-500 hover:text-slate-200'
      }`}
    >
      {icon} {label}
    </button>
  )
}

/** Has this system got coordinates to do address math with? */
function hasCoords(
  s: SystemRecord
): s is SystemRecord & { voxelX: number; voxelY: number; voxelZ: number; solarSystemIndex: number } {
  return (
    s.voxelX !== null && s.voxelY !== null && s.voxelZ !== null && s.solarSystemIndex !== null
  )
}

/** "You have a base here" chip: base name, part count in the tooltip.
 *  Settlements (from the save's settlement teleport endpoint) get their
 *  own amber look so they don't blend in with buildable bases. */
function BaseChip({ base }: { base: BaseRecord }): React.JSX.Element {
  const settlement = base.baseType === 'Settlement'
  return (
    <span
      title={
        settlement
          ? 'Your settlement — from your save'
          : `Your base (${base.parts} parts) — from your save`
      }
      className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] whitespace-nowrap ${
        settlement
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      }`}
    >
      {settlement ? <Building2 className="h-2.5 w-2.5" /> : <Home className="h-2.5 w-2.5" />}{' '}
      {base.name}
    </span>
  )
}

/** Compact planet row inside a system card. */
function PlanetRow({
  planet,
  bases,
  onUnassign,
  onDelete
}: {
  planet: PlanetRecord
  /** The player's bases on this planet. */
  bases: BaseRecord[]
  onUnassign: () => void
  onDelete: () => void
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const scanned = !(planet.type === 'Unknown' && planet.source === 'save')

  return (
    <div className="group flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-md bg-slate-800/40 px-2 py-1">
      <Globe2 className={`h-3 w-3 shrink-0 ${scanned ? 'text-cyan-400' : 'text-slate-600'}`} />
      <span className="truncate text-[11px] text-slate-200">{planet.name}</span>
      {planet.planetIndex !== null && (
        <span className="font-mono text-[9px] text-slate-500">#{planet.planetIndex}</span>
      )}
      {bases.map((base) => (
        <BaseChip key={base.id} base={base} />
      ))}
      <span className="truncate text-[10px] text-slate-500">
        {scanned ? planet.type : 'not scanned'}
      </span>
      {scanned &&
        planet.resources.map((res) => <ResourceChip key={res} name={res} size="sm" />)}
      <span className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
        <button
          onClick={onUnassign}
          title="Unassign from this system"
          className="rounded p-0.5 text-slate-500 hover:text-amber-300"
        >
          <Unlink className="h-3 w-3" />
        </button>
        {confirming ? (
          <button
            onClick={onDelete}
            onBlur={() => setConfirming(false)}
            className="rounded bg-red-500/20 px-1 text-[9px] font-medium text-red-300"
          >
            Confirm?
          </button>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            title="Delete planet"
            className="rounded p-0.5 text-slate-500 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </span>
    </div>
  )
}

function SystemCard({
  system,
  planets,
  bases,
  regionCount,
  inferredGuild,
  standingRank,
  isCurrent,
  isClosestToCore,
  onPatch,
  onUnassignPlanet,
  onDeletePlanet
}: {
  system: SystemRecord
  planets: PlanetRecord[]
  bases: BaseRecord[]
  regionCount: number
  /** Guild inherited from an envoy scan elsewhere in this region. */
  inferredGuild: GuildType
  /** Player's rank with this system's guild, or null when unknown. */
  standingRank: string | null
  isCurrent: boolean
  /** This is the catalogue's nearest system to its galaxy's core. */
  isClosestToCore: boolean
  onPatch: StationGridProps['onPatch']
  onUnassignPlanet: StationGridProps['onUnassignPlanet']
  onDeletePlanet: StationGridProps['onDeletePlanet']
}): React.JSX.Element {
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(system.notes)
  const [tagDraft, setTagDraft] = useState('')

  const slot: StationSlot = system.station !== 'normal' ? system.station : system.guildType
  const cycleSlot = (): void => {
    const next = SLOT_ORDER[(SLOT_ORDER.indexOf(slot) + 1) % SLOT_ORDER.length]
    onPatch(
      system.universalAddress,
      next === 'pirate' || next === 'stationless'
        ? { guildType: null, station: next }
        : { guildType: next, station: 'normal' }
    )
  }

  const addTag = (): void => {
    const tag = tagDraft.trim()
    if (!tag || system.customTags.includes(tag)) {
      setTagDraft('')
      return
    }
    onPatch(system.universalAddress, { customTags: [...system.customTags, tag] })
    setTagDraft('')
  }

  const guild = slot ? GUILDS.find((g) => g.value === slot) : undefined
  const inferred = slot ? undefined : GUILDS.find((g) => g.value === inferredGuild)
  const coords = hasCoords(system)

  // Bases sit on their planet's row; the rest (freighter base, or a planet
  // the catalogue has no record for) get their own line below.
  const basesOnPlanet = (p: PlanetRecord): BaseRecord[] =>
    p.planetIndex === null ? [] : bases.filter((b) => b.planetIndex === p.planetIndex)
  const orphanBases = bases.filter(
    (b) => b.planetIndex === null || !planets.some((p) => p.planetIndex === b.planetIndex)
  )

  return (
    <div
      className={`flex h-full flex-col gap-2.5 rounded-xl border p-4 backdrop-blur-sm transition-colors ${
        isCurrent
          ? 'border-cyan-400/60 bg-cyan-950/40 shadow-[0_0_12px_rgba(34,211,238,0.15)]'
          : 'border-slate-700/60 bg-slate-900/70 hover:border-cyan-500/40'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            {system.name}
            {isCurrent && (
              <span className="flex items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-500/20 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                <MapPin className="h-3 w-3" /> Current
              </span>
            )}
          </h3>
          <p className="font-mono text-[10px] text-slate-500">
            {system.galaxy ?? 'Unknown Galaxy'}
            {coords &&
              ` · ${formatLightYears(distanceToCoreLy(system.voxelX!, system.voxelY!, system.voxelZ!))} from core`}
            {regionCount > 1 && ` · ${regionCount} systems in region`}
          </p>
          {system.discoveredBy && (
            <p
              className="font-mono text-[10px] text-slate-500"
              title="Discovery credit, from the save's discovery records"
            >
              discovered by {system.discoveredBy}
              {system.discoveredAt && ` · ${system.discoveredAt.slice(0, 10)}`}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {isClosestToCore && (
            <span
              title={`Your catalogued system nearest the centre of ${system.galaxy ?? 'its galaxy'}`}
              className="flex items-center gap-1 rounded-full border border-fuchsia-500/40 bg-fuchsia-500/15 px-2 py-0.5 text-[10px] text-fuchsia-300"
            >
              <Orbit className="h-3 w-3" /> Nearest Core
            </span>
          )}
          {system.isBlackHole && (
            <span className="flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">
              <CircleDot className="h-3 w-3" /> Black Hole
            </span>
          )}
        </div>
      </div>

      {coords && (
        <div className="flex flex-wrap items-center gap-1.5">
          <PortalChip
            code={portalCode(
              system.voxelX!,
              system.voxelY!,
              system.voxelZ!,
              system.solarSystemIndex!
            )}
          />
          <span
            title="Signal-booster / galaxy-map coordinates"
            className="rounded border border-slate-600/50 bg-slate-800/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-400"
          >
            {boosterCoords(system.voxelX!, system.voxelY!, system.voxelZ!, system.solarSystemIndex!)}
          </span>
        </div>
      )}

      {(system.race || system.economy || system.conflict) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {system.race && (
            <span className="flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
              <Users className="h-3 w-3" /> {system.race}
            </span>
          )}
          {system.economy && (
            <span className="flex items-center gap-1 rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-300">
              <Coins className="h-3 w-3" /> {system.economy}
            </span>
          )}
          {system.conflict && (
            <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
              <Swords className="h-3 w-3" /> Conflict: {system.conflict}
            </span>
          )}
        </div>
      )}

      {planets.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] tracking-wide text-cyan-400/80 uppercase">
            Planets ({planets.length})
          </span>
          {planets.map((planet) => (
            <PlanetRow
              key={planet.id}
              planet={planet}
              bases={basesOnPlanet(planet)}
              onUnassign={() => onUnassignPlanet(planet.id)}
              onDelete={() => onDeletePlanet(planet.id)}
            />
          ))}
        </div>
      )}

      {orphanBases.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-emerald-400/80">Bases:</span>
          {orphanBases.map((base) => (
            <BaseChip key={base.id} base={base} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={
            inferred
              ? () => onPatch(system.universalAddress, { guildType: inferred.value })
              : cycleSlot
          }
          title={
            inferred
              ? 'Guild inferred from this region — every station in a region hosts the same guild. Click to confirm.'
              : 'Cycle guild / pirate / no station'
          }
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
            guild
              ? 'border-cyan-500/50 bg-cyan-500/20 text-cyan-300'
              : slot === 'pirate'
                ? 'border-red-500/50 bg-red-500/15 text-red-300'
                : slot === 'stationless'
                  ? 'border-slate-500/60 bg-slate-800/80 text-slate-400'
                  : inferred
                    ? 'border-dashed border-cyan-500/40 bg-cyan-500/10 text-cyan-300/80 hover:bg-cyan-500/20'
                    : 'border-slate-600/60 bg-slate-800/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          {guild ? (
            <>
              {guild.icon} {guild.label}
            </>
          ) : slot === 'pirate' ? (
            <>
              <Skull className="h-3 w-3" /> Pirate
            </>
          ) : slot === 'stationless' ? (
            <>
              <CircleOff className="h-3 w-3" /> No Station
            </>
          ) : inferred ? (
            <>
              {inferred.icon} {inferred.label}
              <span className="opacity-60">· region</span>
            </>
          ) : (
            <>
              <Landmark className="h-3 w-3" /> No Guild
            </>
          )}
        </button>
        <Toggle
          active={system.offersSfm}
          label="Offers SFM"
          icon={<Wrench className="h-3 w-3" />}
          onClick={() => onPatch(system.universalAddress, { offersSfm: !system.offersSfm })}
        />
        <Toggle
          active={system.isBlackHole}
          label="Black Hole"
          icon={<CircleDot className="h-3 w-3" />}
          onClick={() => onPatch(system.universalAddress, { isBlackHole: !system.isBlackHole })}
        />
      </div>

      {system.envoyItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-amber-400/80">Envoy:</span>
          {system.envoyItems.map((item, i) => {
            // Stock row i unlocks at guild rank i; positions are only
            // trustworthy when the scan captured every row.
            const complete = system.envoyItems.length === ENVOY_STOCK_ROWS
            const locked = envoyItemLocked(i, standingRank, system.envoyItems.length)
            return (
              <span
                key={item}
                title={
                  complete
                    ? locked
                      ? `Requires ${GUILD_RANKS[i]} — you're ${standingRank}`
                      : `Unlocks at ${GUILD_RANKS[i]}`
                    : 'Incomplete scan — rank positions unknown, rescan the envoy'
                }
                className={`rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200/90 ${
                  locked ? 'opacity-40 grayscale-[0.4]' : ''
                }`}
              >
                {item}
              </span>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {system.customTags.map((tag) => (
          <span
            key={tag}
            className="group flex items-center gap-1 rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-300"
          >
            {tag}
            <button
              onClick={() =>
                onPatch(system.universalAddress, {
                  customTags: system.customTags.filter((t) => t !== tag)
                })
              }
              className="hidden text-slate-500 group-hover:inline hover:text-red-400"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTag()}
          placeholder="+ tag"
          className="w-16 rounded bg-slate-800/70 px-1.5 py-0.5 text-[10px] text-slate-300 placeholder-slate-600 outline-none focus:ring-1 focus:ring-cyan-500/50"
        />
      </div>

      {editingNotes ? (
        <textarea
          autoFocus
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            setEditingNotes(false)
            if (notesDraft !== system.notes)
              onPatch(system.universalAddress, { notes: notesDraft })
          }}
          rows={2}
          className="resize-none rounded bg-slate-800/70 p-2 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-cyan-500/50"
        />
      ) : (
        <button
          onClick={() => {
            setNotesDraft(system.notes)
            setEditingNotes(true)
          }}
          className="flex items-start gap-1.5 text-left text-xs text-slate-400 hover:text-slate-200"
        >
          <NotebookPen className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="italic">{system.notes || 'Add notes…'}</span>
        </button>
      )}
    </div>
  )
}

/** Responsive card grid of catalogued systems / stations with quick toggles. */
export function StationGrid({
  systems,
  planets,
  bases,
  standings,
  currentAddress,
  filter,
  groupByRegion,
  selectedResources,
  focusAddress,
  onFocusHandled,
  onPatch,
  onUnassignPlanet,
  onDeletePlanet
}: StationGridProps): React.JSX.Element {
  const [flashAddress, setFlashAddress] = useState<string | null>(null)

  useEffect(() => {
    if (!focusAddress) return
    document
      .querySelector(`[data-address="${CSS.escape(focusAddress)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlashAddress(focusAddress)
    onFocusHandled()
  }, [focusAddress, onFocusHandled])

  useEffect(() => {
    if (!flashAddress) return
    const timer = setTimeout(() => setFlashAddress(null), 2200)
    return () => clearTimeout(timer)
  }, [flashAddress])

  const planetsBySystem = useMemo(() => {
    const map = new Map<string, PlanetRecord[]>()
    for (const p of planets) {
      if (!p.systemAddress) continue
      if (!map.has(p.systemAddress)) map.set(p.systemAddress, [])
      map.get(p.systemAddress)!.push(p)
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.planetIndex ?? 99) - (b.planetIndex ?? 99) || a.name.localeCompare(b.name))
    }
    return map
  }, [planets])

  const basesBySystem = useMemo(() => {
    const map = new Map<string, BaseRecord[]>()
    for (const b of bases) {
      if (!map.has(b.systemAddress)) map.set(b.systemAddress, [])
      map.get(b.systemAddress)!.push(b)
    }
    return map
  }, [bases])

  // A region is a voxel: systems sharing galaxy+voxel are neighbours.
  const regionOf = (s: SystemRecord): string | null =>
    hasCoords(s) ? regionKey(s.galaxy, s.voxelX!, s.voxelY!, s.voxelZ!) : null

  const regionCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of systems) {
      const key = regionOf(s)
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [systems])

  // Each galaxy's closest catalogued system to its core gets a badge;
  // computed over the full catalogue so filtering doesn't move the badge.
  const coreClosest = useMemo(() => closestToCoreByGalaxy(systems), [systems])
  const isClosestToCore = (s: SystemRecord): boolean =>
    coreClosest.get(s.galaxy)?.universalAddress === s.universalAddress

  // One envoy scan reveals the guild of every station in that region.
  const regionGuilds = useMemo(() => inferRegionGuilds(systems), [systems])
  const guildOf = (s: SystemRecord): GuildType =>
    s.guildType ?? inferredGuildFor(s, regionGuilds)
  const standingFor = (s: SystemRecord): string | null => {
    const guild = guildOf(s)
    return guild ? (standings.find((st) => st.guild === guild)?.rank ?? null) : null
  }

  const visible = systems
    .filter((s) => {
      // Every selected resource must be present on some planet of the system.
      if (selectedResources.length > 0) {
        const inSystem = new Set(
          (planetsBySystem.get(s.universalAddress) ?? []).flatMap((p) => p.resources)
        )
        if (!selectedResources.every((r) => inSystem.has(r))) return false
      }
      const q = filter.toLowerCase()
      return (
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.galaxy ?? '').toLowerCase().includes(q) ||
        (s.race ?? '').toLowerCase().includes(q) ||
        (guildOf(s) ?? '').toLowerCase().includes(q) ||
        (s.station !== 'normal' && STATION_SEARCH[s.station].includes(q)) ||
        (s.economy ?? '').toLowerCase().includes(q) ||
        (s.discoveredBy ?? '').toLowerCase().includes(q) ||
        s.customTags.some((t) => t.toLowerCase().includes(q)) ||
        s.notes.toLowerCase().includes(q) ||
        (planetsBySystem.get(s.universalAddress) ?? []).some(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.resources.some((r) => r.toLowerCase().includes(q))
        ) ||
        (basesBySystem.get(s.universalAddress) ?? []).some((b) =>
          b.name.toLowerCase().includes(q)
        )
      )
    })
    // Pin the player's current system on top of the catalogue.
    .sort(
      (a, b) =>
        Number(b.universalAddress === currentAddress) -
        Number(a.universalAddress === currentAddress)
    )

  const regionGroups = useMemo(() => {
    if (!groupByRegion) return null
    const groups = new Map<string, { label: string; systems: SystemRecord[] }>()
    for (const s of visible) {
      const key = regionOf(s) ?? 'unknown'
      if (!groups.has(key)) {
        groups.set(key, {
          label: hasCoords(s)
            ? `${regionLabel(s.voxelX!, s.voxelY!, s.voxelZ!)} · ${s.galaxy ?? 'Unknown Galaxy'}`
            : 'No coordinates',
          systems: []
        })
      }
      groups.get(key)!.systems.push(s)
    }
    // Current region on top, then busiest regions — that's where the interesting clusters are.
    const hasCurrent = (g: { systems: SystemRecord[] }): number =>
      Number(g.systems.some((s) => s.universalAddress === currentAddress))
    return [...groups.values()].sort(
      (a, b) => hasCurrent(b) - hasCurrent(a) || b.systems.length - a.systems.length
    )
  }, [visible, groupByRegion, currentAddress])

  const cardCount = (s: SystemRecord): number => regionCounts.get(regionOf(s) ?? '') ?? 0

  // Wrapper carries the scroll target + jump-highlight ring for sidebar jumps.
  const renderCard = (system: SystemRecord): React.JSX.Element => (
    <div
      key={system.universalAddress}
      data-address={system.universalAddress}
      className={`h-full rounded-xl transition-shadow duration-500 ${
        flashAddress === system.universalAddress
          ? 'ring-2 ring-emerald-400/80 shadow-[0_0_20px_rgba(52,211,153,0.35)]'
          : ''
      }`}
    >
      <SystemCard
        system={system}
        planets={planetsBySystem.get(system.universalAddress) ?? []}
        bases={basesBySystem.get(system.universalAddress) ?? []}
        regionCount={cardCount(system)}
        inferredGuild={inferredGuildFor(system, regionGuilds)}
        standingRank={standingFor(system)}
        isCurrent={system.universalAddress === currentAddress}
        isClosestToCore={isClosestToCore(system)}
        onPatch={onPatch}
        onUnassignPlanet={onUnassignPlanet}
        onDeletePlanet={onDeletePlanet}
      />
    </div>
  )

  return (
    <div>
      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700/60 p-6 text-center text-xs text-slate-500">
          {systems.length === 0
            ? 'No systems catalogued yet — load a save in No Man’s Sky and they’ll appear here.'
            : 'No systems match the filter.'}
        </p>
      ) : regionGroups ? (
        <div className="flex flex-col gap-5">
          {regionGroups.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
                <Hexagon className="h-3 w-3 text-cyan-500/70" /> {group.label} (
                {group.systems.length})
              </h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.systems.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map(renderCard)}
        </div>
      )}
    </div>
  )
}
