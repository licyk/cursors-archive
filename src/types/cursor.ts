export type CursorPlatform = 'windows' | 'linux'

export type CursorFormat = 'cur' | 'ani' | 'xcursor'

export interface CursorPackage {
  id: string
  platform: CursorPlatform
  name: string
  archiveName: string
  downloadUrl: string
  archiveSize: number
  cursorCount: number
  formats: CursorFormat[]
  preview: CursorSample | null
  samples: CursorSample[]
  warnings: string[]
}

export interface CursorSample {
  role: string
  fileName: string
  imageUrl: string
  width: number
  height: number
  hotspot: { x: number; y: number }
  animated: boolean
  frameCount: number
  delayMs?: number
}
