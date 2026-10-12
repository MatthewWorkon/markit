<script setup lang="ts">
import { computed, ref } from 'vue'
import draggable from 'vuedraggable'
import type { Bookmark } from '@/types'
import {
  PhCaretUp,
  PhClock,
  PhDotsNine,
  PhFolderOpen,
  PhGlobe,
  PhGridFour,
  PhPlus,
  PhPuzzlePiece,
  PhStar,
  PhTrash,
  PhX,
} from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import FaviconTile from '@/components/FaviconTile.vue'
import BrandMark from '@/components/BrandMark.vue'
import FolderTree from '@/components/FolderTree.vue'
import UserPanel from '@/components/UserPanel.vue'
import { useI18n } from 'vue-i18n'

const data = useDataStore()
const ui = useUiStore()
const { t } = useI18n()

/** 当前选中态判定 */
function isView(kind: string, id?: number) {
  const v = data.currentView
  if (v.kind !== kind) return false
  if (kind === 'folder') return v.kind === 'folder' && v.folderId === id
  return true
}

const recentCount = computed(() => {
  const cutoff = Date.now() - data.recentDays * 86400_000
  return data.bookmarks.filter(
    (b) => !b.deleted && new Date(b.createdAt).getTime() >= cutoff,
  ).length
})

const extCount = computed(
  () => data.bookmarks.filter((b) => !b.deleted && b.source === 'ext').length,
)

const favoriteCount = computed(
  () => data.bookmarks.filter((b) => !b.deleted && b.favorite).length,
)

const vpnCount = computed(
  () => data.bookmarks.filter((b) => !b.deleted && b.needVpn).length,
)

const trashCount = computed(() => data.bookmarks.filter((b) => b.deleted).length)

/** Pin 宫格：默认前 8 个（优先级 = 最近固定优先，BK-109 拖拽排序落地后换 sort_order） */
const pinExpanded = ref(false)
/** 宫格拖拽排序：v-model 顺序变化时持久化 pin_order */
const pinList = computed<Bookmark[]>({
  get: () => (pinExpanded.value ? data.pinned : data.pinned.slice(0, 8)),
  set: (ordered: Bookmark[]) => {
    if (ordered.length === data.pinned.length) {
      data.reorderPins(ordered.map((b) => b.id))
    } else {
      // 收起态只展示前 8 个：拖拽发生在子集内，映射回全量列表
      const rest = data.pinned.slice(8)
      data.reorderPins([...ordered.map((b) => b.id), ...rest.map((b) => b.id)])
    }
  },
})
</script>

<template>
  <aside class="sidebar">
    <!-- 品牌 -->
    <div class="brand">
      <BrandMark :size="26" />
      <span class="brand-name">Markit</span>
      <div class="mode-toggle">
        <button class="mt-btn on" title="书签收藏">{{ t('nav.modeSite') }}</button>
        <button class="mt-btn" title="Skills 管理" @click="$router.push('/skills')">{{ t('nav.modeSkill') }}</button>
      </div>
    </div>

    <nav class="scroll">
      <!-- 已固定（Pin 启动器区）：App 宫格，默认 8 个，展开/收起在标题行右侧 -->
      <section v-if="data.pinned.length" class="section">
        <div class="section-label">
          <span class="label-with-count">
            {{ t('nav.pinned') }}
            <span class="mk-mono label-count">{{ data.pinned.length }}</span>
          </span>
          <button
            v-if="data.pinned.length > 8"
            class="icon-btn"
            :title="pinExpanded ? t('nav.collapsePinned') : t('nav.expandPinned')"
            :aria-label="pinExpanded ? t('nav.collapsePinned') : t('nav.expandPinned')"
            @click="pinExpanded = !pinExpanded"
          >
            <PhCaretUp v-if="pinExpanded" :size="13" weight="bold" />
            <PhDotsNine v-else :size="13" weight="regular" />
          </button>
        </div>
        <draggable
          v-model="pinList"
          item-key="id"
          tag="div"
          class="pin-grid"
          :animation="150"
        >
          <template #item="{ element }">
            <a
              :href="element.url"
              target="_blank"
              rel="noopener"
              class="pin-tile"
              :title="element.title"
            >
              <FaviconTile :src="element.favicon" :title="element.title" :size="30" :radius="8" />
              <span class="pin-tile-name">{{ element.title }}</span>
            </a>
          </template>
        </draggable>
      </section>

      <!-- 快捷视图 -->
      <section class="section">
        <div class="section-label">{{ t('nav.allBookmarks') }}</div>
        <button
          class="nav-item"
          :class="{ active: isView('all') }"
          @click="data.currentView = { kind: 'all' }"
        >
          <PhGridFour :size="16" weight="regular" />
          <span class="nav-name">{{ t('view.all') }}</span>
          <span class="nav-count mk-mono">{{ data.allCount }}</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: isView('uncategorized') }"
          @click="data.currentView = { kind: 'uncategorized' }"
        >
          <PhFolderOpen :size="16" weight="regular" />
          <span class="nav-name">{{ t('view.uncategorized') }}</span>
          <span class="nav-count mk-mono">{{ data.uncategorizedCount }}</span>
        </button>
        <button
          v-if="data.extActive"
          class="nav-item ext-item"
          :class="{ active: isView('ext') }"
          @click="data.currentView = { kind: 'ext' }"
        >
          <PhPuzzlePiece :size="16" weight="regular" />
          <span class="nav-name">{{ t('view.ext') }}</span>
          <span class="nav-count mk-mono">{{ extCount }}</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: isView('recent') }"
          @click="data.currentView = { kind: 'recent' }"
        >
          <PhClock :size="16" weight="regular" />
          <span class="nav-name">{{ t('view.recent') }}</span>
          <span class="nav-count mk-mono">{{ recentCount }}</span>
        </button>
        <button
          class="nav-item"
          :class="{ active: isView('favorite') }"
          @click="data.currentView = { kind: 'favorite' }"
        >
          <PhStar :size="16" weight="regular" />
          <span class="nav-name">{{ t('view.favorite') }}</span>
          <span class="nav-count mk-mono">{{ favoriteCount }}</span>
        </button>
        <button
          v-if="vpnCount"
          class="nav-item"
          :class="{ active: isView('vpn') }"
          @click="data.currentView = { kind: 'vpn' }"
        >
          <PhGlobe :size="16" weight="regular" />
          <span class="nav-name">{{ t('nav.vpnList') }}</span>
          <span class="nav-count mk-mono">{{ vpnCount }}</span>
        </button>
      </section>

      <!-- 分类树（无限层级） -->
      <section class="section folders">
        <div class="section-label">
          {{ t('nav.folders') }}
          <button class="icon-btn" :title="t('nav.newFolder')" @click="ui.newFolderParentId = null">
            <PhPlus :size="13" weight="bold" />
          </button>
        </div>
        <FolderTree />
      </section>
    </nav>

    <!-- 底部固定区 -->
    <div class="bottom">
      <button
        class="nav-item"
        :class="{ active: isView('trash') }"
        @click="data.currentView = { kind: 'trash' }"
      >
        <PhTrash :size="16" weight="regular" />
        <span class="nav-name">{{ t('nav.trash') }}</span>
        <span v-if="trashCount" class="nav-count mk-mono">{{ trashCount }}</span>
      </button>

      <UserPanel />
    </div>

    <!-- 移动端关闭按钮 -->
    <button class="mobile-close" @click="ui.mobileSidebarOpen = false">
      <PhX :size="18" />
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--mk-sidebar-width);
  height: 100dvh;
  background: var(--mk-color-bg-sidebar);
  border-right: 1px solid var(--mk-color-border-default);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  padding: 0 var(--mk-space-5);
  height: var(--mk-topbar-height);
  flex-shrink: 0;
}

