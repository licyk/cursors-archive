import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { parseCursorBlob } from '#build/cursorParser'

describe('cursorParser', () => {
  it('parses a static CUR with a PNG payload', () => {
    const cur = makeCur([
      {
        png: makePng(2, 2, [
          [255, 0, 0, 255],
          [0, 255, 0, 255],
          [0, 0, 255, 255],
          [255, 255, 255, 0],
        ]),
        width: 2,
        height: 2,
        hotspot: [1, 1],
      },
    ])

    const parsed = parseCursorBlob(cur)

    expect(parsed.format).toBe('cur')
    expect(parsed.frames).toHaveLength(1)
    expect(parsed.frames[0].images[0].width).toBe(2)
    expect(parsed.frames[0].images[0].hotspot).toEqual({ x: 1, y: 1 })
    expect(Array.from(parsed.frames[0].images[0].data.slice(0, 4))).toEqual([255, 0, 0, 255])
  })

  it('preserves multiple CUR image sizes', () => {
    const cur = makeCur([
      { png: makePng(2, 2), width: 2, height: 2, hotspot: [0, 0] },
      { png: makePng(4, 4), width: 4, height: 4, hotspot: [2, 3] },
    ])

    const parsed = parseCursorBlob(cur)

    expect(parsed.frames[0].images.map((image) => [image.width, image.height])).toEqual([
      [2, 2],
      [4, 4],
    ])
    expect(parsed.frames[0].images[1].hotspot).toEqual({ x: 2, y: 3 })
  })

  it('parses ANI frame order and delay metadata', () => {
    const frameA = makeCur([{ png: makePng(2, 2), width: 2, height: 2, hotspot: [0, 0] }])
    const frameB = makeCur([{ png: makePng(2, 2), width: 2, height: 2, hotspot: [1, 1] }])
    const ani = makeAni([frameA, frameB], [6, 12])

    const parsed = parseCursorBlob(ani)

    expect(parsed.format).toBe('ani')
    expect(parsed.frames).toHaveLength(2)
    expect(parsed.frames.map((frame) => frame.delaySeconds)).toEqual([0.1, 0.2])
    expect(parsed.frames[1].images[0].hotspot).toEqual({ x: 1, y: 1 })
  })

  it('parses Xcursor premultiplied BGRA pixels', () => {
    const xcursor = makeXcursor()

    const parsed = parseCursorBlob(xcursor)

    expect(parsed.format).toBe('xcursor')
    expect(parsed.frames).toHaveLength(1)
    expect(parsed.frames[0].delaySeconds).toBe(0.125)
    expect(parsed.frames[0].images[0].hotspot).toEqual({ x: 1, y: 1 })
    expect(Array.from(parsed.frames[0].images[0].data)).toEqual([100, 50, 26, 128])
  })
})

function makePng(
  width: number,
  height: number,
  pixels?: Array<[number, number, number, number]>,
): Buffer {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    const pixel = pixels?.[index] ?? [10, 20, 30, 255]
    data[index * 4] = pixel[0]
    data[index * 4 + 1] = pixel[1]
    data[index * 4 + 2] = pixel[2]
    data[index * 4 + 3] = pixel[3]
  }
  return PNG.sync.write({ width, height, data })
}

function makeCur(
  images: Array<{ png: Buffer; width: number; height: number; hotspot: [number, number] }>,
): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(2, 2)
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(images.length * 16)
  let imageOffset = 6 + directory.length
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index]
    const entryOffset = index * 16
    directory.writeUInt8(image.width === 256 ? 0 : image.width, entryOffset)
    directory.writeUInt8(image.height === 256 ? 0 : image.height, entryOffset + 1)
    directory.writeUInt16LE(image.hotspot[0], entryOffset + 4)
    directory.writeUInt16LE(image.hotspot[1], entryOffset + 6)
    directory.writeUInt32LE(image.png.length, entryOffset + 8)
    directory.writeUInt32LE(imageOffset, entryOffset + 12)
    imageOffset += image.png.length
  }

  return Buffer.concat([header, directory, ...images.map((image) => image.png)])
}

function makeAni(frames: Buffer[], rates: number[]): Buffer {
  const anih = Buffer.alloc(36)
  anih.writeUInt32LE(36, 0)
  anih.writeUInt32LE(frames.length, 4)
  anih.writeUInt32LE(frames.length, 8)
  anih.writeUInt32LE(32, 20)
  anih.writeUInt32LE(1, 24)
  anih.writeUInt32LE(1, 28)
  anih.writeUInt32LE(1, 32)

  const frameList = Buffer.concat([
    Buffer.from('fram', 'ascii'),
    ...frames.map((frame) => riffChunk('icon', frame)),
  ])
  const ratePayload = Buffer.alloc(rates.length * 4)
  rates.forEach((rate, index) => ratePayload.writeUInt32LE(rate, index * 4))
  const body = Buffer.concat([riffChunk('anih', anih), riffChunk('LIST', frameList), riffChunk('rate', ratePayload)])
  const header = Buffer.alloc(12)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(body.length + 4, 4)
  header.write('ACON', 8, 'ascii')
  return Buffer.concat([header, body])
}

function riffChunk(name: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(name, 0, 'ascii')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload, payload.length % 2 === 1 ? Buffer.from([0]) : Buffer.alloc(0)])
}

function makeXcursor(): Buffer {
  const premultiplied = Buffer.from([13, 25, 50, 128])
  const imageHeader = Buffer.alloc(36)
  imageHeader.writeUInt32LE(36, 0)
  imageHeader.writeUInt32LE(0xfffd0002, 4)
  imageHeader.writeUInt32LE(2, 8)
  imageHeader.writeUInt32LE(1, 12)
  imageHeader.writeUInt32LE(1, 16)
  imageHeader.writeUInt32LE(1, 20)
  imageHeader.writeUInt32LE(1, 24)
  imageHeader.writeUInt32LE(1, 28)
  imageHeader.writeUInt32LE(125, 32)

  const fileHeader = Buffer.alloc(16)
  fileHeader.write('Xcur', 0, 'ascii')
  fileHeader.writeUInt32LE(16, 4)
  fileHeader.writeUInt32LE(0x00010000, 8)
  fileHeader.writeUInt32LE(1, 12)

  const toc = Buffer.alloc(12)
  toc.writeUInt32LE(0xfffd0002, 0)
  toc.writeUInt32LE(2, 4)
  toc.writeUInt32LE(28, 8)

  return Buffer.concat([fileHeader, toc, imageHeader, premultiplied])
}
