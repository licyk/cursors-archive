import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { cursorCatalogPlugin } from './build/cursorCatalogPlugin'

function normalizeBasePath(value: string | undefined): string {
  if (!value) {
    return './'
  }

  if (value === '.' || value === './') {
    return './'
  }

  if (value === '/') {
    return value
  }

  if (/^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(value)) {
    return value.endsWith('/') ? value : `${value}/`
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

  return {
    base: normalizeBasePath(env.VITE_BASE_PATH),
    cacheDir: 'node_modules/.vite',
    plugins: [cursorCatalogPlugin(), vue()],
  }
})
