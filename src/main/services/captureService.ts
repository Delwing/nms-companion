/**
 * Screen capture + cropping to the game's text-bearing UI zones.
 * Primary capture path is Electron's desktopCapturer (in-process, no helper
 * binaries); screenshot-desktop is the fallback outside Electron.
 * Bounding boxes are proportional so they track any resolution;
 * separate sets cover 16:9 and 21:9 (ultrawide) layouts. Both zones and
 * the target display can be overridden via userData/config.json.
 */
import sharp from 'sharp'

export interface CropZone {
  key: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * banner: bottom-left NPC banner ("Envoy X of the Y Guild") — classifies
 *   the screen and carries guild/rank.
 * items: vendor/envoy item list on the right.
 * panel: wide right region where the Discoveries-menu planet card floats
 *   (its position follows the hovered planet, so the zone is generous).
 * Floating ship-view panels are handled by a full-frame OCR pass instead of
 * a zone. Margins are generous: the UI parallax-shifts ~1-2% with the mouse.
 */
const ZONES_16_9: CropZone[] = [
  { key: 'banner', left: 0.04, top: 0.83, width: 0.56, height: 0.14 },
  { key: 'items', left: 0.5, top: 0.12, width: 0.46, height: 0.74 },
  { key: 'panel', left: 0.3, top: 0.04, width: 0.7, height: 0.94 }
]

/** On 21:9 the HUD hugs the pillarboxed centre; zones shift inward. */
const ZONES_21_9: CropZone[] = [
  { key: 'banner', left: 0.13, top: 0.83, width: 0.45, height: 0.14 },
  { key: 'items', left: 0.5, top: 0.12, width: 0.35, height: 0.74 },
  { key: 'panel', left: 0.28, top: 0.04, width: 0.58, height: 0.94 }
]

/** Absolute pixel rectangle within the captured frame. */
export interface PixelRect {
  left: number
  top: number
  width: number
  height: number
}

export interface CaptureOptions {
  /** Electron display id (or screenshot-desktop id in fallback mode). */
  display?: number | string
  /** Proportional zone overrides from config.json. */
  zones?: CropZone[]
  /**
   * Regions blacked out before OCR — the app's own always-on-top windows
   * (HUD overlay, dashboard), whose text would otherwise be read as game UI.
   */
  excludeRects?: PixelRect[]
}

export interface CapturedZone {
  key: string
  buffer: Buffer
}

export interface CaptureResult {
  frame: Buffer
  width: number
  height: number
  zones: CapturedZone[]
}

export function zonesForAspect(width: number, height: number): CropZone[] {
  return width / height >= 2.1 ? ZONES_21_9 : ZONES_16_9
}

/** Full-resolution screen grab via Electron's desktopCapturer. */
async function grabFrameElectron(display?: number | string): Promise<Buffer | null> {
  try {
    const electron = await import('electron')
    const { desktopCapturer, screen } = electron
    if (!desktopCapturer || !screen) return null

    const target =
      (display !== undefined &&
        screen.getAllDisplays().find((d) => String(d.id) === String(display))) ||
      screen.getPrimaryDisplay()
    // Request the display's physical pixel size so the "thumbnail" is 1:1.
    const thumbnailSize = {
      width: Math.round(target.size.width * target.scaleFactor),
      height: Math.round(target.size.height * target.scaleFactor)
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
    const source =
      sources.find((s) => s.display_id === String(target.id)) ?? sources[0]
    if (!source || source.thumbnail.isEmpty()) return null
    return source.thumbnail.toPNG()
  } catch (err) {
    console.warn('[capture] desktopCapturer failed, falling back:', err)
    return null
  }
}

async function grabFrameFallback(display?: number | string): Promise<Buffer> {
  const { default: screenshot } = await import('screenshot-desktop')
  return screenshot(
    display !== undefined ? { format: 'png', screen: display } : { format: 'png' }
  )
}

/** Black out the given regions of the frame (clamped to its bounds). */
export async function maskFrameRegions(
  frame: Buffer,
  width: number,
  height: number,
  rects: PixelRect[]
): Promise<Buffer> {
  const clamped = rects
    .map((r) => {
      const left = Math.max(0, Math.round(r.left))
      const top = Math.max(0, Math.round(r.top))
      return {
        left,
        top,
        width: Math.min(width, Math.round(r.left + r.width)) - left,
        height: Math.min(height, Math.round(r.top + r.height)) - top
      }
    })
    .filter((r) => r.width > 0 && r.height > 0)
  if (clamped.length === 0) return frame

  return sharp(frame)
    .composite(
      clamped.map((r) => ({
        input: {
          create: { width: r.width, height: r.height, channels: 3 as const, background: '#000000' }
        },
        left: r.left,
        top: r.top
      }))
    )
    .png()
    .toBuffer()
}

/** Crop a full frame into the configured UI zones. Pure sharp — testable. */
export async function cropZonesFromFrame(
  frame: Buffer,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  const meta = await sharp(frame).metadata()
  const width = meta.width ?? 1920
  const height = meta.height ?? 1080

  if (options.excludeRects?.length) {
    frame = await maskFrameRegions(frame, width, height, options.excludeRects)
  }

  const zones = options.zones?.length ? options.zones : zonesForAspect(width, height)
  const cropped = await Promise.all(
    zones.map(async (zone) => ({
      key: zone.key,
      buffer: await sharp(frame)
        .extract({
          left: Math.round(zone.left * width),
          top: Math.round(zone.top * height),
          width: Math.round(zone.width * width),
          height: Math.round(zone.height * height)
        })
        .png()
        .toBuffer()
    }))
  )

  return { frame, width, height, zones: cropped }
}

/** Grab the display and return the full frame plus cropped PNGs per UI zone. */
export async function captureUiZones(options: CaptureOptions = {}): Promise<CaptureResult> {
  const frame =
    (await grabFrameElectron(options.display)) ?? (await grabFrameFallback(options.display))
  return cropZonesFromFrame(frame, options)
}
