/**
 * OCR pipeline. Primary engine is PP-OCR on onnxruntime (paddleOcr.ts):
 * one det+rec pass over the full frame, with per-zone text derived from
 * box positions. Falls back to sharp preprocessing -> tesseract.js when
 * the models can't be downloaded or the runtime fails. Both engines are
 * created once and reused so a full hotkey -> DB-commit cycle stays
 * inside the 1.5 s latency budget. Every scan dumps its intermediate
 * images + raw text into debugDir so crop zones and thresholds can be
 * tuned against real screenshots.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import sharp from 'sharp'
import { createWorker, PSM, type Worker } from 'tesseract.js'
import type { EnvoyData, ParsedPlanetData, SystemInfoData } from '@shared/types'
import { captureUiZones, zonesForAspect, type CaptureOptions, type CaptureResult } from './captureService'
import { isEnvoyScreen, parseEnvoyData } from './envoyParser'
import { assembleText, ensureModels, PaddleOcr } from './paddleOcr'
import { CARD_SIGNATURE, parsePlanetData, parseScore } from './planetParser'
import { isSystemInfoScreen, parseSystemInfo } from './systemParser'

let worker: Worker | null = null
let workerInit: Promise<Worker> | null = null

let paddle: PaddleOcr | null = null
let paddleInit: Promise<PaddleOcr | null> | null = null

/** Lazy PP-OCR engine; resolves null (-> Tesseract fallback) on any failure. */
function getPaddle(modelDir?: string): Promise<PaddleOcr | null> {
  if (!modelDir) return Promise.resolve(null)
  if (!paddleInit) {
    paddleInit = (async () => {
      try {
        await ensureModels(modelDir)
        paddle = await PaddleOcr.load(modelDir)
        console.log('[ocr] PaddleOCR engine ready')
        return paddle
      } catch (err) {
        console.warn('[ocr] PaddleOCR unavailable, falling back to Tesseract:', err)
        return null
      }
    })()
  }
  return paddleInit
}

async function getWorker(cachePath: string): Promise<Worker> {
  if (worker) return worker
  if (!workerInit) {
    workerInit = createWorker('eng', 1, { cachePath }).then(async (w) => {
      // Game UI panels are a single left-aligned text block.
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: '1'
      })
      worker = w
      return w
    })
  }
  return workerInit
}

/**
 * Isolate the white UI text: grayscale -> contrast boost -> binary
 * threshold -> invert (Tesseract reads dark-on-light far better).
 */
export async function preprocessCrop(imageBuffer: Buffer, threshold = 165): Promise<Buffer> {
  // flatten drops the alpha channel first: negate() would otherwise invert
  // alpha too, leaving a fully transparent (blank) image. Steps run as
  // separate passes so libvips can't reorder them within one pipeline.
  const boosted = await sharp(imageBuffer)
    .flatten({ background: '#000000' })
    .grayscale()
    .linear(1.5, -0.2 * 255)
    .toBuffer()
  const binary = await sharp(boosted).threshold(threshold).toBuffer()
  return sharp(binary).negate({ alpha: false }).png().toBuffer()
}

/** Preprocess a cropped frame and OCR it (per-spec sharp pipeline). */
export async function processCropToText(imageBuffer: Buffer, cachePath: string): Promise<string> {
  const processed = await preprocessCrop(imageBuffer)
  const w = await getWorker(cachePath)
  const {
    data: { text }
  } = await w.recognize(processed)
  return text
}

export interface OcrRunResult {
  kind: 'planet' | 'envoy' | 'system'
  data?: ParsedPlanetData
  envoy?: EnvoyData
  system?: SystemInfoData
  rawText: string
  zone: string
  engine: 'paddle' | 'tesseract'
}

export interface ScanOptions extends CaptureOptions {
  /** Directory receiving per-scan timestamped dump folders. */
  debugDir?: string
  /** Directory holding the PP-OCR models (downloaded on first use). */
  paddleDir?: string
  /** Force an engine (config.json "ocrEngine"); default prefers paddle. */
  engine?: 'paddle' | 'tesseract'
}

const DEBUG_SCANS_KEPT = 12

