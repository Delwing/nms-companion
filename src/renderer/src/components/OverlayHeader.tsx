import { useState } from 'react'
import {
  Bug,
  Crosshair,
  HardDrive,
  MapPin,
  Maximize,
  Minimize,
  Minus,
  MonitorDot,
  Pin,
  ScanLine,
  X
} from 'lucide-react'
import type {
  LocationInfo,
  OcrStatus,
  PlatformSupport,
  SaveSlotState,
  SaveSyncResult
} from '@shared/types'
import { PortalGlyphStrip } from './PortalGlyphStrip'

interface OverlayHeaderProps {
  hudVisible: boolean
  clickThrough: boolean
  ocrStatus: OcrStatus
  lastSync: SaveSyncResult | null
  location: LocationInfo | null
  /** Last-copied portal address, pinned for dialling. */
  pinnedPortal: string | null
  slotState: SaveSlotState
  saveError: string | null
  /** Host OS feature support; null until main answers. Assume full support. */
  platform: PlatformSupport | null
  onToggleHud: () => void
  onScan: () => void
  onSelectSlot: (slotId: string | null) => void
  onUnpin: () => void
}

/**
 * "Idgefie · Planet 2 · Euclid" style one-liner. Leads with the system
 * resolved from UniversalAddress — the address OCR scans (envoy, planet)
 * attach to — because the game's SaveSummary text ("Aboard the Space
 * Anomaly") is only refreshed at certain save points and can lag a warp
 * behind. SaveSummary is kept as a fallback for uncatalogued systems.
 */
export function formatLocation(location: LocationInfo): string {
  const place = location.systemName
    ? `${location.systemName}${location.planetIndex ? ` · Planet ${location.planetIndex}` : ''}`
    : (location.summary ?? location.universalAddress)
  return location.galaxy ? `${place} · ${location.galaxy}` : place
}

const STATUS_LABEL: Record<OcrStatus['state'], string> = {
  idle: 'Ready',
  capturing: 'Capturing…',
  recognizing: 'Reading screen…',
  done: 'Scan complete',
  error: 'Scan failed'
}

/** "665 KB" / "1.2 MB" — save size, a rough proxy for character progress. */
function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1000))} KB`
}

/** Top bar: HUD overlay toggle, scan trigger, sync status. */
export function OverlayHeader({
  hudVisible,
  clickThrough,
  ocrStatus,
  lastSync,
  location,
  pinnedPortal,
  slotState,
  saveError,
  platform,
  onToggleHud,
  onScan,
  onSelectSlot,
  onUnpin
}: OverlayHeaderProps): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  // Unknown support (null) is treated as full — the flags only ever downgrade.
  const canCapture = platform?.screenCapture ?? true
  const hasHotkeys = platform?.globalHotkeys ?? true

  return (
    <header className="drag-region flex items-center gap-3 border-b border-cyan-500/20 bg-slate-900/80 px-4 py-2.5">
      <MonitorDot className="h-5 w-5 text-cyan-400" />
      <div className="leading-tight">
        <h1 className="text-sm font-bold tracking-wide">NMS Companion</h1>
        {location && (
          <p className="flex items-center gap-1 text-[11px] font-medium text-cyan-300">
            <MapPin className="h-3 w-3" /> {formatLocation(location)}
          </p>
        )}
        <p className={`text-[10px] ${saveError ? 'text-amber-400' : 'text-slate-500'}`}>
          {saveError
            ? saveError
            : lastSync
              ? `Save synced ${new Date(lastSync.syncedAt).toLocaleTimeString()} · ${lastSync.systemsUpserted} systems · ${lastSync.planetsUpserted} planets` +
                (lastSync.planetsLinked > 0 ? ` · ${lastSync.planetsLinked} linked` : '')
              : 'Waiting for save data…'}
        </p>
      </div>

      {pinnedPortal && (
        <div
          title={`Pinned portal address ${pinnedPortal} — copied from a system card; the HUD shows it too`}
          className="no-drag flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1"
        >
          <Pin className="h-3 w-3 shrink-0 text-purple-400" />
          <PortalGlyphStrip code={pinnedPortal} />
          <button
            onClick={onUnpin}
            title="Unpin portal address"
            className="rounded p-0.5 text-slate-500 hover:text-red-400"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {slotState.slots.length > 0 && (
        <div
          className={`no-drag flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            slotState.selected !== null
              ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200'
              : 'border-slate-700/60 bg-slate-900/60 text-slate-400'
          }`}
          title="Which character's catalogue is shown — each save slot has its own database of systems, planets, bases and inventory. Auto follows whichever save was written last, so it switches by itself when you load another character in-game."
        >
          <HardDrive className="h-3.5 w-3.5" />
          <select
            value={slotState.selected ?? ''}
            onChange={(e) => onSelectSlot(e.target.value || null)}
            className="cursor-pointer bg-transparent outline-none [&>option]:bg-slate-900"
          >
            <option value="">Auto (follow game)</option>
            {slotState.selected !== null &&
              !slotState.slots.some((s) => s.id === slotState.selected) && (
                <option value={slotState.selected}>Pinned slot (no save seen yet)</option>
              )}
            {slotState.slots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.label} · {formatSize(slot.sizeBytes)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1" />

      <span
        className={`no-drag rounded-full px-2 py-0.5 font-mono text-[10px] ${
          ocrStatus.state === 'error'
            ? 'bg-red-500/20 text-red-300'
            : 'bg-cyan-500/10 text-cyan-300'
        }`}
      >
        {STATUS_LABEL[ocrStatus.state]}
      </span>

      <button
        onClick={onScan}
        title={
          canCapture
            ? `Scan screen now${hasHotkeys ? ' (Alt+C)' : ''}`
            : `Screen capture is not available on ${platform?.session ?? platform?.os} — scanning will likely fail`
        }
        className={`no-drag flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
          canCapture
            ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/30'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-300/80 hover:bg-amber-500/20'
        }`}
      >
        <ScanLine className="h-3.5 w-3.5" /> Scan
      </button>

      <button
        onClick={onToggleHud}
        title={
          hasHotkeys
            ? 'Show/hide the in-game glass HUD overlay (Alt+S jumps between game and dashboard)'
            : 'Show/hide the in-game glass HUD overlay'
        }
        className={`no-drag flex items-center gap-1 rounded-lg border border-slate-600/60 px-2.5 py-1.5 text-xs transition-colors ${
          hudVisible ? 'bg-cyan-500/25 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        <Crosshair className="h-3.5 w-3.5" /> HUD
      </button>

      {clickThrough && (
        <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-300">
          click-through
        </span>
      )}

      <button
        onClick={() => void window.api.openDebugFolder()}
        className="no-drag rounded p-1 text-slate-400 hover:bg-slate-700/50 hover:text-cyan-300"
        title="Open OCR debug folder (captured frames + raw text)"
      >
        <Bug className="h-4 w-4" />
      </button>
      <button
        onClick={() => void window.api.minimize()}
        className="no-drag rounded p-1 text-slate-400 hover:bg-slate-700/50 hover:text-white"
        title="Minimize"
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        onClick={() => void window.api.toggleMaximize().then(setMaximized)}
        className="no-drag rounded p-1 text-slate-400 hover:bg-slate-700/50 hover:text-white"
        title={maximized ? 'Restore window size' : 'Maximize'}
      >
        {maximized ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
      </button>
      <button
        onClick={() => void window.api.closeWindow()}
        className="no-drag rounded p-1 text-slate-400 hover:bg-red-500/40 hover:text-white"
        title="Close"
      >
        <X className="h-4 w-4" />
      </button>
    </header>
  )
}
