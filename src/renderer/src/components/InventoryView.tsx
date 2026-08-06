import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Backpack,
  Car,
  Coins,
  Cpu,
  Rocket,
  Search,
  Tag,
  Warehouse,
  Wrench,
  X
} from 'lucide-react'
import type { InventoryItemRecord, SystemRecord } from '@shared/types'
import { itemDisplayName } from '@shared/itemNames'
import { infoFromTuple, itemInfo, type ItemInfo, type ItemInfoTuple } from '@shared/itemInfo'
import {
  classifyEconomy,
  economyWealth,
  tradeSellAdvice,
  type EconomyClass
} from '@shared/tradeEconomy'
import { useItemHover, useItemIcon } from './ItemTooltip'

interface InventoryViewProps {
  items: InventoryItemRecord[]
  /** Catalogued systems, used to suggest where to actually sell trade goods. */
  systems: SystemRecord[]
}

/** Aggregated view of one item across every container that holds it. */
interface ItemRow {
  itemId: string
  name: string
  itemType: string
  total: number
  locations: InventoryItemRecord[]
  info: ItemInfo | null
  /** total × unit value, in the item's own currency; 0 when unknown. */
  worth: number
}

/** 1234567 -> '1.2M', 12345 -> '12.3k' — compact and scannable. */
function formatAmount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return value.toLocaleString()
}

const CURRENCY_SUFFIX = { units: 'u', nanites: 'n', quicksilver: 'qs' } as const

const GROUP_ORDER = ['Storage', 'Freighter', 'Exosuit', 'Ship', 'Exocraft', 'Multi-tool']

type Purpose = 'all' | 'trade' | 'ingredient' | 'other'

const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: 'all', label: 'Any purpose' },
  { value: 'trade', label: 'Trade goods' },
  { value: 'ingredient', label: 'Ingredients' },
  { value: 'other', label: 'Everything else' }
]

function matchesPurpose(purpose: Purpose, info: ItemInfo | null): boolean {
  switch (purpose) {
    case 'trade':
      return info?.isTradeGood ?? false
    case 'ingredient':
      return info?.isIngredient ?? false
    case 'other':
      return !info?.isTradeGood && !info?.isIngredient
    default:
      return true
  }
}

function groupIcon(group: string): React.JSX.Element {
  const cls = 'h-3.5 w-3.5'
  switch (group) {
    case 'Exosuit':
      return <Backpack className={cls} />
    case 'Multi-tool':
      return <Wrench className={cls} />
    case 'Ship':
      return <Rocket className={cls} />
    case 'Freighter':
      return <Warehouse className={cls} />
    case 'Exocraft':
      return <Car className={cls} />
    default:
      return <Archive className={cls} />
  }
}

/**
 * "Where is my stuff" view over every container the save knows about:
 * storage chests, freighter, ships, exosuit, exocraft and multi-tools.
 * Searchable by item or container; groupable by item or by container.
 */
