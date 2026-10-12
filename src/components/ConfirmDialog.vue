<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useI18n } from 'vue-i18n'

const ui = useUiStore()
const { t } = useI18n()

const typed = ref('')

watch(
  () => ui.confirmState,
  () => {
    typed.value = ''
  },
)

const needText = computed(() => Boolean(ui.confirmState?.requireText))
const canConfirm = computed(() => !needText.value || typed.value.trim() === ui.confirmState?.requireText)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.confirmState) ui.resolveConfirm(false)
}
onMounted(() => document.addEventListener('keydown', onKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="ui.confirmState"
        class="overlay"
        @click.self="ui.resolveConfirm(false)"
      >
        <div class="dialog mk-anim-pop-in" role="alertdialog" :aria-label="ui.confirmState.title">
          <h3 class="title">{{ ui.confirmState.title }}</h3>
          <p class="message">{{ ui.confirmState.message }}</p>
          <div v-if="needText" class="require-text">
            <label class="mk-label" for="confirm-typed">
              {{ t('confirm.typeHint', { text: ui.confirmState.requireText }) }}
            </label>
            <input
              id="confirm-typed"
              v-model="typed"
              class="mk-input"
              type="text"
              autocomplete="off"
              @keyup.enter="canConfirm && ui.resolveConfirm(true)"
            />
          </div>
          <div class="actions">
            <button class="mk-btn-ghost" @click="ui.resolveConfirm(false)">
              {{ t('common.cancel') }}
            </button>
            <button class="mk-btn-danger" :disabled="!canConfirm" @click="ui.resolveConfirm(true)">
              {{ ui.confirmState.confirmText ?? t('common.confirm') }}
            </button>
          </div>
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
  z-index: calc(var(--mk-z-modal) + 50); /* 盖在设置等弹窗之上 */
}

.dialog {
  width: 100%;
  max-width: 400px;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-lg);
  box-shadow: var(--mk-shadow-modal);
  padding: var(--mk-space-6);
}

.title {
  font-size: var(--mk-font-size-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
}

.message {
  margin-top: var(--mk-space-2);
  font-size: var(--mk-font-size-md);
  line-height: 1.65;
  color: var(--mk-color-text-secondary);
  overflow-wrap: anywhere;
}

.require-text {
  margin-top: var(--mk-space-4);
}

.require-text .mk-input {
  height: 38px;
}

.actions {
  margin-top: var(--mk-space-5);
  display: flex;
  justify-content: flex-end;
  gap: var(--mk-space-2);
}

.mk-btn-danger:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity var(--mk-dur) var(--mk-ease-out);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
