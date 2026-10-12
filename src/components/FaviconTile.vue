<script setup lang="ts">
import { computed, ref } from 'vue'
import { letterTileHue } from '@/utils/format'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(
  defineProps<{
    src?: string | null
    title: string
    size?: number
    radius?: number
  }>(),
  { src: null, size: 28, radius: 7 },
)

const ui = useUiStore()
const failed = ref(false)
const letter = computed(() => (props.title.trim()[0] ?? '·').toUpperCase())
const hue = computed(() =>
  letterTileHue(props.title || '·', ui.themeResolved === 'dark').split('|'),
)
const tileBg = computed(() => hue.value[0])
const tileText = computed(() => hue.value[1])
</script>

<template>
  <span
    v-if="!src || failed"
    class="tile"
    :style="{
      width: size + 'px',
      height: size + 'px',
      borderRadius: radius + 'px',
      background: tileBg,
      color: tileText,
      fontSize: Math.round(size * 0.44) + 'px',
    }"
  >
    {{ letter }}
  </span>
  <img
    v-else
    :src="src"
    :alt="title"
    :width="size"
    :height="size"
    :style="{ borderRadius: radius + 'px' }"
    loading="lazy"
    @error="failed = true"
  />
</template>

<style scoped>
.tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-weight: 600;
  font-family: var(--mk-font-family);
  user-select: none;
}

img {
  display: block;
  flex-shrink: 0;
}
</style>