/** Each scan gets its own folder so repeated captures don't overwrite. */
function makeDumper(debugDir?: string): (name: string, content: Buffer | string) => void {
  if (!debugDir) return () => undefined
  const scanDir = join(debugDir, `scan-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  try {
    mkdirSync(scanDir, { recursive: true })
    const old = readdirSync(debugDir)
      .filter((n) => n.startsWith('scan-'))
      .sort()
      .slice(0, -DEBUG_SCANS_KEPT)
    for (const dir of old) rmSync(join(debugDir, dir), { recursive: true, force: true })
  } catch (err) {
    console.warn('[ocr] debug dir setup failed:', err)
  }
  return (name, content) => {
    try {
      writeFileSync(join(scanDir, name), content)
    } catch (err) {
      console.warn('[ocr] debug dump failed:', err)
    }
  }
}

/**
 * Capture the screen and classify it in stages, OCRing only what each
 * stage needs:
 *  1. banner zone -> guild envoy screen? parse guild + item stock.
 *  2. wide right zone -> Discoveries-menu planet card ("Discovered by:")?
 *  3. otherwise -> full-frame pass for free-floating panels (ship approach
 *     view, Analysis Visor), whose position varies with the camera.
 */
export async function scanScreen(cachePath: string, opts: ScanOptions = {}): Promise<OcrRunResult> {
  const capture = await captureUiZones(opts)
  const dump = makeDumper(opts.debugDir)
  dump('frame.png', capture.frame)

  if (opts.engine !== 'tesseract') {
    const engine = await getPaddle(opts.paddleDir)
    if (engine) {
      try {
        return await scanWithPaddle(engine, capture, opts, dump)
      } catch (err) {
        console.warn('[ocr] paddle scan failed, retrying with Tesseract:', err)
      }
    }
  }
  return scanWithTesseract(cachePath, capture, dump)
}

/**
 * PP-OCR path: one full-frame det+rec pass; banner/items/panel text is
 * carved out of the positioned boxes with the same proportional zones the
 * Tesseract path crops with, so classification logic is shared.
 */
async function scanWithPaddle(
  engine: PaddleOcr,
  capture: CaptureResult,
  opts: ScanOptions,
  dump: (name: string, content: Buffer | string) => void
): Promise<OcrRunResult> {
  const frameOcr = await engine.recognizeFrame(capture.frame)
  dump('paddle-boxes.json', JSON.stringify(frameOcr.boxes, null, 2))

  const zones = opts.zones?.length ? opts.zones : zonesForAspect(capture.width, capture.height)
  const zoneText = (key: string): string => {
    const zone = zones.find((z) => z.key === key)
    return zone ? assembleText(frameOcr, zone) : ''
  }

  const bannerText = zoneText('banner')
  const fullText = assembleText(frameOcr)
  dump('banner-paddle.txt', bannerText)
  dump('full-paddle.txt', fullText)

  let result: OcrRunResult

  if (isEnvoyScreen(bannerText)) {
    const itemsText = zoneText('items')
    dump('items-paddle.txt', itemsText)
    result = {
      kind: 'envoy',
      envoy: parseEnvoyData(bannerText, itemsText),
      rawText: `${bannerText}\n${itemsText}`.trim(),
      zone: 'banner+items',
      engine: 'paddle'
    }
  } else {
    const panelText = zoneText('panel')
    dump('panel-paddle.txt', panelText)

    if (CARD_SIGNATURE.test(panelText)) {
      result = {
        kind: 'planet',
        data: parsePlanetData(panelText),
        rawText: panelText,
        zone: 'card',
        engine: 'paddle'
      }
    } else {
      const joined = `${panelText}\n${fullText}`
      const sysParse = parseSystemInfo(joined)
      if (isSystemInfoScreen(sysParse, joined)) {
        result = {
          kind: 'system',
          system: sysParse,
          rawText: joined.trim(),
          zone: 'system',
          engine: 'paddle'
        }
      } else {
        const candidates: Array<[string, string]> = [
          ['full', fullText],
          ['panel', panelText]
        ]
        let best: OcrRunResult | null = null
        let bestScore = -1
        for (const [zone, rawText] of candidates) {
          const data = parsePlanetData(rawText)
          const score = parseScore(data)
          if (score > bestScore) {
            best = { kind: 'planet', data, rawText, zone, engine: 'paddle' }
            bestScore = score
          }
        }
        result = best!
      }
    }
  }

  dumpResult(dump, result, capture)
  return result
}

async function scanWithTesseract(
  cachePath: string,
  capture: CaptureResult,
  dump: (name: string, content: Buffer | string) => void
): Promise<OcrRunResult> {
  const w = await getWorker(cachePath)
  const ocrPass = async (name: string, buffer: Buffer, threshold: number): Promise<string> => {
    const processed = await preprocessCrop(buffer, threshold)
    dump(`${name}-processed-${threshold}.png`, processed)
    const {
      data: { text }
    } = await w.recognize(processed)
    dump(`${name}-raw-${threshold}.txt`, text)
    return text
  }
  const zoneBuf = (key: string): Buffer | undefined =>
    capture.zones.find((z) => z.key === key)?.buffer

  let result: OcrRunResult

  const bannerBuf = zoneBuf('banner')
  const bannerText = bannerBuf ? (dump('banner-crop.png', bannerBuf), await ocrPass('banner', bannerBuf, 165)) : ''

  const itemsBuf = zoneBuf('items')
  if (isEnvoyScreen(bannerText) && itemsBuf) {
    dump('items-crop.png', itemsBuf)
    // Dual threshold: dimmed rank-locked rows sit well below the brightness
    // of active UI text.
    const itemsText = [await ocrPass('items', itemsBuf, 165), await ocrPass('items', itemsBuf, 90)].join('\n')
    result = {
      kind: 'envoy',
      envoy: parseEnvoyData(bannerText, itemsText),
      rawText: `${bannerText}\n${itemsText}`.trim(),
      zone: 'banner+items',
      engine: 'tesseract'
    }
  } else {
    const panelBuf = zoneBuf('panel')
    const panelText = panelBuf ? (dump('panel-crop.png', panelBuf), await ocrPass('panel', panelBuf, 165)) : ''

    if (CARD_SIGNATURE.test(panelText)) {
      // 'card' marks a Discoveries-menu scan: it may be browsing any system,
      // unlike ship/visor panels which always describe the current one.
      result = {
        kind: 'planet',
        data: parsePlanetData(panelText),
        rawText: panelText,
        zone: 'card',
        engine: 'tesseract'
      }
    } else {
      // Floating panels: downscale the whole frame (speed) and OCR it all.
      const fullBuf = await sharp(capture.frame).resize({ width: 1920 }).png().toBuffer()
      const fullText = await ocrPass('full', fullBuf, 165)

      // Galaxy-map hover / Discoveries system overview: race + economy +
      // conflict live here and never on a planet panel.
      const joined = `${panelText}\n${fullText}`
      const sysParse = parseSystemInfo(joined)
      if (isSystemInfoScreen(sysParse, joined)) {
        result = {
          kind: 'system',
          system: sysParse,
          rawText: joined.trim(),
          zone: 'system',
          engine: 'tesseract'
        }
      } else {
        const candidates: Array<[string, string]> = [
          ['full', fullText],
          ['panel', panelText]
        ]
        let best: OcrRunResult | null = null
        let bestScore = -1
        for (const [zone, rawText] of candidates) {
          const data = parsePlanetData(rawText)
          const score = parseScore(data)
          if (score > bestScore) {
            best = { kind: 'planet', data, rawText, zone, engine: 'tesseract' }
            bestScore = score
          }
        }
        result = best!
      }
    }
  }

  dumpResult(dump, result, capture)
  return result
}

function dumpResult(
  dump: (name: string, content: Buffer | string) => void,
  result: OcrRunResult,
  capture: CaptureResult
): void {
  dump(
    'result.json',
    JSON.stringify(
      {
        kind: result.kind,
        zone: result.zone,
        engine: result.engine,
        screen: `${capture.width}x${capture.height}`,
        data: result.data ?? result.envoy ?? result.system
      },
      null,
      2
    )
  )
}

/** Pre-warm both engines so the first hotkey scan is fast: Tesseract's
 * worker spawn and PaddleOCR's model download + DirectML shader compile
 * both happen off the hotkey path. */
export function warmUp(cachePath: string, paddleDir?: string): void {
  getWorker(cachePath).catch((err) => console.warn('[ocr] warm-up failed:', err))
  getPaddle(paddleDir)
    .then((p) => p?.warmUp())
    .catch((err) => console.warn('[ocr] paddle warm-up failed:', err))
}

export async function shutdownOcr(): Promise<void> {
  if (worker) {
    await worker.terminate()
    worker = null
    workerInit = null
  }
  if (paddle) {
    await paddle.close().catch(() => undefined)
    paddle = null
    paddleInit = null
  }
}
