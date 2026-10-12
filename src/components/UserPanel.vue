<script setup lang="ts">
import { computed, ref } from 'vue'
import { PhDotsThree, PhGearSix, PhSignOut } from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { useI18n } from 'vue-i18n'

/**
 * 侧栏底部用户板块（书签/Skills 双模式共用，v0.4.1）：
 * 头像 + 昵称 + @用户名，点击弹出 设置 / 退出登录。
 */
const data = useDataStore()
const ui = useUiStore()
const { t } = useI18n()

const menuOpen = ref(false)
const initial = computed(() => (data.user.nickname || data.user.username || '?').slice(0, 1).toUpperCase())

async function logout() {
  menuOpen.value = false
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'x-requested-with': 'fetch' },
      credentials: 'same-origin',
    })
  } catch { /* 即便失败也回登录页 */ }
  sessionStorage.removeItem('markit.auth')
  location.hash = '#/login'
}
</script>

<template>
  <div v-click-outside="() => (menuOpen = false)" class="user-chip-wrap">
    <button class="user-chip" @click="menuOpen = !menuOpen">
      <span class="avatar">{{ initial }}</span>
      <span class="user-meta">
        <span class="user-nickname">{{ data.user.nickname }}</span>
        <span class="user-username mk-mono">@{{ data.user.username }}</span>
      </span>
      <PhDotsThree :size="16" class="user-more" />
    </button>

    <Transition name="menu">
      <div v-if="menuOpen" class="user-menu" role="menu">
        <button class="menu-item" @click="menuOpen = false; ui.settingsOpen = true">
          <PhGearSix :size="15" weight="regular" />
          {{ t('settings.title') }}
        </button>
        <button class="menu-item danger" @click="logout">
          <PhSignOut :size="15" weight="regular" />
          {{ t('settings.logout') }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.user-chip-wrap {
  position: relative;
}

.user-chip {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  width: 100%;
  padding: var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}

.user-chip:hover {
  background: var(--mk-color-bg-subtle);
}

.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--mk-radius-full);
  background: var(--mk-tag-1-bg);
  color: var(--mk-tag-1-text);
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.user-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  line-height: 1.3;
  min-width: 0;
}

.user-nickname {
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  color: var(--mk-color-text-primary);
}

.user-username {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-muted);
}

.user-more {
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.user-menu {
  position: absolute;
  bottom: calc(100% + var(--mk-space-2));
  left: 0;
  right: 0;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1);
  z-index: var(--mk-z-dropdown);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  width: 100%;
  padding: 8px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-primary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}

.menu-item:hover {
  background: var(--mk-color-bg-subtle);
}

.menu-item.danger {
  color: var(--mk-color-status-danger-text);
}

.menu-item.danger:hover {
  background: var(--mk-color-status-danger-bg);
}

.menu-enter-active,
.menu-leave-active {
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
