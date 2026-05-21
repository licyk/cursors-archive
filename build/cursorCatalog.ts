import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtemp, readdir, readFile, rm, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CursorFormat, CursorPackage, CursorPlatform, CursorSample } from '../src/types/cursor'
import {
  choosePreviewImage,
  detectCursorFormat,
  encodeCursorImagePng,
  parseCursorBlob,
  type ParsedCursor,
} from './cursorParser'

export interface CatalogArchiveInput {
  platform: CursorPlatform
  archivePath: string
}

export interface CatalogGenerationOptions {
  root: string
  base?: string
  archives?: CatalogArchiveInput[]
}

export interface GeneratedCatalogAsset {
  fileName: string
  source: Buffer
  contentType: string
}

export interface GeneratedDownloadAsset {
  fileName: string
  sourcePath: string
}

export interface GeneratedCursorCatalog {
  packages: CursorPackage[]
  assets: GeneratedCatalogAsset[]
  downloads: GeneratedDownloadAsset[]
}

interface ParsedCursorEntry {
  relativePath: string
  role: CursorRole | null
  parsed: ParsedCursor
}

type CursorRole =
  | 'normal'
  | 'help'
  | 'busy'
  | 'text'
  | 'link'
  | 'move'
  | 'crosshair'
  | 'unavailable'
  | 'resize'

const ARCHIVE_EXTENSIONS = new Set(['.zip', '.7z', '.rar'])
const PLATFORMS: CursorPlatform[] = ['windows', 'linux']
const ROLE_ORDER: CursorRole[] = [
  'normal',
  'help',
  'busy',
  'text',
  'link',
  'move',
  'crosshair',
  'unavailable',
  'resize',
]

const ROLE_PATTERNS: Array<{ role: CursorRole; patterns: string[] }> = [
  {
    role: 'normal',
    patterns: ['pointer', 'arrow', 'left_ptr', 'default', 'normal', '正常选择', '正常'],
  },
  {
    role: 'help',
    patterns: ['help', 'question', 'whats-this', '帮助'],
  },
  {
    role: 'busy',
    patterns: ['busy', 'wait', 'progress', 'watch', 'working', 'work', '忙', '后台'],
  },
  {
    role: 'text',
    patterns: ['text', 'ibeam', 'xterm', '文本'],
  },
  {
    role: 'link',
    patterns: ['link', 'hand', 'pointing', '链接', '手'],
  },
  {
    role: 'move',
    patterns: ['move', 'all-scroll', 'fleur', '移动'],
  },
  {
    role: 'crosshair',
    patterns: ['crosshair', 'cross', 'precision', '精确'],
  },
  {
    role: 'unavailable',
    patterns: ['unavailable', 'unavailiable', 'not-allowed', 'forbidden', 'no-drop', '不可用', '禁止'],
  },
  {
    role: 'resize',
    patterns: ['resize', 'size', 'horz', 'vert', 'dgn', 'ew-', 'ns-', 'nwse', 'nesw', '水平', '垂直', '对角线'],
  },
]

const require = createRequire(import.meta.url)
const sevenZip = require('7zip-bin-full') as {
  path7z?: string
  path7zzs?: string
  path7x?: string
}
const sevenZipPath = sevenZip.path7zzs ?? sevenZip.path7z ?? sevenZip.path7x ?? ''

export async function generateCursorCatalog(
  options: CatalogGenerationOptions,
): Promise<GeneratedCursorCatalog> {
  if (!sevenZipPath) {
    throw new Error('7zip-bin-full did not provide a 7-Zip binary path')
  }

  const base = options.base ?? '/'
  const archives = options.archives ?? (await discoverArchives(options.root))
  const assets: GeneratedCatalogAsset[] = []
  const downloads: GeneratedDownloadAsset[] = []
  const packages: CursorPackage[] = []

  for (const archive of archives) {
    packages.push(await processArchive(base, archive, assets, downloads))
  }

  return {
    packages: packages.sort((left, right) => {
      if (left.platform !== right.platform) {
        return left.platform.localeCompare(right.platform)
      }
      return left.name.localeCompare(right.name, 'zh-Hans-CN')
    }),
    assets,
    downloads,
  }
}

async function discoverArchives(root: string): Promise<CatalogArchiveInput[]> {
  const archives: CatalogArchiveInput[] = []
  for (const platform of PLATFORMS) {
    const platformDir = path.join(root, platform)
    const entries = await readdir(platformDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue
      }
      const extension = path.extname(entry.name).toLowerCase()
      if (ARCHIVE_EXTENSIONS.has(extension)) {
        archives.push({ platform, archivePath: path.join(platformDir, entry.name) })
      }
    }
  }
  return archives
}

