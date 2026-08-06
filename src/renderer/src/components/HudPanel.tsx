import { Expand, Globe2, MapPin, Pin, Radar, X } from 'lucide-react'
import type { LocationInfo, OcrScanResult, OcrStatus } from '@shared/types'
import { formatLocation } from './OverlayHeader'
import { PortalGlyphStrip } from './PortalGlyphStrip'

interface HudPanelProps {
  clickThrough: boolean
  lastScan: OcrScanResult | null
  ocrStatus: OcrStatus
  location: LocationInfo | null
  /** Last-copied portal address, pinned for dialling. */
  pinnedPortal: string | null
  systemCount: number
  planetCount: number
  onExpand: () => void
  onUnpin: () => void
}

/** Minimalist in-game glass HUD: last scan summary + catalogue counters. */
export function HudPanel({
  clickThrough,
  lastScan,
  ocrStatus,
  location,
  pinnedPortal,
  systemCount,
  planetCount,
  onExpand,
  onUnpin
}: HudPanelProps): React.JSX.Element {
  const busy = ocrStatus.state === 'capturing' || ocrStatus.state === 'recognizing'

  return (
    <div className="drag-region fixed top-4 left-4 flex w-72 flex-col gap-2 rounded-xl border border-cyan-500/25 bg-slate-900/60 p-3 text-slate-100 shadow-xl backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Radar className={`h-4 w-4 text-cyan-400 ${busy ? 'animate-spin' : ''}`} />
        <span className="text-xs font-semibold tracking-wide">NMS HUD</span>
        <span className="flex-1 text-right font-mono text-[10px] text-slate-400">
          {systemCount} sys · {planetCount} planets
        </span>
        {!clickThrough && (
          <button
            onClick={onExpand}
            title="Focus the dashboard window"
            className="no-drag rounded p-0.5 text-slate-400 hover:text-cyan-300"
          >
            <Expand className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {location && (
        <p className="flex items-center gap-1.5 text-[11px] text-cyan-300">
          <MapPin className="h-3 w-3 shrink-0" /> {formatLocation(location)}
        </p>
      )}

      {pinnedPortal && (
        <div className="flex flex-col gap-1 rounded-lg border border-purple-500/25 bg-slate-800/50 p-2">
          <div className="flex items-center gap-1">
            <Pin className="h-3 w-3 shrink-0 text-purple-400" />
            <span className="flex-1 font-mono text-[10px] tracking-[0.15em] text-purple-300">
              {pinnedPortal}
            </span>
            {!clickThrough && (
              <button
                onClick={onUnpin}
                title="Unpin portal address"
                className="no-drag rounded p-0.5 text-slate-500 hover:text-red-400"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <PortalGlyphStrip code={pinnedPortal} large />
        </div>
      )}

      {lastScan?.ok && lastScan.data ? (
        <div className="flex items-start gap-2 rounded-lg bg-slate-800/50 p-2">
          <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400" />
          <div className="leading-tight">
            <p className="text-[11px] font-medium">
              {lastScan.data.name || 'Planet'}{' '}
              <span className="text-cyan-300">· {lastScan.data.planetType}</span>
            </p>
            <p className="text-[10px] text-slate-400">
              {lastScan.data.weather} · {lastScan.data.resources.length} resources ·{' '}
              {lastScan.durationMs} ms
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-slate-400">
          <kbd className="rounded bg-slate-800 px-1 py-0.5 font-mono text-cyan-300">Alt+C</kbd> scan
          screen · <kbd className="rounded bg-slate-800 px-1 py-0.5 font-mono text-cyan-300">Alt+S</kbd>{' '}
          dashboard{clickThrough ? '' : ' · drag to move'}
        </p>
      )}
    </div>
  )
}
