<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ImageOff } from 'lucide-vue-next'

const props = withDefaults(
  defineProps<{
    src: string
    alt: string
    width: number
    height: number
    variant?: 'preview' | 'sample'
  }>(),
  {
    variant: 'preview',
  },
)

const host = ref<HTMLElement | null>(null)
const shouldLoad = ref(false)
const isLoaded = ref(false)
const hasError = ref(false)

let observer: IntersectionObserver | null = null

const aspectStyle = computed(() => ({
  '--lazy-aspect': `${Math.max(props.width, 1)} / ${Math.max(props.height, 1)}`,
}))

const preloadRootMargin = computed(() =>
  props.variant === 'preview' ? '720px 0px' : '520px 0px',
)

function disconnectObserver(): void {
  observer?.disconnect()
  observer = null
}

function startLoading(): void {
  shouldLoad.value = true
  disconnectObserver()
}

function observeImage(): void {
  disconnectObserver()

  if (!host.value) {
    return
  }

  if (!('IntersectionObserver' in window)) {
    startLoading()
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        startLoading()
      }
    },
    {
      rootMargin: preloadRootMargin.value,
      threshold: 0.01,
    },
  )
  observer.observe(host.value)
}

function resetImage(): void {
  shouldLoad.value = false
  isLoaded.value = false
  hasError.value = false

  if (typeof window === 'undefined') {
    shouldLoad.value = true
    return
  }

  void nextTick(observeImage)
}

onMounted(resetImage)
onBeforeUnmount(disconnectObserver)

watch(() => props.src, resetImage)
</script>

<template>
  <span
    ref="host"
    class="lazy-image"
    :class="[
      `lazy-image-${variant}`,
      {
        'is-loading': shouldLoad && !isLoaded && !hasError,
        'is-loaded': isLoaded,
        'has-error': hasError,
      },
    ]"
    :style="aspectStyle"
  >
    <span v-if="!isLoaded && !hasError" class="lazy-placeholder" aria-hidden="true" />
    <span v-if="hasError" class="lazy-error" aria-hidden="true">
      <ImageOff :size="variant === 'preview' ? 28 : 18" />
    </span>
    <img
      v-if="shouldLoad && !hasError"
      :src="src"
      :width="width"
      :height="height"
      :alt="alt"
      loading="lazy"
      decoding="async"
      @load="isLoaded = true"
      @error="hasError = true"
    />
  </span>
</template>