async function processArchive(
  base: string,
  archive: CatalogArchiveInput,
  assets: GeneratedCatalogAsset[],
  downloads: GeneratedDownloadAsset[],
): Promise<CursorPackage> {
  const archiveStats = await stat(archive.archivePath)
  const archiveName = path.basename(archive.archivePath)
  const archiveStem = archiveName.slice(0, -path.extname(archiveName).length)
  const id = `${archive.platform}-${shortHash(`${archive.platform}/${archiveName}`)}`
  const downloadFileName = normalizePublicPath(`downloads/${archive.platform}/${archiveName}`)
  const warnings: string[] = []
  const formats = new Set<CursorFormat>()
  const parsedEntries: ParsedCursorEntry[] = []
  const downloadUrl = publicUrl(base, downloadFileName)

  downloads.push({ fileName: downloadFileName, sourcePath: archive.archivePath })

  const extractDir = await mkdtemp(path.join(tmpdir(), 'cursor-catalog-'))
  try {
    await extractArchive(archive.archivePath, extractDir)
    const extractedFiles = await listFilesRecursive(extractDir)
    for (const filePath of extractedFiles) {
      const candidateFormat = await detectExtractedCursorFormat(filePath)
      if (candidateFormat === null) {
        continue
      }
      const relativePath = normalizePath(path.relative(extractDir, filePath))
      try {
        const parsed = parseCursorBlob(await readFile(filePath))
        formats.add(parsed.format)
        parsedEntries.push({
          relativePath,
          role: classifyCursorRole(relativePath),
          parsed,
        })
      } catch (error) {
        warnings.push(`${relativePath}: ${errorMessage(error)}`)
      }
    }
  } catch (error) {
    warnings.push(`Archive extraction failed: ${errorMessage(error)}`)
  } finally {
    await rm(extractDir, { recursive: true, force: true })
  }

  const sampleFactory = createSampleFactory(base, id, assets)
  const roleMap = new Map<CursorRole, ParsedCursorEntry>()
  for (const entry of parsedEntries) {
    if (entry.role !== null && !roleMap.has(entry.role)) {
      roleMap.set(entry.role, entry)
    }
  }

  const firstEntry = parsedEntries[0]
  const previewEntry = roleMap.get('normal') ?? firstEntry
  const preview = previewEntry
    ? sampleFactory(previewEntry, previewEntry.role ?? 'preview')
    : null

  const selectedEntries = selectSampleEntries(roleMap, firstEntry)
  const samples = selectedEntries.map(({ role, entry }) => sampleFactory(entry, role)).slice(0, 8)
  if (parsedEntries.length === 0 && warnings.length === 0) {
    warnings.push('No previewable cursor files were found')
  }

  return {
    id,
    platform: archive.platform,
    name: archiveStem,
    archiveName,
    downloadUrl,
    archiveSize: archiveStats.size,
    cursorCount: parsedEntries.length,
    formats: Array.from(formats).sort(),
    preview,
    samples,
    warnings: compactWarnings(warnings),
  }
}

function createSampleFactory(
  base: string,
  archiveId: string,
  assets: GeneratedCatalogAsset[],
): (entry: ParsedCursorEntry, role: CursorRole | 'preview') => CursorSample {
  const cache = new Map<string, CursorSample>()
  return (entry, role) => {
    const cacheKey = `${entry.relativePath}:${role}`
    const cached = cache.get(cacheKey)
    if (cached) {
      return cached
    }

    const frame = entry.parsed.frames[0]
    const image = choosePreviewImage(frame.images)
    const assetFileName = `generated/cursor-previews/${archiveId}-${role}-${shortHash(entry.relativePath)}.png`
    const png = encodeCursorImagePng(image)
    assets.push({
      fileName: assetFileName,
      source: png,
      contentType: 'image/png',
    })

    const animated = entry.parsed.frames.length > 1
    const sample: CursorSample = {
      role,
      fileName: path.basename(entry.relativePath),
      imageUrl: publicUrl(base, assetFileName),
      width: image.width,
      height: image.height,
      hotspot: image.hotspot,
      animated,
      frameCount: entry.parsed.frames.length,
      delayMs: animated ? Math.round(frame.delaySeconds * 1000) : undefined,
    }
    cache.set(cacheKey, sample)
    return sample
  }
}

function selectSampleEntries(
  roleMap: Map<CursorRole, ParsedCursorEntry>,
  firstEntry: ParsedCursorEntry | undefined,
): Array<{ role: CursorRole | 'preview'; entry: ParsedCursorEntry }> {
  const selected: Array<{ role: CursorRole | 'preview'; entry: ParsedCursorEntry }> = []
  const seen = new Set<string>()
  if (firstEntry && !roleMap.has('normal')) {
    selected.push({ role: firstEntry.role ?? 'preview', entry: firstEntry })
    seen.add(firstEntry.relativePath)
  }

  for (const role of ROLE_ORDER) {
    const entry = roleMap.get(role)
    if (!entry || seen.has(entry.relativePath)) {
      continue
    }
    selected.push({ role, entry })
    seen.add(entry.relativePath)
  }
  return selected
}

async function extractArchive(archivePath: string, outputDir: string): Promise<void> {
  await runSevenZip(['x', '-y', '-bd', '-bso0', '-bsp0', `-o${outputDir}`, archivePath])
}

function runSevenZip(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sevenZipPath, args)
    let stderr = ''
    child.stdout?.resume()
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || `7-Zip exited with code ${code ?? 'unknown'}`))
    })
  })
}

async function listFilesRecursive(directory: string): Promise<string[]> {
  const files: string[] = []
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)))
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(fullPath)
    }
  }
  return files
}

async function detectExtractedCursorFormat(filePath: string): Promise<CursorFormat | null> {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.cur' || extension === '.ani') {
    return extension.slice(1) as CursorFormat
  }

  const handle = await open(filePath, 'r')
  try {
    const head = Buffer.alloc(16)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    return detectCursorFormat(head.subarray(0, bytesRead)) === 'xcursor' ? 'xcursor' : null
  } catch {
    return null
  } finally {
    await handle.close()
  }
}

function classifyCursorRole(relativePath: string): CursorRole | null {
  const normalized = normalizePath(relativePath).toLowerCase()
  for (const definition of ROLE_PATTERNS) {
    if (definition.patterns.some((pattern) => normalized.includes(pattern))) {
      return definition.role
    }
  }
  return null
}

function publicUrl(base: string, fileName: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`
  return encodeURI(`${prefix}${fileName}`)
}

function normalizePublicPath(fileName: string): string {
  return normalizePath(fileName).replace(/^\/+/, '')
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function compactWarnings(warnings: string[]): string[] {
  if (warnings.length <= 8) {
    return warnings
  }
  return [...warnings.slice(0, 7), `${warnings.length - 7} more warnings`]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
