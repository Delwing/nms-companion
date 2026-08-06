/**
 * PP-OCR (PaddleOCR) engine on onnxruntime-node: DBNet text detection +
 * CTC sequence recognition. Runs on DirectML (GPU) when available, CPU
 * otherwise. One full-frame pass yields positioned text boxes; zone text
 * is derived by filtering boxes against the proportional crop zones, so
 * a scan needs exactly one detection + one batched recognition run.
 * Models (~14 MB) are downloaded once into userData/paddle-ocr.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { cpus } from 'os'
import { join } from 'path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import type { CropZone } from './captureService'

export interface OcrBox {
  x0: number
  y0: number
  x1: number
  y1: number
  text: string
  conf: number
}

export interface FrameOcr {
  boxes: OcrBox[]
  width: number
  height: number
}

/** Pinned model assets (PP-OCRv4 det is script-agnostic; rec is English). */
const MODEL_FILES: Array<{ name: string; url: string; minBytes: number }> = [
  {
    name: 'det.onnx',
    url: 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv4/ch_PP-OCRv4_det_infer.onnx',
    minBytes: 1_000_000
  },
  {
    name: 'rec_en.onnx',
    url: 'https://huggingface.co/SWHL/RapidOCR/resolve/main/PP-OCRv3/en_PP-OCRv3_rec_infer.onnx',
    minBytes: 1_000_000
  },
  {
    name: 'en_dict.txt',
    url: 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/en_dict.txt',
    minBytes: 100
  }
]

const DET_MEAN = [0.485, 0.456, 0.406]
const DET_STD = [0.229, 0.224, 0.225]
const DET_LIMIT = 960
const DET_THRESH = 0.3
const BOX_THRESH = 0.5
const UNCLIP = 1.6
const REC_H = 48
const REC_BATCH = 8

/** Download any missing model file. Throws when a download fails. */
export async function ensureModels(modelDir: string): Promise<void> {
  mkdirSync(modelDir, { recursive: true })
  for (const { name, url, minBytes } of MODEL_FILES) {
    const dest = join(modelDir, name)
    if (existsSync(dest) && statSync(dest).size >= minBytes) continue
    console.log(`[paddle] downloading ${name}...`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
    const body = Buffer.from(await res.arrayBuffer())
    // HF serves tiny text bodies ("Entry not found") with status 200.
    if (body.length < minBytes) throw new Error(`${name}: truncated download (${body.length}B)`)
    writeFileSync(dest, body)
  }
}

/** Greedy CTC decode: argmax per timestep, collapse repeats, drop blank@0. */
export function ctcDecode(
  probs: Float32Array,
  steps: number,
  classes: number,
  dict: string[]
): { text: string; conf: number } {
  let text = ''
  let confSum = 0
  let confN = 0
  let prev = -1
  for (let step = 0; step < steps; step++) {
    let best = 0
    let bestP = -Infinity
    const base = step * classes
    for (let c = 0; c < classes; c++) {
      if (probs[base + c] > bestP) {
        bestP = probs[base + c]
        best = c
      }
    }
    if (best !== 0 && best !== prev) {
      text += dict[best] ?? ''
      confSum += bestP
      confN++
    }
    prev = best
  }
  return { text, conf: confN ? confSum / confN : 0 }
}

interface Line {
  y0: number
  y1: number
  x0: number
  x1: number
  parts: OcrBox[]
}

/**
 * Reconstruct reading-order text from positioned boxes, optionally keeping
 * only boxes whose centre falls inside a proportional crop zone. Boxes on
 * the same visual row are joined; horizontal jumps over 2% of the frame
 * width become a wide gap ("    ") — the column separator the entity
 * parsers split on (they expect Tesseract's \s{2,} column gaps).
 */
export function assembleText(frame: FrameOcr, zone?: CropZone): string {
  const inZone = (b: OcrBox): boolean => {
    if (!zone) return true
    const cx = (b.x0 + b.x1) / 2 / frame.width
    const cy = (b.y0 + b.y1) / 2 / frame.height
    return (
      cx >= zone.left && cx <= zone.left + zone.width && cy >= zone.top && cy <= zone.top + zone.height
    )
  }

  const sorted = frame.boxes
    .filter((b) => b.text.trim().length > 0 && inZone(b))
    .sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)

  const lines: Line[] = []
  for (const b of sorted) {
    const cy = (b.y0 + b.y1) / 2
    // Same row: vertical centre inside the line's band and no horizontal
    // overlap (overlapping spans are genuinely stacked text).
    const line = lines.find((l) => cy > l.y0 && cy < l.y1 && !(b.x0 < l.x1 && b.x1 > l.x0))
    if (line) {
      line.parts.push(b)
      line.y0 = Math.min(line.y0, b.y0)
      line.y1 = Math.max(line.y1, b.y1)
      line.x0 = Math.min(line.x0, b.x0)
      line.x1 = Math.max(line.x1, b.x1)
    } else {
      lines.push({ y0: b.y0, y1: b.y1, x0: b.x0, x1: b.x1, parts: [b] })
    }
  }

  return lines
    .map((l) => {
      const parts = [...l.parts].sort((a, b) => a.x0 - b.x0)
      let text = ''
      let prevEnd: number | null = null
      for (const p of parts) {
        if (prevEnd !== null) text += p.x0 - prevEnd > frame.width * 0.02 ? '    ' : ' '
        text += p.text
        prevEnd = p.x1
      }
      return text
    })
    .join('\n')
}

