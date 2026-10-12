<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import { COLOR_KEYS, FOLDER_COLORS, ICON_KEYS } from '@/utils/folder-icons'
import FolderIcon from '@/components/FolderIcon.vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  icon: string
  colorKey?: string | null
}>()

const emit = defineEmits<{
  change: [value: { icon: string; colorKey: string | null }]
  remove: []
  close: []
}>()

const { t } = useI18n()
const root = ref<HTMLElement>()

/** 点击弹层外部关闭 */
function onDocMousedown(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('keydown', onKey)
})

function pickColor(k: string) {
  emit('change', { icon: props.icon, colorKey: k === 'neutral' ? null : k })
}

function pickIcon(k: string) {
  emit('change', { icon: k, colorKey: props.colorKey ?? null })
}
</script>

<template>
  <div ref="root" class="picker mk-anim-pop-in" @click.stop>
    <div class="head">
      <span class="head-title">{{ t('folderIcon.title') }}</span>
      <button class="remove" @click="emit('remove')">
        <PhX :size="12" weight="bold" />
        {{ t('folderIcon.remove') }}
      </button>
    </div>

    <div class="group-label">{{ t('folderIcon.color') }}</div>
    <div class="swatches">
      <button
        v-for="k in COLOR_KEYS"
        :key="k"
        class="swatch"
        :class="{ on: (colorKey ?? 'neutral') === k }"
        :style="{ background: FOLDER_COLORS[k].bg }"
        :title="k"
        @click="pickColor(k)"
      >
        <span
          class="swatch-dot"
          :style="{ background: FOLDER_COLORS[k].text }"
        />
      </button>
    </div>

    <div class="group-label">{{ t('folderIcon.glyph') }}</div>
    <div class="icons">
      <button
        v-for="k in ICON_KEYS"
        :key="k"
        class="icon-cell"
        :class="{ on: icon === k }"
        @click="pickIcon(k)"
      >
        <FolderIcon
          :name="k"
          :color-key="icon === k ? (colorKey ?? 'neutral') : 'neutral'"
          :size="24"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.picker {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-3);
  z-index: var(--mk-z-dropdown);
  cursor: default;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--mk-space-2);
}

.head-title {
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  color: var(--mk-color-text-primary);
}

.remove {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  padding: 3px 8px;
  border-radius: var(--mk-radius-full);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.remove:hover {
  background: var(--mk-color-status-danger-bg);
  color: var(--mk-color-status-danger-text);
}

.group-label {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
  margin: var(--mk-space-2) 0 var(--mk-space-1);
}

.swatches {
  display: flex;
  gap: var(--mk-space-1);
}

.swatch {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: 1px solid var(--mk-color-border-default);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--mk-dur-fast) var(--mk-ease-out);
}

.swatch:hover {
  transform: scale(1.08);
}

.swatch-dot {
  width: 0;
  height: 0;
  border-radius: var(--mk-radius-full);
  transition: width var(--mk-dur-fast) var(--mk-ease-out),
    height var(--mk-dur-fast) var(--mk-ease-out);
}

.swatch.on {
  outline: 2px solid var(--mk-color-accent);
  outline-offset: 1.5px;
}

.swatch.on .swatch-dot {
  width: 8px;
  height: 8px;
}

.icons {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: var(--mk-space-1);
}

.icon-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border-radius: var(--mk-radius-sm);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}

.icon-cell:hover {
  background: var(--mk-color-bg-subtle);
}

.icon-cell.on {
  background: var(--mk-color-bg-subtle);
  outline: 1.5px solid var(--mk-color-accent);
  outline-offset: 0;
}
</style>
