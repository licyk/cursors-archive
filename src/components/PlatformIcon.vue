<script setup lang="ts">
import { Icon } from '@iconify/vue'
import linuxIcon from '@iconify-icons/simple-icons/linux'
import windowsIcon from '@iconify-icons/simple-icons/windows'
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

const platformIcons = {
  windows: windowsIcon,
  linux: linuxIcon,
} satisfies Record<CursorPlatform, typeof windowsIcon>
</script>

<template>
  <Icon
    :icon="platformIcons[platform]"
    :width="size"
    :height="size"
    :class="['platform-logo', `platform-logo-${platform}`]"
    role="img"
    :aria-label="platform === 'windows' ? 'Windows' : 'Linux'"
  />
</template>