interface RecItem {
  box: { x0: number; y0: number; x1: number; y1: number }
  w: number
  h: number
  targetW: number
}

export class PaddleOcr {
  private det: ort.InferenceSession
  private rec: ort.InferenceSession
  private dict: string[]

  private constructor(det: ort.InferenceSession, rec: ort.InferenceSession, dict: string[]) {
    this.det = det
    this.rec = rec
    this.dict = dict
  }

  /** Load sessions, preferring DirectML; falls back to CPU-only. */
  static async load(modelDir: string): Promise<PaddleOcr> {
    const base: ort.InferenceSession.SessionOptions = {
      intraOpNumThreads: Math.max(1, cpus().length - 1),
      graphOptimizationLevel: 'all'
    }
    const detPath = join(modelDir, 'det.onnx')
    const recPath = join(modelDir, 'rec_en.onnx')
    const create = async (opts: ort.InferenceSession.SessionOptions): Promise<[ort.InferenceSession, ort.InferenceSession]> =>
      Promise.all([
        ort.InferenceSession.create(detPath, opts),
        ort.InferenceSession.create(recPath, opts)
      ])
    let det: ort.InferenceSession
    let rec: ort.InferenceSession
    try {
      ;[det, rec] = await create({ ...base, executionProviders: ['dml', 'cpu'] })
    } catch (err) {
      console.warn('[paddle] DirectML unavailable, using CPU:', err)
      ;[det, rec] = await create(base)
    }
    const dict = readFileSync(join(modelDir, 'en_dict.txt'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.length > 0)
    return new PaddleOcr(det, rec, ['<blank>', ...dict, ' '])
  }

  /**
   * Run a dummy det + rec so DirectML compiles its shaders off the hotkey
   * path (first real GPU inference is otherwise ~2 s slower).
   */
  async warmUp(): Promise<void> {
    const blank = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#000000' }
    })
      .png()
      .toBuffer()
    await this.detect(blank)
    const feeds: Record<string, ort.Tensor> = {}
    feeds[this.rec.inputNames[0]] = new ort.Tensor(
      'float32',
      new Float32Array(3 * REC_H * 64),
      [1, 3, REC_H, 64]
    )
    await this.rec.run(feeds)
  }

  /** Full pipeline for one frame: detect boxes, recognize each, in order. */
  async recognizeFrame(frame: Buffer): Promise<FrameOcr> {
    const { boxes: rects, width, height } = await this.detect(frame)
    const boxes = await this.recognizeAll(frame, rects)
    return { boxes, width, height }
  }

  private async detect(
    frame: Buffer
  ): Promise<{ boxes: Array<{ x0: number; y0: number; x1: number; y1: number }>; width: number; height: number }> {
    const meta = await sharp(frame).metadata()
    const ow = meta.width ?? 1
    const oh = meta.height ?? 1
    const scale = Math.min(1, DET_LIMIT / Math.max(ow, oh))
    const rw = Math.max(32, Math.round((ow * scale) / 32) * 32)
    const rh = Math.max(32, Math.round((oh * scale) / 32) * 32)

    const { data } = await sharp(frame)
      .removeAlpha()
      .resize(rw, rh, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true })

    // NCHW float32, BGR channel order (RapidOCR feeds cv2 BGR images).
    const plane = rw * rh
    const input = new Float32Array(3 * plane)
    for (let i = 0; i < plane; i++) {
      const r = data[i * 3] / 255
      const g = data[i * 3 + 1] / 255
      const b = data[i * 3 + 2] / 255
      input[i] = (b - DET_MEAN[0]) / DET_STD[0]
      input[plane + i] = (g - DET_MEAN[1]) / DET_STD[1]
      input[2 * plane + i] = (r - DET_MEAN[2]) / DET_STD[2]
    }

    const feeds: Record<string, ort.Tensor> = {}
    feeds[this.det.inputNames[0]] = new ort.Tensor('float32', input, [1, 3, rh, rw])
    const out = await this.det.run(feeds)
    const prob = out[this.det.outputNames[0]].data as Float32Array

    return { boxes: probMapToBoxes(prob, rw, rh, ow, oh), width: ow, height: oh }
  }

  /** Batched recognition: sort crops by width, pad each batch to its widest. */
  private async recognizeAll(
    frame: Buffer,
    rects: Array<{ x0: number; y0: number; x1: number; y1: number }>
  ): Promise<OcrBox[]> {
    const items: RecItem[] = rects
      .map((box) => {
        const w = Math.round(box.x1 - box.x0)
        const h = Math.round(box.y1 - box.y0)
        return { box, w, h, targetW: Math.max(16, Math.min(1024, Math.round((REC_H * w) / h))) }
      })
      .filter((it) => it.w >= 2 && it.h >= 8)
      .sort((a, b) => a.targetW - b.targetW)

    const out: OcrBox[] = []
    for (let start = 0; start < items.length; start += REC_BATCH) {
      const batch = items.slice(start, start + REC_BATCH)
      const maxW = Math.max(...batch.map((it) => it.targetW))
      const plane = maxW * REC_H
      const input = new Float32Array(batch.length * 3 * plane) // zero pad = mid-gray
      await Promise.all(
        batch.map(async (it, bi) => {
          const { data } = await sharp(frame)
            .extract({
              left: Math.round(it.box.x0),
              top: Math.round(it.box.y0),
              width: it.w,
              height: it.h
            })
            .removeAlpha()
            .resize(it.targetW, REC_H, { fit: 'fill' })
            .raw()
            .toBuffer({ resolveWithObject: true })
          const base = bi * 3 * plane
          for (let y = 0; y < REC_H; y++) {
            for (let x = 0; x < it.targetW; x++) {
              const src = (y * it.targetW + x) * 3
              const dst = y * maxW + x
              input[base + dst] = (data[src + 2] / 255 - 0.5) / 0.5
              input[base + plane + dst] = (data[src + 1] / 255 - 0.5) / 0.5
              input[base + 2 * plane + dst] = (data[src] / 255 - 0.5) / 0.5
            }
          }
        })
      )
      const feeds: Record<string, ort.Tensor> = {}
      feeds[this.rec.inputNames[0]] = new ort.Tensor('float32', input, [
        batch.length,
        3,
        REC_H,
        maxW
      ])
      const res = await this.rec.run(feeds)
      const t = res[this.rec.outputNames[0]]
      const [, steps, classes] = t.dims
      const probs = t.data as Float32Array
      for (let bi = 0; bi < batch.length; bi++) {
        const slice = probs.subarray(bi * steps * classes, (bi + 1) * steps * classes)
        out.push({ ...batch[bi].box, ...ctcDecode(slice, steps, classes, this.dict) })
      }
    }
    return out
  }

  async close(): Promise<void> {
    await Promise.all([this.det.release(), this.rec.release()])
  }
}

