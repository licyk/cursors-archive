import { PNG } from 'pngjs'

export type ParsedCursorFormat = 'cur' | 'ani' | 'xcursor'

export interface ParsedCursor {
  format: ParsedCursorFormat
  frames: ParsedCursorFrame[]
}

export interface ParsedCursorFrame {
  images: ParsedCursorImage[]
  delaySeconds: number
}

export interface ParsedCursorImage {
  data: Uint8Array
  width: number
  height: number
  hotspot: { x: number; y: number }
  nominal: number
}

const CUR_MAGIC = Buffer.from([0x00, 0x00, 0x02, 0x00])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const XCURSOR_MAGIC = Buffer.from('Xcur', 'ascii')
const XCURSOR_VERSION = 0x00010000
const XCURSOR_IMAGE_TYPE = 0xfffd0002
const ANI_ICON_FLAG = 0x1

const ICON_DIR_SIZE = 6
const ICON_DIR_ENTRY_SIZE = 16
const RIFF_HEADER_SIZE = 12
const CHUNK_HEADER_SIZE = 8
const ANIH_HEADER_SIZE = 36
const XCURSOR_FILE_HEADER_SIZE = 16
const XCURSOR_TOC_CHUNK_SIZE = 12
const XCURSOR_IMAGE_HEADER_SIZE = 36

interface Chunk {
  name: string
  size: number
  payloadStart: number
  payloadEnd: number
}

export function detectCursorFormat(blob: Uint8Array): ParsedCursorFormat | null {
  const buffer = asBuffer(blob)
  if (startsWith(buffer, CUR_MAGIC)) {
    return 'cur'
  }
  if (isAni(buffer)) {
    return 'ani'
  }
  if (startsWith(buffer, XCURSOR_MAGIC)) {
    return 'xcursor'
  }
  return null
}

export function parseCursorBlob(blob: Uint8Array): ParsedCursor {
  const buffer = asBuffer(blob)
  const format = detectCursorFormat(buffer)
  if (format === 'cur') {
    return { format, frames: parseCur(buffer) }
  }
  if (format === 'ani') {
    return { format, frames: parseAni(buffer) }
  }
  if (format === 'xcursor') {
    return { format, frames: parseXcursor(buffer) }
  }
  throw new Error('Unsupported cursor file format')
}

export function encodeCursorImagePng(image: ParsedCursorImage): Buffer {
  return PNG.sync.write({
    width: image.width,
    height: image.height,
    data: Buffer.from(image.data),
  } as unknown as PNG)
}

export function choosePreviewImage(images: ParsedCursorImage[], targetSize = 64): ParsedCursorImage {
  if (images.length === 0) {
    throw new Error('Cursor frame does not contain images')
  }
  return images.reduce((best, current) => {
    const bestDistance = Math.abs(best.nominal - targetSize)
    const currentDistance = Math.abs(current.nominal - targetSize)
    if (currentDistance !== bestDistance) {
      return currentDistance < bestDistance ? current : best
    }
    return current.nominal > best.nominal ? current : best
  })
}

function parseCur(blob: Buffer): ParsedCursorFrame[] {
  if (blob.length < ICON_DIR_SIZE) {
    throw new Error('CUR file is too small')
  }

  const reserved = blob.readUInt16LE(0)
  const cursorType = blob.readUInt16LE(2)
  const imageCount = blob.readUInt16LE(4)
  if (reserved !== 0 || cursorType !== 2) {
    throw new Error('Not a CUR file')
  }
  if (imageCount <= 0) {
    throw new Error('CUR file does not contain images')
  }

  const entriesEnd = ICON_DIR_SIZE + imageCount * ICON_DIR_ENTRY_SIZE
  if (blob.length < entriesEnd) {
    throw new Error('CUR directory is truncated')
  }

  const images: ParsedCursorImage[] = []
  let offset = ICON_DIR_SIZE
  for (let index = 0; index < imageCount; index += 1) {
    const widthByte = blob.readUInt8(offset)
    const heightByte = blob.readUInt8(offset + 1)
    const hotspotX = blob.readUInt16LE(offset + 4)
    const hotspotY = blob.readUInt16LE(offset + 6)
    const imageSize = blob.readUInt32LE(offset + 8)
    const imageOffset = blob.readUInt32LE(offset + 12)
    offset += ICON_DIR_ENTRY_SIZE

    if (imageOffset + imageSize > blob.length) {
      throw new Error('CUR image payload is truncated')
    }

    const entryWidth = widthByte === 0 ? 256 : widthByte
    const entryHeight = heightByte === 0 ? 256 : heightByte
    const payload = blob.subarray(imageOffset, imageOffset + imageSize)
    const decoded = decodeCurPayload(payload, entryWidth, entryHeight)
    images.push({
      ...decoded,
      hotspot: { x: hotspotX, y: hotspotY },
      nominal: decoded.width,
    })
  }

  return [{ images, delaySeconds: 0 }]
}

