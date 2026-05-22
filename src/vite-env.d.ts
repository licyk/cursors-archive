/// <reference types="vite/client" />

declare module 'virtual:cursor-catalog' {
  type CursorPackage = import('@/types/cursor').CursorPackage
  export const cursorCatalog: CursorPackage[]
  const catalog: CursorPackage[]
  export default catalog
}
