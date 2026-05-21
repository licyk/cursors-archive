import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cursorCatalogPlugin } from './build/cursorCatalogPlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [cursorCatalogPlugin(), vue()],
})
