import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { generateCursorCatalog, type GeneratedCursorCatalog } from '#build/cursorCatalog'

const VIRTUAL_MODULE_ID = 'virtual:cursor-catalog'
const RESOLVED_VIRTUAL_MODULE_ID = `\0${VIRTUAL_MODULE_ID}`

export function cursorCatalogPlugin(): Plugin {
  let config: ResolvedConfig
  let catalogPromise: Promise<GeneratedCursorCatalog> | null = null

  const getCatalog = () => {
    catalogPromise ??= generateCursorCatalog({
      root: config.root,
      base: config.base,
    })
    return catalogPromise
  }

  return {
    name: 'cursor-catalog',
    enforce: 'pre',
    configResolved(resolvedConfig) {
      config = resolvedConfig
    },
    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_VIRTUAL_MODULE_ID
      }
      return null
    },
    async load(id) {
      if (id !== RESOLVED_VIRTUAL_MODULE_ID) {
        return null
      }
      const catalog = await getCatalog()
      return [
        `export const cursorCatalog = ${JSON.stringify(catalog.packages)};`,
        'export default cursorCatalog;',
      ].join('\n')
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url) {
          next()
          return
        }

        const relativePath = devRelativePath(config.base, request.url)
        if (!relativePath) {
          next()
          return
        }

        const catalog = await getCatalog()
        const previewAsset = catalog.assets.find((asset) => asset.fileName === relativePath)
        if (previewAsset) {
          sendBuffer(response, previewAsset.source, previewAsset.contentType)
          return
        }

        const downloadAsset = catalog.downloads.find((asset) => asset.fileName === relativePath)
        if (downloadAsset) {
          await sendFile(request, response, downloadAsset.sourcePath)
          return
        }

        next()
      })
    },
    async generateBundle() {
      const catalog = await getCatalog()
      for (const asset of catalog.assets) {
        this.emitFile({
          type: 'asset',
          fileName: asset.fileName,
          source: asset.source,
        })
      }
      for (const download of catalog.downloads) {
        this.emitFile({
          type: 'asset',
          fileName: download.fileName,
          source: await readFile(download.sourcePath),
        })
      }
    },
  }
}

function devRelativePath(base: string, requestUrl: string): string | null {
  const pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname)
  const basePath = new URL(base, 'http://localhost').pathname
  const withoutBase =
    basePath !== '/' && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname
  return withoutBase.replace(/^\/+/, '') || null
}

function sendBuffer(response: ServerResponse, body: Buffer, contentType: string): void {
  response.statusCode = 200
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', body.length)
  response.setHeader('Cache-Control', 'no-cache')
  response.end(body)
}

async function sendFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
): Promise<void> {
  const fileStats = await stat(filePath)
  response.statusCode = 200
  response.setHeader('Content-Type', 'application/octet-stream')
  response.setHeader('Content-Length', fileStats.size)
  response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeRFC5987(path.basename(filePath))}`)
  response.setHeader('Cache-Control', 'no-cache')

  if (request.method === 'HEAD') {
    response.end()
    return
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('end', resolve)
    stream.pipe(response)
  })
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}
