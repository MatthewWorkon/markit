<script setup lang="ts">
import { computed } from 'vue'
import { FOLDER_COLORS, FOLDER_ICONS } from '@/utils/folder-icons'

const props = withDefaults(
  defineProps<{
    name: string
    colorKey?: string | null
    size?: number
  }>(),
  { colorKey: null, size: 22 },
)

const comp = computed(() => FOLDER_ICONS[props.name] ?? FOLDER_ICONS.folder!)
const isNeutral = computed(() => (props.colorKey ?? 'neutral') === 'neutral')
const color = computed(() =>
  isNeutral.value
    ? { bg: 'transparent', text: 'currentColor' }
    : (FOLDER_COLORS[props.colorKey!] ?? FOLDER_COLORS.blue!),
)
</script>

<template>
  <span
    class="folder-icon"
    :class="{ neutral: isNeutral }"
    :style="!isNeutral && {
      width: size + 'px',
      height: size + 'px',
      background: color.bg,
      color: color.text,
    }"
    :data-neutral="isNeutral"
  >
    <component :is="comp" :size="Math.round(size * 0.55)" weight="regular" />
  </span>
</template>

<style scoped>
.folder-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  flex-shrink: 0;
  color: var(--mk-color-text-secondary);
}

/* 中性态：token 驱动（暗色自动适配），尺寸由父级 :style 控制 */
.folder-icon.neutral {
  width: auto;
  height: auto;
  padding: 3px;
  border: 1px solid var(--mk-color-border-default);
  background: var(--mk-color-bg-card);
}
</style>
