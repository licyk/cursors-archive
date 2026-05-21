<script setup lang="ts">
import type { CursorPlatform } from '../types/cursor'

withDefaults(
  defineProps<{
    platform: CursorPlatform
    size?: number
  }>(),
  {
    size: 18,
  },
)
</script>

<template>
  <svg
    v-if="platform === 'windows'"
    class="platform-logo platform-logo-windows"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    role="img"
    aria-label="Windows"
  >
    <path d="M3 4.4 10.7 3v8H3V4.4Z" />
    <path d="M12 2.8 21 1.2V11h-9V2.8Z" />
    <path d="M3 12.3h7.7v8L3 19v-6.7Z" />
    <path d="M12 12.3h9v10.5l-9-1.6v-8.9Z" />
  </svg>

  <svg
    v-else
    class="platform-logo platform-logo-linux"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    role="img"
    aria-label="Linux"
  >
    <ellipse cx="12" cy="11.8" rx="5.8" ry="7.8" class="tux-body" />
    <ellipse cx="12" cy="13.7" rx="4.1" ry="5.5" class="tux-belly" />
    <circle cx="9.8" cy="7.6" r="0.8" class="tux-eye" />
    <circle cx="14.2" cy="7.6" r="0.8" class="tux-eye" />
    <path d="M10.5 9.2h3L12 10.9l-1.5-1.7Z" class="tux-beak" />
    <path d="M6.7 19.4c1.5-1.1 3.6-0.8 4.7 0.5-1.8 1.2-4.2 1.3-5.4 0.9-0.3-0.1 0-0.9 0.7-1.4Z" class="tux-foot" />
    <path d="M17.3 19.4c-1.5-1.1-3.6-0.8-4.7 0.5 1.8 1.2 4.2 1.3 5.4 0.9 0.3-0.1 0-0.9-0.7-1.4Z" class="tux-foot" />
  </svg>
</template>