function parseAni(blob: Buffer): ParsedCursorFrame[] {
  if (!isAni(blob)) {
    throw new Error('Not an ANI file')
  }

  const riffSize = blob.readUInt32LE(4)
  const riffEnd = Math.min(blob.length, 8 + riffSize)
  let frameCount = 0
  let stepCount = 0
  let displayRate = 1
  let flags = 0
  const iconFrames: ParsedCursorFrame[] = []
  let order: number[] | null = null
  let delays: number[] | null = null

  for (const chunk of iterChunks(blob, RIFF_HEADER_SIZE, riffEnd)) {
    if (chunk.name === 'anih') {
      if (chunk.size !== ANIH_HEADER_SIZE) {
        throw new Error(`Unexpected anih header size ${chunk.size}`)
      }
      const headerSize = blob.readUInt32LE(chunk.payloadStart)
      if (headerSize !== ANIH_HEADER_SIZE) {
        throw new Error(`Unexpected size in anih header ${headerSize}`)
      }
      frameCount = blob.readUInt32LE(chunk.payloadStart + 4)
      stepCount = blob.readUInt32LE(chunk.payloadStart + 8)
      displayRate = blob.readUInt32LE(chunk.payloadStart + 28)
      flags = blob.readUInt32LE(chunk.payloadStart + 32)
      if ((flags & ANI_ICON_FLAG) === 0) {
        throw new Error('Raw BMP ANI frames are not supported')
      }
    } else if (
      chunk.name === 'LIST' &&
      blob.subarray(chunk.payloadStart, chunk.payloadStart + 4).toString('ascii') === 'fram'
    ) {
      for (const child of iterChunks(blob, chunk.payloadStart + 4, chunk.payloadEnd)) {
        if (child.name !== 'icon') {
          continue
        }
        iconFrames.push(parseCur(blob.subarray(child.payloadStart, child.payloadEnd))[0])
      }
    } else if (chunk.name === 'seq ') {
      order = readUInt32List(blob.subarray(chunk.payloadStart, chunk.payloadEnd))
    } else if (chunk.name === 'rate') {
      delays = readUInt32List(blob.subarray(chunk.payloadStart, chunk.payloadEnd))
    }
  }

  if (iconFrames.length === 0) {
    throw new Error('ANI file does not contain icon frames')
  }

  frameCount = frameCount || iconFrames.length
  stepCount = stepCount || frameCount
  order = order ?? Array.from({ length: frameCount }, (_, index) => index)
  delays = delays ?? Array.from({ length: stepCount }, () => displayRate)

  if (order.length !== stepCount) {
    throw new Error(`Wrong animation sequence size: ${order.length}, expected ${stepCount}`)
  }
  if (delays.length !== stepCount) {
    throw new Error(`Wrong animation rate size: ${delays.length}, expected ${stepCount}`)
  }

  return order.map((frameIndex, index) => {
    if (frameIndex >= iconFrames.length) {
      throw new Error(`ANI sequence references missing frame ${frameIndex}`)
    }
    const frame = cloneFrame(iconFrames[frameIndex])
    frame.delaySeconds = delays[index] / 60
    return frame
  })
}

