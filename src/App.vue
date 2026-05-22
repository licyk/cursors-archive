<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { Directive } from 'vue'
import { Icon } from '@iconify/vue'
import githubIcon from '@iconify-icons/simple-icons/github'
import { Archive, CircleHelp, Download, ImageOff, MousePointer2, Search } from 'lucide-vue-next'
import cursorCatalog from 'virtual:cursor-catalog'
import LazyImage from '@/components/LazyImage.vue'
import PlatformIcon from '@/components/PlatformIcon.vue'
import type { CursorPackage, CursorPlatform, CursorSample } from '@/types/cursor'

type PlatformFilter = CursorPlatform | 'all'
type RevealElement = HTMLElement & {
  __cursorRevealCleanup?: () => void
}

const query = ref('')
const activePlatform = ref<PlatformFilter>('all')
const isReady = ref(false)

const packages = cursorCatalog as CursorPackage[]
const platformFilters: Array<{ id: PlatformFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'windows', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]

const filteredPackages = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return packages.filter((cursorPackage) => {
    const matchesPlatform =
      activePlatform.value === 'all' || cursorPackage.platform === activePlatform.value
    const matchesKeyword =
      keyword.length === 0 ||
      [cursorPackage.name, cursorPackage.archiveName, cursorPackage.formats.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    return matchesPlatform && matchesKeyword
  })
})

const activePlatformIndex = computed(() =>
  platformFilters.findIndex((item) => item.id === activePlatform.value),
)

const stats = computed(() => ({
  total: packages.length,
  windows: packages.filter((cursorPackage) => cursorPackage.platform === 'windows').length,
  linux: packages.filter((cursorPackage) => cursorPackage.platform === 'linux').length,
  previewed: packages.filter((cursorPackage) => cursorPackage.preview !== null).length,
}))

function platformLabel(platform: CursorPlatform): string {
  return platform === 'windows' ? 'Windows' : 'Linux'
}

function roleLabel(role: CursorSample['role']): string {
  const labels: Record<string, string> = {
    normal: '正常',
    help: '帮助',
    busy: '忙碌',
    text: '文本',
    link: '链接',
    move: '移动',
    crosshair: '精确',
    unavailable: '不可用',
    resize: '缩放',
    preview: '预览',
  }
  return labels[role] ?? role
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatFormats(cursorPackage: CursorPackage): string {
  return cursorPackage.formats.length > 0 ? cursorPackage.formats.join(' / ') : 'unknown'
}

const vReveal: Directive<RevealElement, number | undefined> = {
  mounted(element, binding) {
    const delay = Number(binding.value ?? 0)
    element.style.setProperty('--reveal-delay', `${delay}ms`)

    if (
      typeof window === 'undefined' ||
      !('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      element.classList.add('is-visible')
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return
        }

        element.classList.add('is-visible')
        observer.disconnect()
        element.__cursorRevealCleanup = undefined
      },
      {
        rootMargin: '0px 0px -8% 0px',
        threshold: 0.1,
      },
    )

    observer.observe(element)
    element.__cursorRevealCleanup = () => observer.disconnect()
  },
  beforeUnmount(element) {
    element.__cursorRevealCleanup?.()
  },
}

onMounted(() => {
  requestAnimationFrame(() => {
    isReady.value = true
  })
})
</script>

