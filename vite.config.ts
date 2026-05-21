import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cursorCatalogPlugin } from './build/cursorCatalogPlugin'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  cacheDir: 'node_modules/.vite',
  plugins: [cursorCatalogPlugin(), vue()],
})
