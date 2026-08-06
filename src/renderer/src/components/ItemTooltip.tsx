import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ItemDetail } from '@shared/types'
import { normaliseItemName } from '@shared/itemNames'

/**
 * Rich hover tooltips for game items: icon, group, in-game description
 * and base value, backed by the AssistantNMS detail map cached in the
 * main process. Consumers spread `hoverProps` onto the hovered element
 * and render `tooltip` next to it — no wrapper element, no layout shift.
 */

let detailsPromise: Promise<Record<string, ItemDetail>> | null = null

function loadDetails(): Promise<Record<string, ItemDetail>> {
  detailsPromise ??= window.api.itemDetails().catch(() => {
    // Failed IPC/offline: retry on a later hover instead of caching the miss.
    detailsPromise = null
    return {}
  })
  return detailsPromise
}

/** Resolved icon data URLs; misses are not cached so hovers can retry. */
const iconCache = new Map<string, string>()

/** Icon data URL for an item display name, or null while loading/unknown. */
export function useItemIcon(name: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    loadDetails().then((map) => {
      const icon = map[normaliseItemName(name)]?.icon
      if (!icon || cancelled) return
      const cached = iconCache.get(icon)
      if (cached) {
        setUrl(cached)
        return
      }
      window.api
        .itemIcon(icon)
        .then((dataUrl) => {
          if (dataUrl) iconCache.set(icon, dataUrl)
          if (!cancelled && dataUrl) setUrl(dataUrl)
        })
        .catch(() => {})
    })
    return () => {
      cancelled = true
    }
  }, [name])
  return url
}

/** Category tint NMS uses for <TAG>…<> spans in item descriptions. */
const TAG_COLOURS: Record<string, string> = {
  TECHNOLOGY: '#6ac9e8',
  STELLAR: '#c78bde',
  CATALYST: '#f0a24c',
  EARTH: '#7fc06e',
  COMMODITY: '#e8c56a',
  TRADEABLE: '#e8c56a',
  FUEL: '#e87a62',
  SPECIAL: '#e0c060'
}

const CURRENCY_SUFFIX = ['units', 'nanites', 'quicksilver']

/** Render NMS markup ("A <STELLAR>chromatic metal<>…") as tinted spans. */
function NmsRichText({ text }: { text: string }): React.JSX.Element {
  const parts: React.ReactNode[] = []
  const pattern = /<([A-Za-z_]+)>([\s\S]*?)<>/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    parts.push(
      <span
        key={match.index}
        style={{ color: TAG_COLOURS[match[1].toUpperCase()] ?? '#67e8f9' }}
      >
        {match[2]}
      </span>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <span className="whitespace-pre-line">{parts}</span>
}

interface TooltipCardProps {
  name: string
  anchor: DOMRect
  /** Shown when the detail map doesn't know the name (panel-only rows). */
  fallback?: { group: string; colour: string }
  /** Internal id, shown small in the footer (inventory rows). */
  code?: string
}

const CARD_WIDTH = 288 // w-72
const CARD_MAX_HEIGHT = 280

function TooltipCard({ name, anchor, fallback, code }: TooltipCardProps): React.JSX.Element | null {
  const [detail, setDetail] = useState<ItemDetail | null | undefined>(undefined)
  const iconUrl = useItemIcon(name)

  useEffect(() => {
    let cancelled = false
    loadDetails().then((map) => {
      if (!cancelled) setDetail(map[normaliseItemName(name)] ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [name])

  if (detail === undefined) return null // details still loading
  if (!detail && !fallback) return null

  const group = detail?.group ?? fallback?.group ?? ''
  const colour = detail?.colour ? `#${detail.colour}` : (fallback?.colour ?? '#67e8f9')

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - CARD_WIDTH - 8))
  const below = anchor.bottom + CARD_MAX_HEIGHT + 12 < window.innerHeight
  const position: React.CSSProperties = below
    ? { left, top: anchor.bottom + 6 }
    : { left, bottom: window.innerHeight - anchor.top + 6 }

  return (
    <div
      className="pointer-events-none fixed z-[100] w-72 rounded-xl border border-slate-600/60 bg-slate-900/95 p-3 shadow-2xl backdrop-blur-md"
      style={position}
    >
      <div className="flex items-center gap-2.5">
        {iconUrl ? (
          <img src={iconUrl} alt="" className="h-10 w-10 shrink-0 rounded-md" />
        ) : (
          <span
            aria-hidden
            className="m-1.5 inline-block h-7 w-7 shrink-0 rotate-45 rounded-[2px] ring-1 ring-white/25"
            style={{ backgroundColor: colour }}
          />
        )}
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-slate-100">{name}</div>
          <div className="truncate text-[10px] tracking-wide uppercase" style={{ color: colour }}>
            {group}
          </div>
        </div>
      </div>
      {detail?.description && (
        <p className="mt-2 max-h-40 overflow-hidden text-[11px] leading-relaxed text-slate-300">
          <NmsRichText text={detail.description} />
        </p>
      )}
      {((detail && detail.baseValue > 1) || code) && (
        <div className="mt-2 flex items-baseline justify-between border-t border-slate-700/60 pt-1.5">
          {detail && detail.baseValue > 1 ? (
            <span className="font-mono text-[10px] text-amber-300/90">
              {detail.baseValue.toLocaleString()} {CURRENCY_SUFFIX[detail.currency] ?? 'units'}
            </span>
          ) : (
            <span />
          )}
          {code && <span className="font-mono text-[9px] text-slate-600">{code}</span>}
        </div>
      )}
    </div>
  )
}

export interface ItemHoverOptions {
  fallback?: { group: string; colour: string }
  code?: string
}

/**
 * Hover wiring for an item element. Spread `hoverProps` onto the element
 * users point at and render `tooltip` anywhere in the same component.
 */
export function useItemHover(
  name: string,
  options: ItemHoverOptions = {}
): {
  hoverProps: {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => void
    onMouseLeave: () => void
  }
  tooltip: React.ReactNode
} {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return {
    hoverProps: {
      onMouseEnter: (e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        window.clearTimeout(timer.current)
        // Small delay so sweeping the cursor across a list stays quiet.
        timer.current = window.setTimeout(() => setAnchor(rect), 150)
      },
      onMouseLeave: () => {
        window.clearTimeout(timer.current)
        setAnchor(null)
      }
    },
    tooltip: anchor
      ? createPortal(
          <TooltipCard
            name={name}
            anchor={anchor}
            fallback={options.fallback}
            code={options.code}
          />,
          document.body
        )
      : null
  }
}