/**
 * DBNet postprocess: threshold the probability map, flood-fill connected
 * components, keep confident ones, unclip their bounding rects and map
 * back to source-image pixels.
 */
export function probMapToBoxes(
  prob: Float32Array,
  rw: number,
  rh: number,
  ow: number,
  oh: number
): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const plane = rw * rh
  const bin = new Uint8Array(plane)
  for (let i = 0; i < plane; i++) if (prob[i] > DET_THRESH) bin[i] = 1

  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  const stack = new Int32Array(plane)
  for (let start = 0; start < plane; start++) {
    if (bin[start] !== 1) continue
    let top = 0
    stack[top++] = start
    bin[start] = 2
    let minX = rw
    let maxX = 0
    let minY = rh
    let maxY = 0
    let count = 0
    let scoreSum = 0
    while (top > 0) {
      const p = stack[--top]
      const y = (p / rw) | 0
      const x = p % rw
      count++
      scoreSum += prob[p]
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (x > 0 && bin[p - 1] === 1) {
        bin[p - 1] = 2
        stack[top++] = p - 1
      }
      if (x < rw - 1 && bin[p + 1] === 1) {
        bin[p + 1] = 2
        stack[top++] = p + 1
      }
      if (y > 0 && bin[p - rw] === 1) {
        bin[p - rw] = 2
        stack[top++] = p - rw
      }
      if (y < rh - 1 && bin[p + rw] === 1) {
        bin[p + rw] = 2
        stack[top++] = p + rw
      }
    }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    if (w < 3 || h < 3 || scoreSum / count < BOX_THRESH) continue
    // DB unclip for an axis-aligned rect: offset = area * ratio / perimeter.
    const off = Math.round((w * h * UNCLIP) / (2 * (w + h)))
    boxes.push({
      x0: (Math.max(0, minX - off) / rw) * ow,
      y0: (Math.max(0, minY - off) / rh) * oh,
      x1: (Math.min(rw, maxX + 1 + off) / rw) * ow,
      y1: (Math.min(rh, maxY + 1 + off) / rh) * oh
    })
  }
  return boxes
}
