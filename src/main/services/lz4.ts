/**
 * Minimal LZ4 *block* decompressor — enough to unpack No Man's Sky `save.hg`
 * files, which are a sequence of magic-prefixed LZ4 blocks (no frame format,
 * no dependency needed).
 */

const NMS_BLOCK_MAGIC = 0xfeeda1e5

/** Decompress a single raw LZ4 block into `dst`. Returns bytes written. */
export function lz4DecompressBlock(src: Buffer, dst: Buffer): number {
  let si = 0
  let di = 0

  while (si < src.length) {
    const token = src[si++]

    let literalLen = token >>> 4
    if (literalLen === 0xf) {
      let b: number
      do {
        b = src[si++]
        literalLen += b
      } while (b === 0xff)
    }
    if (di + literalLen > dst.length) throw new RangeError('LZ4: output buffer too small')
    src.copy(dst, di, si, si + literalLen)
    si += literalLen
    di += literalLen

    if (si >= src.length) break // last block ends with literals only

    const offset = src[si] | (src[si + 1] << 8)
    si += 2
    if (offset === 0) throw new Error('LZ4: zero match offset (corrupt block)')

    let matchLen = (token & 0xf) + 4
    if ((token & 0xf) === 0xf) {
      let b: number
      do {
        b = src[si++]
        matchLen += b
      } while (b === 0xff)
    }

    let mi = di - offset
    if (mi < 0) throw new Error('LZ4: match offset out of range (corrupt block)')
    if (di + matchLen > dst.length) throw new RangeError('LZ4: output buffer too small')
    // Byte-by-byte copy is required: matches may overlap the output cursor.
    for (let i = 0; i < matchLen; i++) dst[di++] = dst[mi++]
  }

  return di
}

/**
 * Decompress a headerless raw LZ4 block of unknown uncompressed size
 * (used by older Xbox saves) by retrying with growing buffers.
 */
export function decompressRawLz4(src: Buffer, maxSize = 256 * 1024 * 1024): Buffer {
  for (let size = Math.max(src.length * 16, 1 << 20); size <= maxSize; size *= 4) {
    const dst = Buffer.alloc(size)
    try {
      const written = lz4DecompressBlock(src, dst)
      return dst.subarray(0, written)
    } catch (err) {
      if (!(err instanceof RangeError)) throw err
    }
  }
  throw new Error('LZ4: uncompressed size exceeds limit')
}

/** True if the buffer starts with the NMS compressed-save block magic. */
export function isNmsCompressedSave(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === NMS_BLOCK_MAGIC
}

/**
 * Decompress an NMS save file: repeated blocks of
 * [magic u32][compressedSize u32][uncompressedSize u32][padding u32][data].
 */
export function decompressNmsSave(file: Buffer): Buffer {
  const chunks: Buffer[] = []
  let pos = 0

  while (pos + 16 <= file.length) {
    const magic = file.readUInt32LE(pos)
    if (magic !== NMS_BLOCK_MAGIC) break
    const compressedSize = file.readUInt32LE(pos + 4)
    const uncompressedSize = file.readUInt32LE(pos + 8)
    pos += 16

    const block = file.subarray(pos, pos + compressedSize)
    pos += compressedSize

    const out = Buffer.alloc(uncompressedSize)
    const written = lz4DecompressBlock(block, out)
    chunks.push(written === uncompressedSize ? out : out.subarray(0, written))
  }

  return Buffer.concat(chunks)
}
