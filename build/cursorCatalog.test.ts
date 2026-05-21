import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateCursorCatalog } from './cursorCatalog'

const root = fileURLToPath(new URL('../', import.meta.url))

describe('cursorCatalog', () => {
  it('generates preview metadata from a real archive', async () => {
    const archivePath = path.join(root, 'windows', '砂狼白子.zip')

    const catalog = await generateCursorCatalog({
      root,
      base: '/',
      archives: [{ platform: 'windows', archivePath }],
    })

    const cursorPackage = catalog.packages[0]
    expect(cursorPackage.name).toBe('砂狼白子')
    expect(cursorPackage.preview).not.toBeNull()
    expect(cursorPackage.cursorCount).toBeGreaterThan(0)
    expect(cursorPackage.samples.length).toBeGreaterThan(0)
    expect(catalog.assets.length).toBeGreaterThan(0)
    expect(cursorPackage.downloadUrl).toContain('/downloads/windows/')
  }, 30_000)
})
