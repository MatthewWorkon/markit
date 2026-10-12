<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { PhX } from '@phosphor-icons/vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  open: boolean
  title: string
  width?: number
}>()

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close')
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="overlay" @click.self="emit('close')">
        <div class="modal mk-anim-pop-in" :style="{ maxWidth: (width ?? 520) + 'px' }" role="dialog" :aria-label="title">
          <header class="modal-head">
            <h2 class="modal-title">{{ title }}</h2>
            <button class="close" :title="t('common.close')" @click="emit('close')">
              <PhX :size="17" />
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.foot" class="modal-foot">
            <slot name="foot" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--mk-color-bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--mk-space-5);
  z-index: var(--mk-z-modal);
}

.modal {
  width: 100%;
  max-height: min(84dvh, 760px);
  display: flex;
  flex-direction: column;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-lg);
  box-shadow: var(--mk-shadow-modal);
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--mk-space-4) var(--mk-space-6);
  border-bottom: 1px solid var(--mk-color-border-default);
  flex-shrink: 0;
}

.modal-title {
  font-size: var(--mk-font-size-xl);
  font-weight: 600;
  letter-spacing: -0.015em;
}

.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.close:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--mk-space-6);
}

.modal-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--mk-space-2);
  padding: var(--mk-space-4) var(--mk-space-6);
  border-top: 1px solid var(--mk-color-border-default);
  flex-shrink: 0;
}

/* 遮罩淡入淡出；内容交给 mk-anim-pop-in */
.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--mk-dur) var(--mk-ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .overlay {
    padding: 0;
    align-items: flex-end;
  }

  .modal {
    max-height: 92dvh;
    border-radius: var(--mk-radius-lg) var(--mk-radius-lg) 0 0;
  }
}
</style>
