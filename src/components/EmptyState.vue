<script setup lang="ts">
import { PhBookmarkSimple, PhTrash } from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useI18n } from 'vue-i18n'

const data = useDataStore()
const { t } = useI18n()

function props() {
  return {
    isTrash: data.currentView.kind === 'trash',
    isSearch: Boolean(data.searchQuery.trim()),
  }
}
</script>

<template>
  <div class="empty mk-anim-fade-up">
    <div class="glyph">
      <PhTrash v-if="props().isTrash" :size="26" weight="thin" />
      <PhBookmarkSimple v-else :size="26" weight="thin" />
    </div>
    <h3 class="empty-title">
      {{ props().isSearch ? t('search.noResult') : props().isTrash ? t('empty.trashEmpty') : t('empty.noBookmarks') }}
    </h3>
    <p class="empty-sub">
      {{ props().isSearch ? t('search.noResultSub') : props().isTrash ? t('empty.trashEmptySub') : t('empty.noBookmarksSub') }}
    </p>
  </div>
</template>

<style scoped>
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--mk-space-8) var(--mk-space-6);
  text-align: center;
}

.glyph {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--mk-space-4);
  border-radius: var(--mk-radius-full);
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-muted);
}

.empty-title {
  font-size: var(--mk-font-size-xl);
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--mk-color-text-primary);
}

.empty-sub {
  margin-top: var(--mk-space-1);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-muted);
  max-width: 360px;
}
</style>