<template>
  <main class="shell" :class="{ 'is-ready': isReady }">
    <header class="toolbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <MousePointer2 :size="22" />
        </span>
        <div>
          <h1>Cursors Archive</h1>
          <p>{{ stats.total }} packages · {{ stats.previewed }} previews</p>
        </div>
      </div>

      <div class="tools">
        <details class="usage-menu">
          <summary>
            <CircleHelp :size="17" aria-hidden="true" />
            使用说明
          </summary>
          <div class="usage-panel">
            <h2>安装方式</h2>
            <p>
              Windows 指针包解压后，右键里面的 <code>.inf</code> 文件，然后点击安装。
            </p>
            <p>
              Linux 指针包解压后，运行里面的 <code>install_currsor.sh</code> 脚本安装。
            </p>
            <p>
              这些鼠标指针也可以使用 <code>ani2xcur-cli</code> 安装和转换。
            </p>
            <a href="https://github.com/licyk/ani2xcur-cli" target="_blank" rel="noreferrer">
              <Icon :icon="githubIcon" :width="16" :height="16" class="github-logo" aria-hidden="true" />
              ani2xcur-cli
            </a>
          </div>
        </details>

        <label class="search-field">
          <Search :size="18" aria-hidden="true" />
          <span class="sr-only">搜索</span>
          <input v-model="query" type="search" placeholder="搜索名称或格式" />
        </label>

        <div class="segmented" :class="`active-${activePlatformIndex}`" aria-label="平台筛选">
          <button
            v-for="item in platformFilters"
            :key="item.id"
            type="button"
            :class="{ active: activePlatform === item.id }"
            @click="activePlatform = item.id"
          >
            <Archive v-if="item.id === 'all'" :size="16" aria-hidden="true" />
            <PlatformIcon v-else :platform="item.id" :size="16" />
            {{ item.label }}
          </button>
        </div>
      </div>
    </header>

    <section v-reveal="80" class="stats-row" aria-label="目录统计">
      <div>
        <Archive :size="18" />
        <span>{{ stats.total }} 个包</span>
      </div>
      <div>
        <PlatformIcon platform="windows" :size="18" />
        <span>{{ stats.windows }} Windows</span>
      </div>
      <div>
        <PlatformIcon platform="linux" :size="18" />
        <span>{{ stats.linux }} Linux</span>
      </div>
    </section>

    <section class="catalog-grid" aria-live="polite">
      <article
        v-for="(cursorPackage, index) in filteredPackages"
        :key="cursorPackage.id"
        v-reveal="Math.min(index, 8) * 45"
        class="cursor-card"
      >
        <div class="preview-panel">
          <LazyImage
            v-if="cursorPackage.preview"
            :src="cursorPackage.preview.imageUrl"
            :width="cursorPackage.preview.width"
            :height="cursorPackage.preview.height"
            :alt="`${cursorPackage.name} preview`"
            variant="preview"
          />
          <div v-else class="preview-empty">
            <ImageOff :size="28" />
          </div>
          <span class="platform-pill">{{ platformLabel(cursorPackage.platform) }}</span>
        </div>

        <div class="card-body">
          <div class="title-row">
            <h2>{{ cursorPackage.name }}</h2>
            <span class="archive-type">{{ cursorPackage.archiveName.split('.').pop() }}</span>
          </div>

          <div class="meta-row">
            <span>{{ formatSize(cursorPackage.archiveSize) }}</span>
            <span>{{ cursorPackage.cursorCount }} cursors</span>
            <span>{{ formatFormats(cursorPackage) }}</span>
          </div>

          <div v-if="cursorPackage.samples.length > 0" class="sample-strip">
            <figure v-for="sample in cursorPackage.samples" :key="`${cursorPackage.id}-${sample.role}-${sample.fileName}`">
              <span class="sample-image">
                <LazyImage
                  :src="sample.imageUrl"
                  :width="sample.width"
                  :height="sample.height"
                  :alt="`${cursorPackage.name} ${roleLabel(sample.role)}`"
                  variant="sample"
                />
              </span>
              <figcaption>
                {{ roleLabel(sample.role) }}
                <small v-if="sample.animated">{{ sample.frameCount }}f</small>
              </figcaption>
            </figure>
          </div>

          <p v-else-if="cursorPackage.warnings.length > 0" class="warning-text">
            {{ cursorPackage.warnings[0] }}
          </p>

          <a class="download-link" :href="cursorPackage.downloadUrl" :download="cursorPackage.archiveName">
            <Download :size="18" aria-hidden="true" />
            下载
          </a>
        </div>
      </article>
    </section>

    <section v-if="filteredPackages.length === 0" v-reveal class="empty-state">
      <ImageOff :size="32" />
      <p>没有匹配的指针包</p>
    </section>
  </main>
</template>
