/**
 * Rasterises build/icon.svg into build/icon.ico (the app/installer icon) and
 * build/icon.png (512px, for docs). Run after editing the SVG:
 *
 *   node scripts/make-icon.mjs
 *
 * The .ico is committed, so this is only needed when the artwork changes.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const buildDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Packs PNG buffers into an ICO container (PNG-compressed entries, Vista+). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  let offset = 6 + images.length * 16
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0) // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2) // palette colours
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // colour planes
    entry.writeUInt16LE(32, 6) // bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    return entry
  })

  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}

const svg = await readFile(join(buildDir, 'icon.svg'))

const images = await Promise.all(
  SIZES.map(async (size) => ({
    size,
    data: await sharp(svg, { density: 512 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer()
  }))
)

await writeFile(join(buildDir, 'icon.ico'), buildIco(images))
await sharp(svg, { density: 512 }).resize(512, 512).png().toFile(join(buildDir, 'icon.png'))

console.log(`build/icon.ico (${SIZES.join(', ')}px) + build/icon.png written`)
