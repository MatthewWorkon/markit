<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  PhMagnifyingGlass,
  PhPlus,
  PhList,
  PhX,
  PhCheckSquare,
  PhXCircle,
  PhSquaresFour,
  PhCaretDown,
  PhArrowDown,
  PhArrowUp,
  PhClock,
  PhHandGrabbing,
} from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { useI18n } from 'vue-i18n'

const data = useDataStore()
const ui = useUiStore()
const { t } = useI18n()

const searchEl = ref<HTMLInputElement>()
const mobileSearchOpen = ref(false)

/** 「/」快捷键聚焦搜索（输入态除外） */
function onKeydown(e: KeyboardEvent) {
  if (
    e.key === '/' &&
    !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName ?? '')
  ) {
    e.preventDefault()
    mobileSearchOpen.value = true
    requestAnimationFrame(() => searchEl.value?.focus())
  }
  if (e.key === 'Escape' && document.activeElement === searchEl.value) {
    data.searchQuery = ''
    searchEl.value?.blur()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

/** 当前视图标题 */
const viewTitle = computed(() => {
  const v = data.currentView
  switch (v.kind) {
    case 'all': return t('view.all')
    case 'recent': return t('view.recent')
    case 'favorite': return t('view.favorite')
    case 'uncategorized': return t('view.uncategorized')
    case 'ext': return t('view.ext')
    case 'folder':
      return (data.folders.find((f) => f.id === v.folderId)?.name ?? t('view.folder'))
    case 'tag': return `# ${data.tags.find((x) => x.id === v.tagId)?.name ?? ''}`
    case 'vpn': return t('view.vpn')
    case 'trash': return t('view.trash')
  }
})

const viewHint = computed(() => {
  const v = data.currentView
  if (v.kind === 'recent') return t('view.recentHint', { n: data.recentDays })
  if (v.kind === 'trash') return t('view.trashHint')
  return ''
})

/** 排序下拉（与设置→布局 同步，localStorage 持久化由 store 管理） */
const sortOptions = [
  { key: 'newest', label: t('settings.sortNewest'), icon: PhClock },
  { key: 'oldest', label: t('settings.sortOldest'), icon: PhArrowUp },
  { key: 'visits', label: t('settings.sortVisits'), icon: PhArrowDown },
  { key: 'manual', label: t('settings.sortManual'), icon: PhHandGrabbing },
] as const
const sortMenuOpen = ref(false)

/** 批量管理（BK-107 方案 A）：顶栏显式入口 */
const allSelected = computed(
  () =>
    data.visibleBookmarks.length > 0 &&
    data.visibleBookmarks.every((b) => ui.batchIds.has(b.id)),
)

function toggleSelectAll() {
  const next = new Set(ui.batchIds)
  if (allSelected.value) {
    for (const b of data.visibleBookmarks) next.delete(b.id)
  } else {
    for (const b of data.visibleBookmarks) next.add(b.id)
  }
  ui.batchIds = next
}

/** Esc 退出批量模式 */
function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.batchMode) ui.exitBatch()
}
onMounted(() => window.addEventListener('keydown', onEsc))
onUnmounted(() => window.removeEventListener('keydown', onEsc))
</script>

<template>
  <header class="topbar">
    <div class="left">
      <button class="hamburger" :title="t('nav.folders')" @click="ui.mobileSidebarOpen = true">
        <PhList :size="20" />
      </button>
      <div class="title-wrap">
        <h1 class="title">{{ viewTitle }}</h1>
        <span class="count mk-mono">{{ data.visibleBookmarks.length }}</span>
        <span v-if="viewHint" class="hint">{{ viewHint }}</span>
      </div>
    </div>

    <div class="right">
      <div class="search" :class="{ expanded: mobileSearchOpen || data.searchQuery }">
        <PhMagnifyingGlass :size="15" class="search-icon" />
        <input
          ref="searchEl"
          v-model="data.searchQuery"
          type="text"
          class="search-input"
          :placeholder="t('search.placeholder')"
          spellcheck="false"
        />
        <span class="kbd mk-mono">/</span>
        <button v-if="mobileSearchOpen" class="search-close" @click="mobileSearchOpen = false; data.searchQuery = ''">
          <PhX :size="16" />
        </button>
      </div>

      <!-- 视图切换（卡片/列表） -->
      <div class="view-toggle" v-if="!ui.batchMode">
        <button
          class="vt-btn"
          :class="{ on: ui.viewMode === 'grid' }"
          :title="t('layout.gridView')"
          @click="ui.setViewMode('grid')"
        >
          <PhSquaresFour :size="15" />
        </button>
        <button
          class="vt-btn"
          :class="{ on: ui.viewMode === 'list' }"
          :title="t('layout.listView')"
          @click="ui.setViewMode('list')"
        >
          <PhList :size="15" />
        </button>
      </div>

      <!-- 排序下拉 -->
      <div v-if="!ui.batchMode" v-click-outside="() => (sortMenuOpen = false)" class="sort-dd">
        <button class="sort-trigger" @click="sortMenuOpen = !sortMenuOpen">
          <component :is="sortOptions.find(o => o.key === data.sortMode)?.icon" :size="14" />
          <span class="sort-label">{{ sortOptions.find(o => o.key === data.sortMode)?.label }}</span>
          <PhCaretDown :size="11" class="sort-caret" :class="{ up: sortMenuOpen }" />
        </button>
        <Transition name="menu">
          <div v-if="sortMenuOpen" class="sort-menu">
            <button
              v-for="opt in sortOptions"
              :key="opt.key"
              class="sort-option"
              :class="{ on: data.sortMode === opt.key }"
              @click="data.setSortMode(opt.key); sortMenuOpen = false"
            >
              <component :is="opt.icon" :size="14" />
              {{ opt.label }}
              <PhCheckSquare v-if="data.sortMode === opt.key" :size="13" class="sort-check" />
            </button>
          </div>
        </Transition>
      </div>


      <button
        v-if="!ui.batchMode"
        class="manage-btn mk-btn-secondary"
        :title="t('batch.enter')"
        @click="ui.enterBatch()"
      >
        <PhCheckSquare :size="15" />
        <span class="manage-label">{{ t('batch.manage') }}</span>
      </button>
      <template v-else>
        <button class="manage-btn mk-btn-secondary" @click="toggleSelectAll">
          <PhCheckSquare :size="15" />
          {{ allSelected ? t('batch.unselectAll') : t('batch.selectAll') }}
        </button>
        <button class="manage-btn mk-btn-ghost" :title="t('batch.exit')" @click="ui.exitBatch()">
          <PhXCircle :size="15" />
          <span class="manage-label">{{ t('batch.exit') }}</span>
        </button>
      </template>

      <button v-if="!ui.batchMode" class="add-btn mk-btn-primary" @click="ui.addModalOpen = true">
        <PhPlus :size="16" weight="bold" />
        <span class="add-label">{{ t('nav.addBookmark') }}</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-4);
  flex-shrink: 0; /* 防被内容压缩（BUG-009） */
  height: var(--mk-topbar-height);
  padding: 0 var(--mk-space-6);
  border-bottom: 1px solid var(--mk-color-border-default);
  background: var(--mk-color-bg-topbar);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  position: sticky;
  top: 0;
  z-index: 100;
}