export function InventoryView({ items, systems }: InventoryViewProps): React.JSX.Element {
  const [filter, setFilter] = useState('')
  const [showTech, setShowTech] = useState(false)
  const [byContainer, setByContainer] = useState(false)
  const [sellMode, setSellMode] = useState(false)
  const [purpose, setPurpose] = useState<Purpose>('all')
  const [liveInfo, setLiveInfo] = useState<Record<string, ItemInfoTuple>>({})

  // Live AssistantNMS values (disk-cached in the main process) win over the
  // bundled static table; offline the record is simply empty.
  useEffect(() => {
    let cancelled = false
    window.api
      .liveItemInfo()
      .then((info) => {
        if (!cancelled) setLiveInfo(info)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const resolveInfo = useCallback(
    (itemId: string): ItemInfo | null => {
      const tuple = liveInfo[itemId.split('#')[0]]
      return tuple ? infoFromTuple(tuple) : itemInfo(itemId)
    },
    [liveInfo]
  )

  // Catalogued systems per economy class, wealthiest first, for "sell here"
  // suggestions. Economy comes from OCR system scans, so many systems have none.
  const sellTargets = useMemo(() => {
    const map = new Map<EconomyClass, { name: string; wealth: number }[]>()
    for (const system of systems) {
      const cls = classifyEconomy(system.economy)
      if (!cls || !system.name) continue
      const list = map.get(cls) ?? []
      list.push({ name: system.name, wealth: economyWealth(system.economy) ?? 0 })
      map.set(cls, list)
    }
    for (const list of map.values()) list.sort((a, b) => b.wealth - a.wealth)
    return map
  }, [systems])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    return items.filter((item) => {
      if (!showTech && item.itemType === 'Technology') return false
      if (!matchesPurpose(purpose, resolveInfo(item.itemId))) return false
      if (!needle) return true
      return (
        itemDisplayName(item.itemId).toLowerCase().includes(needle) ||
        item.itemId.toLowerCase().includes(needle) ||
        item.containerLabel.toLowerCase().includes(needle)
      )
    })
  }, [items, filter, showTech, purpose, resolveInfo])

  const itemRows = useMemo<ItemRow[]>(() => {
    const map = new Map<string, ItemRow>()
    for (const item of visible) {
      const row = map.get(item.itemId)
      if (row) {
        row.total += item.amount
        row.locations.push(item)
      } else {
        map.set(item.itemId, {
          itemId: item.itemId,
          name: itemDisplayName(item.itemId),
          itemType: item.itemType,
          total: item.amount,
          locations: [item],
          info: resolveInfo(item.itemId),
          worth: 0
        })
      }
    }
    let rows = [...map.values()]
    for (const row of rows) row.worth = row.total * (row.info?.value ?? 0)
    if (sellMode) {
      // Sell view: what's worth hauling to a terminal, best hauls first.
      // Nanite/quicksilver-priced items aren't unit income — leave them out.
      rows = rows
        .filter((r) => r.worth > 0 && r.info?.currency === 'units')
        .sort((a, b) => b.worth - a.worth)
    } else {
      rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    }
    return rows
  }, [visible, sellMode, resolveInfo])

  /** Estimated units across everything currently listed (units currency only). */
  const totalWorth = useMemo(
    () =>
      itemRows.reduce(
        (sum, row) => (row.info?.currency === 'units' ? sum + row.worth : sum),
        0
      ),
    [itemRows]
  )

  const containers = useMemo(() => {
    const map = new Map<
      string,
      { id: string; group: string; label: string; items: InventoryItemRecord[] }
    >()
    for (const item of visible) {
      const entry = map.get(item.containerId)
      if (entry) entry.items.push(item)
      else {
        map.set(item.containerId, {
          id: item.containerId,
          group: item.containerGroup,
          label: item.containerLabel,
          items: [item]
        })
      }
    }
    // The base-salvage buffers aren't a place the player can visit — keep
    // them behind every real container.
    const salvageLast = (c: { id: string }): number => (c.id.startsWith('chest:magic') ? 1 : 0)
    return [...map.values()].sort(
      (a, b) =>
        salvageLast(a) - salvageLast(b) ||
        GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
        a.label.localeCompare(b.label, undefined, { numeric: true })
    )
  }, [visible])

  const syncedAt = items[0]?.updatedAt ?? null

  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-center">
        <div>
          <Archive className="mx-auto mb-3 h-10 w-10 text-slate-700" />
          <p className="text-sm text-slate-400">No inventory data yet.</p>
          <p className="mt-1 text-xs text-slate-600">
            Item containers are imported automatically from your save file on every autosave.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-700/50 bg-slate-900/70 px-5 py-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-slate-700/60 bg-slate-900/60 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-slate-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find an item or container… e.g. Gold, Storage 3, Sodium"
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
        <div
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            purpose !== 'all'
              ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
              : 'border-slate-700/60 bg-slate-900/60 text-slate-400'
          }`}
          title="Only show items with this purpose"
        >
          <Tag className="h-3.5 w-3.5" />
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value as Purpose)}
            className="cursor-pointer bg-transparent outline-none [&>option]:bg-slate-900"
          >
            {PURPOSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Toggle
          active={sellMode}
          icon={<Coins className="h-3.5 w-3.5" />}
          label="Sell value"
          title="Sort by estimated sale value and hide items that can't be sold for units"
          onClick={() => {
            setSellMode((v) => !v)
            setByContainer(false)
          }}
        />
        <Toggle
          active={byContainer}
          icon={<Archive className="h-3.5 w-3.5" />}
          label="By container"
          title="Group the list by container instead of by item"
          onClick={() => {
            setByContainer((v) => !v)
            setSellMode(false)
          }}
        />
        <Toggle
          active={showTech}
          icon={<Cpu className="h-3.5 w-3.5" />}
          label="Technology"
          title="Include installed technology and upgrade modules"
          onClick={() => setShowTech((v) => !v)}
        />
      </div>

      <main className="flex-1 overflow-y-auto p-5">
        <h2 className="mb-3 text-xs font-semibold tracking-[0.2em] text-cyan-400 uppercase">
          {byContainer
            ? `Containers (${containers.length})`
            : sellMode
              ? `Sellable Items (${itemRows.length})`
              : `Items (${itemRows.length})`}
          {!byContainer && totalWorth > 0 && (
            <span className="ml-2 font-normal tracking-normal text-amber-300/90 normal-case">
              ≈ {formatAmount(totalWorth)} units{sellMode ? '' : ' in listed items'}
            </span>
          )}
          {syncedAt && (
            <span className="ml-2 font-normal tracking-normal text-slate-600 normal-case">
              from save, {new Date(syncedAt).toLocaleString()}
            </span>
          )}
        </h2>

        {byContainer ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {containers.map((container) => (
              <div
                key={container.id}
                className="rounded-xl border border-slate-700/50 bg-slate-900/50 p-3"
              >
                <div className="mb-2 flex items-center gap-2 text-cyan-300">
                  {groupIcon(container.group)}
                  <span className="text-xs font-semibold text-slate-100">{container.label}</span>
                  <span className="text-[10px] text-slate-500">
                    {container.items.length} items
                  </span>
                </div>
                <ul className="space-y-0.5">
                  {[...container.items]
                    .sort((a, b) => b.amount - a.amount)
                    .map((item) => (
                      <li
                        key={item.id}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <ItemName
                          name={itemDisplayName(item.itemId)}
                          itemId={item.itemId}
                          className="text-slate-300"
                          iconClass="h-4 w-4"
                        />
                        <span className="font-mono text-[10px] text-slate-500">
                          ×{item.amount.toLocaleString()}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <ul className="space-y-1.5">
            {itemRows.map((row) => (
              <li
                key={row.itemId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-1.5"
              >
                <ItemName
                  name={row.name}
                  itemId={row.itemId}
                  className="text-xs font-medium text-slate-100"
                />
                <span className="font-mono text-[10px] text-cyan-300">
                  ×{row.total.toLocaleString()}
                </span>
                {row.info && row.info.value > 0 && (
                  <span
                    className="font-mono text-[10px] text-amber-300/90"
                    title={`${row.info.value.toLocaleString()} ${CURRENCY_SUFFIX[row.info.currency]} each · ${row.info.group}`}
                  >
                    {formatAmount(row.worth)} {CURRENCY_SUFFIX[row.info.currency]}
                  </span>
                )}
                {row.info?.isTradeGood && (
                  <span
                    className="rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 text-[9px] text-amber-300"
                    title="Trade commodity — exists to be sold; prices swing by system economy"
                  >
                    trade good
                  </span>
                )}
                {row.info?.isTradeGood && <SellAdviceBadge row={row} sellTargets={sellTargets} />}
                {row.info?.isIngredient && (
                  <span
                    className="rounded-full border border-sky-500/30 bg-sky-500/10 px-1.5 text-[9px] text-sky-300/90"
                    title="Used by crafting, refining, cooking or tech recharging — think before selling it all"
                  >
                    ingredient
                  </span>
                )}
                {row.itemType === 'Technology' && (
                  <span className="rounded-full border border-slate-600/50 bg-slate-800/60 px-1.5 text-[9px] text-slate-400">
                    tech
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400">
                  {[...row.locations]
                    .sort((a, b) => b.amount - a.amount)
                    .map((loc) => (
                      <span
                        key={loc.id}
                        className="flex items-center gap-1 rounded-full border border-slate-700/60 bg-slate-800/50 px-2 py-0.5"
                      >
                        {groupIcon(loc.containerGroup)}
                        {loc.containerLabel}
                        {row.locations.length > 1 && (
                          <span className="font-mono text-slate-500">
                            ×{loc.amount.toLocaleString()}
                          </span>
                        )}
                      </span>
                    ))}
                </span>
              </li>
            ))}
            {itemRows.length === 0 && (
              <li className="py-8 text-center text-xs text-slate-500">
                {filter.trim()
                  ? `Nothing matches “${filter}”.`
                  : 'Nothing matches the current filters.'}
              </li>
            )}
          </ul>
        )}
      </main>
    </div>
  )
}

/** Item icon + display name with the rich hover card (lore, value, raw id). */
function ItemName({
  name,
  itemId,
  className,
  iconClass = 'h-6 w-6'
}: {
  name: string
  itemId: string
  className: string
  iconClass?: string
}): React.JSX.Element {
  const { hoverProps, tooltip } = useItemHover(name, { code: itemId })
  const iconUrl = useItemIcon(name)
  return (
    <span {...hoverProps} className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      {iconUrl ? (
        <img src={iconUrl} alt="" className={`${iconClass} shrink-0 rounded`} />
      ) : (
        // Same-size placeholder keeps rows aligned while icons stream in
        // (or when an item is unknown to the datasets).
        <span aria-hidden className={`${iconClass} shrink-0 rounded bg-slate-800/80`} />
      )}
      <span className="truncate">{name}</span>
      {tooltip}
    </span>
  )
}

/**
 * "Where do I sell this" hint for a trade-good row: the economy class that
 * pays the markup, plus the wealthiest catalogued system of that class when
 * one is known (economy data arrives via Alt+C system scans).
 */
function SellAdviceBadge({
  row,
  sellTargets
}: {
  row: ItemRow
  sellTargets: Map<EconomyClass, { name: string; wealth: number }[]>
}): React.JSX.Element | null {
  const advice = tradeSellAdvice(row.info?.group)
  if (!advice) return null

  const targets = advice.sellAt ? (sellTargets.get(advice.sellAt) ?? []) : []
  const best = targets[0] ?? null
  const title = [
    advice.note,
    targets.length > 0
      ? `Catalogued: ${targets
          .slice(0, 3)
          .map((t) => t.name + (t.wealth === 3 ? ' (wealthy)' : ''))
          .join(', ')}`
      : advice.sellAt
        ? 'No catalogued system with this economy yet — scan system panels (Alt+C) to record economies'
        : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[9px] text-emerald-300"
      title={title}
    >
      sell: {advice.sellAt ?? 'regulated systems'}
      {best && <span className="text-emerald-200/80"> → {best.name}</span>}
    </span>
  )
}

function Toggle({
  active,
  icon,
  label,
  title,
  onClick
}: {
  active: boolean
  icon: React.JSX.Element
  label: string
  title: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
        active
          ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
          : 'border-slate-700/60 bg-slate-900/60 text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon} {label}
    </button>
  )
}