function parseXcursor(blob: Buffer): ParsedCursorFrame[] {
  if (blob.length < XCURSOR_FILE_HEADER_SIZE) {
    throw new Error('Xcursor file is too small')
  }

  const magic = blob.subarray(0, 4)
  const version = blob.readUInt32LE(8)
  const tocSize = blob.readUInt32LE(12)
  if (!magic.equals(XCURSOR_MAGIC)) {
    throw new Error('Not an Xcursor file')
  }
  if (version !== XCURSOR_VERSION) {
    throw new Error(`Unsupported Xcursor version 0x${version.toString(16).padStart(8, '0')}`)
  }

  const tocEnd = XCURSOR_FILE_HEADER_SIZE + tocSize * XCURSOR_TOC_CHUNK_SIZE
  if (blob.length < tocEnd) {
    throw new Error('Xcursor table of contents is truncated')
  }

  const imagesBySize = new Map<number, Array<{ image: ParsedCursorImage; delaySeconds: number }>>()
  for (let index = 0; index < tocSize; index += 1) {
    const offset = XCURSOR_FILE_HEADER_SIZE + index * XCURSOR_TOC_CHUNK_SIZE
    const chunkType = blob.readUInt32LE(offset)
    const chunkSubtype = blob.readUInt32LE(offset + 4)
    const position = blob.readUInt32LE(offset + 8)
    if (chunkType !== XCURSOR_IMAGE_TYPE) {
      continue
    }
    if (position + XCURSOR_IMAGE_HEADER_SIZE > blob.length) {
      throw new Error('Xcursor image header is truncated')
    }

    const headerSize = blob.readUInt32LE(position)
    const actualType = blob.readUInt32LE(position + 4)
    const nominal = blob.readUInt32LE(position + 8)
    const width = blob.readUInt32LE(position + 16)
    const height = blob.readUInt32LE(position + 20)
    const hotspotX = blob.readUInt32LE(position + 24)
    const hotspotY = blob.readUInt32LE(position + 28)
    const delay = blob.readUInt32LE(position + 32)
    if (headerSize !== XCURSOR_IMAGE_HEADER_SIZE) {
      throw new Error(`Unexpected Xcursor image header size ${headerSize}`)
    }
    if (actualType !== chunkType || nominal !== chunkSubtype) {
      throw new Error('Xcursor image chunk does not match table of contents')
    }
    if (width > 0x7fff || height > 0x7fff) {
      throw new Error(`Xcursor image is too large: ${width}x${height}`)
    }
    if (hotspotX > width || hotspotY > height) {
      throw new Error('Xcursor hotspot is outside the image')
    }

    const imageStart = position + XCURSOR_IMAGE_HEADER_SIZE
    const imageSize = width * height * 4
    const imageEnd = imageStart + imageSize
    if (imageEnd > blob.length) {
      throw new Error('Xcursor pixel data is truncated')
    }

    const image: ParsedCursorImage = {
      data: unpremultiplyBgraToRgba(blob.subarray(imageStart, imageEnd)),
      width,
      height,
      hotspot: { x: hotspotX, y: hotspotY },
      nominal,
    }
    const group = imagesBySize.get(nominal) ?? []
    group.push({ image, delaySeconds: delay / 1000 })
    imagesBySize.set(nominal, group)
  }

  if (imagesBySize.size === 0) {
    throw new Error('Xcursor file does not contain images')
  }

  const frameCounts = new Set(Array.from(imagesBySize.values(), (items) => items.length))
  if (frameCounts.size !== 1) {
    throw new Error('Xcursor animations must have the same frame count for every size')
  }

  const sizeSequences = Array.from(imagesBySize.values())
  const frameTotal = sizeSequences[0].length
  const frames: ParsedCursorFrame[] = []
  for (let frameIndex = 0; frameIndex < frameTotal; frameIndex += 1) {
    const frameItems = sizeSequences.map((items) => items[frameIndex])
    const frameDelays = new Set(frameItems.map((item) => item.delaySeconds))
    if (frameDelays.size !== 1) {
      throw new Error('Xcursor animations must use the same delay for every size in a frame')
    }
    frames.push({
      images: frameItems.map((item) => item.image),
      delaySeconds: frameItems[0].delaySeconds,
    })
  }
  return frames
}

function decodeCurPayload(
  payload: Buffer,
  entryWidth: number,
  entryHeight: number,
): Omit<ParsedCursorImage, 'hotspot' | 'nominal'> {
  if (startsWith(payload, PNG_MAGIC)) {
    const image = PNG.sync.read(payload)
    return {
      data: new Uint8Array(image.data),
      width: image.width,
      height: image.height,
    }
  }
  return decodeDibPayload(payload, entryWidth, entryHeight)
}

