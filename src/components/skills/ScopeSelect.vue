<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhBriefcase, PhCaretDown, PhCheck, PhGlobe } from '@phosphor-icons/vue'
import { useI18n } from 'vue-i18n'

/**
 * 范围选择（全局 / 项目级）：项目统一样式下拉（同分组 combobox 视觉，v0.4.5）。
 * 替代浏览器原生 select。
 */
const props = defineProps<{
  modelValue: 'global' | 'project'
  /** 项目模式下展示的项目名（可选项副文本） */
  projectName?: string
}>()

const emit = defineEmits<{ update: [value: 'global' | 'project'] }>()

const { t } = useI18n()
const open = ref(false)

const options = computed(() => [
  { key: 'global' as const, label: t('skills.global'), icon: PhGlobe },
  { key: 'project' as const, label: t('skills.project'), icon: PhBriefcase },
])

const current = computed(() => options.value.find((o) => o.key === props.modelValue)!)

function pick(key: 'global' | 'project') {
  emit('update', key)
  open.value = false
}
</script>

<template>
  <div v-click-outside="() => (open = false)" class="scope-select" :class="{ open }">
    <button type="button" class="scope-trigger" @click="open = !open">
      <component :is="current.icon" :size="15" class="scope-icon" />
      <span class="scope-name">{{ current.label }}</span>
      <span v-if="modelValue === 'project' && projectName" class="scope-sub mk-mono mk-clamp-1">{{ projectName }}</span>
      <PhCaretDown :size="13" class="caret" :class="{ up: open }" />
    </button>

    <Transition name="menu">
      <div v-if="open" class="scope-menu">
        <button
          v-for="opt in options"
          :key="opt.key"
          type="button"
          class="scope-option"
          :class="{ on: modelValue === opt.key }"
          @click="pick(opt.key)"
        >
          <component :is="opt.icon" :size="18" class="opt-ico" />
          <span class="opt-label">{{ opt.label }}</span>
          <PhCheck v-if="modelValue === opt.key" :size="14" weight="bold" class="opt-check" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.scope-select { position: relative; }
.scope-trigger {
  display: flex; align-items: center; gap: var(--mk-space-2);
  width: 100%; min-height: 40px; padding: var(--mk-space-1) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out),
    box-shadow var(--mk-dur-fast) var(--mk-ease-out);
}
.scope-select.open .scope-trigger,
.scope-trigger:focus-visible { border-color: var(--mk-color-accent); box-shadow: var(--mk-shadow-focus); }
.scope-icon { color: var(--mk-color-text-faint); flex-shrink: 0; }
.scope-name { flex-shrink: 0; font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary); }
.scope-sub {
  flex: 1; min-width: 0; text-align: left;
  font-size: var(--mk-font-size-sm); color: var(--mk-color-text-faint);
}
.caret { color: var(--mk-color-text-faint); flex-shrink: 0; transition: transform var(--mk-dur-fast) var(--mk-ease-out); }
.caret.up { transform: rotate(180deg); }

.scope-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1);
  z-index: var(--mk-z-dropdown);
}
.scope-option {
  display: flex; align-items: center; gap: var(--mk-space-2);
  width: 100%; padding: 8px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.scope-option:hover { background: var(--mk-color-bg-subtle); }
.opt-ico { color: var(--mk-color-text-muted); flex-shrink: 0; }
.scope-option.on .opt-ico { color: var(--mk-color-accent-soft-text); }
.opt-label { flex: 1; text-align: left; }
.opt-check { color: var(--mk-color-accent); flex-shrink: 0; }

.menu-enter-active, .menu-leave-active { transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(4px); }
</style>