.brand-name {
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* 模式切换（书签/Skills） */
.mode-toggle {
  display: inline-flex;
  margin-left: auto;
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  padding: 2px;
  gap: 1px;
}
.mt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  height: 26px;
  border-radius: var(--mk-radius-full);
  font-size: 12px;
  font-weight: 500;
  color: var(--mk-color-text-faint);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.mt-btn:hover {
  color: var(--mk-color-text-primary);
}
.mt-btn.on {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.scroll {
  flex: 1;
  min-height: 0; /* flex 收缩保险：内容再长也只在内部滚动，底部区始终吸附视口底 */
  overflow-y: auto;
  padding: var(--mk-space-3) var(--mk-space-3) var(--mk-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-5);
}

.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--mk-space-2);
  margin-bottom: var(--mk-space-2);
  font-size: var(--mk-font-size-xs);
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-color-text-faint);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-muted);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.icon-btn:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

/* Pin 启动器宫格 */
.label-with-count {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
}

.label-count {
  font-size: 10px;
  color: var(--mk-color-text-faint);
}

/* Pin 启动器宫格：minmax(0,1fr) 保证四等分，长名称截断不撑宽轨道 */
.pin-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--mk-space-1);
  padding: 0 var(--mk-space-1);
}

.pin-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: var(--mk-space-2) 2px var(--mk-space-1);
  border-radius: var(--mk-radius-sm);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}

a.pin-tile:hover {
  background: var(--mk-color-bg-subtle);
}

.pin-tile-name {
  max-width: 100%;
  font-size: 10.5px;
  line-height: 1.3;
  color: var(--mk-color-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

a.pin-tile:hover .pin-tile-name {
  color: var(--mk-color-text-primary);
}

/* 通用导航行 */
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  width: 100%;
  padding: 7px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-secondary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.nav-item:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.nav-item.active {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
  font-weight: 500;
}

.nav-item.active svg {
  color: var(--mk-color-accent);
}

.nav-name {
  flex: 1;
  text-align: left;
  font-size: var(--mk-font-size-md);
}

.nav-count {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
}

.nav-item.active .nav-count {
  color: var(--mk-color-text-muted);
}

/* 底部 */
.bottom {
  flex-shrink: 0;
  border-top: 1px solid var(--mk-color-border-default);
  padding: var(--mk-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-2);
}


.mobile-close {
  display: none;
}

/* 移动端：由 HomePage 的 .sidebar-layer 负责抽屉定位，此处仅保留关闭按钮样式 */
@media (max-width: 768px) {
  .mobile-close {
    display: inline-flex;
    position: absolute;
    top: var(--mk-space-3);
    right: var(--mk-space-3);
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--mk-radius-full);
    color: var(--mk-color-text-muted);
    background: var(--mk-color-bg-subtle);
  }
}
</style>
