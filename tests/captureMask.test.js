/**
 * maskFrameRegions blacks out the app's own overlay windows in captured
 * frames so their text never reaches OCR. Run via `npm test`.
 */
const assert = require('node:assert')
const { test } = require('node:test')
const sharp = require('sharp')
const { maskFrameRegions, cropZonesFromFrame } = require('./.build/main/services/captureService.js')

async function whiteFrame(width, height) {
  return sharp({
    create: { width, height, channels: 3, background: '#ffffff' }
  })
    .png()
    .toBuffer()
}

async function pixelAt(buffer, left, top) {
  const raw = await sharp(buffer)
    .extract({ left, top, width: 1, height: 1 })
    .raw()
    .toBuffer()
  return [raw[0], raw[1], raw[2]]
}

test('maskFrameRegions blacks out the given rect and nothing else', async () => {
  const frame = await whiteFrame(200, 100)
  const masked = await maskFrameRegions(frame, 200, 100, [
    { left: 10, top: 10, width: 50, height: 30 }
  ])
  assert.deepStrictEqual(await pixelAt(masked, 30, 20), [0, 0, 0])
  assert.deepStrictEqual(await pixelAt(masked, 5, 5), [255, 255, 255])
  assert.deepStrictEqual(await pixelAt(masked, 100, 50), [255, 255, 255])
})

test('maskFrameRegions clamps rects that overhang the frame', async () => {
  const frame = await whiteFrame(100, 100)
  const masked = await maskFrameRegions(frame, 100, 100, [
    { left: -20, top: -20, width: 50, height: 50 },
    { left: 90, top: 90, width: 50, height: 50 }
  ])
  assert.deepStrictEqual(await pixelAt(masked, 0, 0), [0, 0, 0])
  assert.deepStrictEqual(await pixelAt(masked, 95, 95), [0, 0, 0])
  assert.deepStrictEqual(await pixelAt(masked, 50, 50), [255, 255, 255])
})

test('maskFrameRegions with no usable rects returns the frame unchanged', async () => {
  const frame = await whiteFrame(50, 50)
  const masked = await maskFrameRegions(frame, 50, 50, [
    { left: 60, top: 60, width: 10, height: 10 }
  ])
  assert.strictEqual(masked, frame)
})

test('cropZonesFromFrame applies excludeRects to the returned frame', async () => {
  const frame = await whiteFrame(1920, 1080)
  const result = await cropZonesFromFrame(frame, {
    excludeRects: [{ left: 0, top: 0, width: 400, height: 300 }]
  })
  assert.deepStrictEqual(await pixelAt(result.frame, 100, 100), [0, 0, 0])
  assert.deepStrictEqual(await pixelAt(result.frame, 1000, 500), [255, 255, 255])
})