function decodeDibPayload(
  payload: Buffer,
  entryWidth: number,
  entryHeight: number,
): Omit<ParsedCursorImage, 'hotspot' | 'nominal'> {
  if (payload.length < 40) {
    throw new Error('DIB cursor payload is too small')
  }

  const headerSize = payload.readUInt32LE(0)
  if (headerSize < 40 || payload.length < headerSize) {
    throw new Error(`Unsupported DIB header size ${headerSize}`)
  }

  let width = Math.abs(payload.readInt32LE(4)) || entryWidth
  const rawHeight = payload.readInt32LE(8)
  const planes = payload.readUInt16LE(12)
  const bitCount = payload.readUInt16LE(14)
  const compression = payload.readUInt32LE(16)
  const imageSize = payload.readUInt32LE(20)
  const colorsUsed = payload.readUInt32LE(32)
  if (planes !== 1) {
    throw new Error(`Unsupported DIB plane count ${planes}`)
  }
  if (compression !== 0) {
    throw new Error(`Unsupported compressed DIB cursor payload ${compression}`)
  }
  if (![1, 4, 8, 24, 32].includes(bitCount)) {
    throw new Error(`Unsupported DIB cursor bit depth ${bitCount}`)
  }

  const absoluteHeight = Math.abs(rawHeight)
  if (width <= 0 || absoluteHeight <= 0) {
    throw new Error('Invalid DIB cursor dimensions')
  }

  const palette: Array<[number, number, number]> = []
  let colorTableSize = 0
  if (bitCount <= 8) {
    const colorTableEntries = colorsUsed || 1 << bitCount
    colorTableSize = colorTableEntries * 4
    const colorTableEnd = headerSize + colorTableSize
    if (payload.length < colorTableEnd) {
      throw new Error('DIB cursor color table is truncated')
    }
    for (let offset = headerSize; offset < colorTableEnd; offset += 4) {
      const blue = payload[offset]
      const green = payload[offset + 1]
      const red = payload[offset + 2]
      palette.push([red, green, blue])
    }
  }

  const pixelOffset = headerSize + colorTableSize
  const rowStride = Math.floor((width * bitCount + 31) / 32) * 4
  const maskStride = Math.floor((width + 31) / 32) * 4
  const availableDataSize = payload.length - pixelOffset
  const declaredDataSize = imageSize || availableDataSize
  const height = inferDibCursorHeight({
    absoluteHeight,
    entryHeight,
    rowStride,
    maskStride,
    availableDataSize,
    declaredDataSize,
  })
  width = Math.max(1, width)

  const xorSize = rowStride * height
  const maskOffset = pixelOffset + xorSize
  if (payload.length < pixelOffset + xorSize) {
    throw new Error('DIB cursor pixel data is truncated')
  }

  const hasMask = payload.length >= maskOffset + maskStride * height
  const bottomUp = rawHeight > 0
  const rgba = new Uint8Array(width * height * 4)

  let useAlphaChannel = false
  if (bitCount === 32) {
    for (let row = 0; row < height; row += 1) {
      const rowStart = pixelOffset + row * rowStride
      for (let x = 0; x < width; x += 1) {
        if (payload[rowStart + x * 4 + 3] > 0) {
          useAlphaChannel = true
          break
        }
      }
      if (useAlphaChannel) {
        break
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    const sourceY = bottomUp ? height - 1 - y : y
    const sourceRow = pixelOffset + sourceY * rowStride
    const maskRow = maskOffset + sourceY * maskStride
    for (let x = 0; x < width; x += 1) {
      const dst = (y * width + x) * 4
      let red: number
      let green: number
      let blue: number
      let alpha = 255

      if (bitCount === 32) {
        const src = sourceRow + x * 4
        blue = payload[src]
        green = payload[src + 1]
        red = payload[src + 2]
        alpha = useAlphaChannel ? payload[src + 3] : 255
      } else if (bitCount === 24) {
        const src = sourceRow + x * 3
        blue = payload[src]
        green = payload[src + 1]
        red = payload[src + 2]
      } else {
        const paletteIndex = decodeIndexedDibPixel(payload, sourceRow, x, bitCount)
        if (paletteIndex >= palette.length) {
          throw new Error(`DIB cursor palette index ${paletteIndex} is out of range`)
        }
        ;[red, green, blue] = palette[paletteIndex]
      }

      if (hasMask) {
        const maskByte = payload[maskRow + Math.floor(x / 8)]
        if ((maskByte & (0x80 >> x % 8)) !== 0) {
          alpha = 0
        }
      }

      rgba[dst] = red
      rgba[dst + 1] = green
      rgba[dst + 2] = blue
      rgba[dst + 3] = alpha
    }
  }

  return { data: rgba, width, height }
}

function inferDibCursorHeight(options: {
  absoluteHeight: number
  entryHeight: number
  rowStride: number
  maskStride: number
  availableDataSize: number
  declaredDataSize: number
}): number {
  const {
    absoluteHeight,
    entryHeight,
    rowStride,
    maskStride,
    availableDataSize,
    declaredDataSize,
  } = options
  const candidates: number[] = []
  if (absoluteHeight % 2 === 0) {
    candidates.push(absoluteHeight / 2)
  }
  candidates.push(absoluteHeight)
  if (entryHeight > 0) {
    candidates.push(entryHeight)
  }

  for (const height of candidates) {
    if (
      height > 0 &&
      (rowStride * height + maskStride * height === declaredDataSize ||
        rowStride * height === declaredDataSize)
    ) {
      return height
    }
  }

  for (const height of candidates) {
    if (
      height > 0 &&
      (rowStride * height + maskStride * height <= availableDataSize ||
        rowStride * height <= availableDataSize)
    ) {
      return height
    }
  }

  throw new Error('DIB cursor pixel data is truncated')
}

function decodeIndexedDibPixel(payload: Buffer, rowStart: number, x: number, bitCount: number): number {
  if (bitCount === 8) {
    return payload[rowStart + x]
  }
  if (bitCount === 4) {
    const byte = payload[rowStart + Math.floor(x / 2)]
    return x % 2 === 0 ? byte >> 4 : byte & 0x0f
  }
  if (bitCount === 1) {
    const byte = payload[rowStart + Math.floor(x / 8)]
    return (byte & (0x80 >> x % 8)) !== 0 ? 1 : 0
  }
  throw new Error(`Unsupported indexed DIB cursor bit depth ${bitCount}`)
}

function unpremultiplyBgraToRgba(source: Buffer): Uint8Array {
  const result = new Uint8Array(source.length)
  for (let index = 0; index < source.length; index += 4) {
    const blue = source[index]
    const green = source[index + 1]
    const red = source[index + 2]
    const alpha = source[index + 3]
    if (alpha === 0) {
      result[index] = 0
      result[index + 1] = 0
      result[index + 2] = 0
    } else if (alpha < 255) {
      result[index] = Math.min(255, Math.floor((red * 255 + Math.floor(alpha / 2)) / alpha))
      result[index + 1] = Math.min(
        255,
        Math.floor((green * 255 + Math.floor(alpha / 2)) / alpha),
      )
      result[index + 2] = Math.min(255, Math.floor((blue * 255 + Math.floor(alpha / 2)) / alpha))
    } else {
      result[index] = red
      result[index + 1] = green
      result[index + 2] = blue
    }
    result[index + 3] = alpha
  }
  return result
}

function cloneFrame(frame: ParsedCursorFrame): ParsedCursorFrame {
  return {
    delaySeconds: frame.delaySeconds,
    images: frame.images.map((image) => ({
      data: new Uint8Array(image.data),
      width: image.width,
      height: image.height,
      hotspot: { ...image.hotspot },
      nominal: image.nominal,
    })),
  }
}

function readUInt32List(blob: Buffer): number[] {
  const values: number[] = []
  for (let offset = 0; offset + 4 <= blob.length; offset += 4) {
    values.push(blob.readUInt32LE(offset))
  }
  return values
}

function* iterChunks(blob: Buffer, offset: number, end: number): Generator<Chunk> {
  while (offset + CHUNK_HEADER_SIZE <= end) {
    const name = blob.subarray(offset, offset + 4).toString('ascii')
    const size = blob.readUInt32LE(offset + 4)
    const payloadStart = offset + CHUNK_HEADER_SIZE
    const payloadEnd = payloadStart + size
    if (payloadEnd > end) {
      throw new Error(`Chunk ${name} is truncated`)
    }
    yield { name, size, payloadStart, payloadEnd }
    offset = payloadEnd + (payloadEnd & 1)
  }
}

function isAni(blob: Buffer): boolean {
  return (
    blob.length >= RIFF_HEADER_SIZE &&
    blob.subarray(0, 4).toString('ascii') === 'RIFF' &&
    blob.subarray(8, 12).toString('ascii') === 'ACON'
  )
}

function startsWith(blob: Buffer, magic: Buffer): boolean {
  return blob.length >= magic.length && blob.subarray(0, magic.length).equals(magic)
}

function asBuffer(blob: Uint8Array): Buffer {
  if (Buffer.isBuffer(blob)) {
    return blob
  }
  return Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength)
}