.left {
  display: flex;
  align-items: center;
  gap: var(--mk-space-3);
  min-width: 0;
}

.hamburger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-secondary);
}

.title-wrap {
  display: flex;
  align-items: baseline;
  gap: var(--mk-space-3);
  min-width: 0;
}

.title {
  font-size: var(--mk-font-size-xl);
  font-weight: 600;
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.count {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.hint {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.right {
  display: flex;
  align-items: center;
  gap: var(--mk-space-3);
  flex-shrink: 0;
}

.search {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  width: 300px;
  height: 38px;
  padding: 0 var(--mk-space-3) 0 var(--mk-space-4);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out),
    box-shadow var(--mk-dur-fast) var(--mk-ease-out), width var(--mk-dur) var(--mk-ease-out);
}

.search:focus-within {
  border-color: var(--mk-color-accent);
  box-shadow: var(--mk-shadow-focus);
  width: 360px;
}

.search-icon {
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-primary);
}

.search-input::placeholder {
  color: var(--mk-color-text-faint);
}

.kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-muted);
  background: var(--mk-color-bg-subtle);
  border: 1px solid var(--mk-color-border-default);
  border-radius: 5px;
  flex-shrink: 0;
}

.search:focus-within .kbd {
  display: none;
}

.search-close {
  display: none;
}

.add-btn {
  height: 38px;
}

.view-toggle {
  display: inline-flex;
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  padding: 2px;
  gap: 1px;
  flex-shrink: 0;
}

.vt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.vt-btn:hover {
  color: var(--mk-color-text-primary);
}

.vt-btn.on {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

/* 排序下拉 */
.sort-dd {
  position: relative;
  flex-shrink: 0;
}

.sort-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 36px;
  padding: 0 var(--mk-space-3);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-secondary);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.sort-trigger:hover {
  border-color: var(--mk-color-border-strong);
  color: var(--mk-color-text-primary);
}

.sort-caret {
  transition: transform var(--mk-dur-fast) var(--mk-ease-out);
  color: var(--mk-color-text-faint);
}

.sort-caret.up {
  transform: rotate(180deg);
}

.sort-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 140px;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1);
  z-index: var(--mk-z-dropdown);
}

.sort-option {
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

.sort-option:hover {
  background: var(--mk-color-bg-subtle);
}

.sort-option.on {
  font-weight: 500;
}

.sort-check {
  margin-left: auto;
  color: var(--mk-color-accent);
}

.manage-btn {
  height: 38px;
  flex-shrink: 0;
}

/* 移动端 */
@media (max-width: 768px) {
  .topbar {
    padding: 0 var(--mk-space-4);
  }

  .hamburger {
    display: inline-flex;
  }

  .hint {
    display: none;
  }

  .search {
    width: 38px;
    height: 38px;
    padding: 0;
    justify-content: center;
    cursor: pointer;
  }

  .search.expanded {
    flex: 1;
    width: auto;
    padding: 0 var(--mk-space-3) 0 var(--mk-space-4);
    justify-content: flex-start;
  }

  .search-input,
  .search:focus-within .kbd {
    display: none;
  }

  .search.expanded .search-input {
    display: block;
  }

  .search.expanded .kbd {
    display: none;
  }

  .search-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--mk-radius-full);
    color: var(--mk-color-text-muted);
    flex-shrink: 0;
  }

  .search:not(.expanded) .search-close {
    display: none;
  }

  .add-label,
  .manage-label {
    display: none;
  }

  .add-btn,
  .manage-btn {
    height: 38px;
    padding: 0 var(--mk-space-3);
  }
}
</style>
