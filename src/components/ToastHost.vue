<script setup lang="ts">
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <Teleport to="body">
    <div class="toast-host">
      <TransitionGroup name="toast">
        <div v-for="t in ui.toasts" :key="t.id" class="toast">
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-host {
  position: fixed;
  bottom: var(--mk-space-6);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--mk-space-2);
  z-index: var(--mk-z-toast);
  pointer-events: none;
}

.toast {
  padding: var(--mk-space-2) var(--mk-space-5);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-primary);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  box-shadow: var(--mk-shadow-popover);
}

.toast-enter-active {
  transition: all var(--mk-dur) var(--mk-ease-spring);
}

.toast-leave-active {
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}
</style>
