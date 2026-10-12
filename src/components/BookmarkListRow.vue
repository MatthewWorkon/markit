<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  PhArrowCounterClockwise,
  PhCopy,
  PhPencilSimple,
  PhPushPin,
  PhShareNetwork,
  PhStar,
  PhTrash,
  PhCheck,
} from '@phosphor-icons/vue'
import type { Bookmark } from '@/types'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { hostOf, timeAgo } from '@/utils/format'
import FaviconTile from '@/components/FaviconTile.vue'
import TagPill from '@/components/TagPill.vue'
import { api } from '@/api'
import { useI18n } from 'vue-i18n'

/**
 * 两栏分栏列表行（v0.3.10）：
 * 上行 = 图标 + 标题 + 标签；下行 = 单行简介。点击整行打开网站。
 */
const props = defineProps<{
  bookmark: Bookmark
  index: number
  draggableView?: boolean
}>()

const data = useDataStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const menuOpen = ref(false)
const root = ref<HTMLElement>()
const selected = computed(() => ui.batchMode && ui.batchIds.has(props.bookmark.id))

const tags = computed(() =>
  props.bookmark.tagIds
    .map((id) => data.tags.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x)),
)
const time = computed(() => timeAgo(props.bookmark.createdAt, locale.value))

function onRowClick() {
  if (ui.batchMode) {
    ui.toggleBatchSelect(props.bookmark.id)
    return
  }
  if (!props.bookmark.deleted) {
    window.open(props.bookmark.url, '_blank', 'noopener')
    api.post(`/api/bookmarks/${props.bookmark.id}/visit`).catch(() => {})
  }
}

function startEdit() {
  menuOpen.value = false
  ui.editingId = props.bookmark.id
}

function startShare() {
  menuOpen.value = false
  ui.shareTarget = { bookmarkId: props.bookmark.id, title: props.bookmark.title }
}

function copyUrl() {
  navigator.clipboard?.writeText(props.bookmark.url)
  ui.toast(t('toast.copied'))
  menuOpen.value = false
}

function onDelete() {
  menuOpen.value = false
  ui.confirm({
    title: t('confirm.deleteBookmarkTitle'),
    message: t('confirm.deleteBookmark', { name: props.bookmark.title }),
    onConfirm: () => {
      data.softDelete(props.bookmark.id)
      ui.toast(t('toast.deleted'))
    },
  })
}

function onDocClick(e: MouseEvent) {
  if (menuOpen.value && root.value && !root.value.contains(e.target as Node)) {
    menuOpen.value = false
  }
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <article
    ref="root"
    class="lrow mk-stagger"
    :class="{ 'menu-open': menuOpen, deleted: bookmark.deleted, selected, batch: ui.batchMode, sortable: draggableView }"
    :style="{ '--i': index }"
    @click="onRowClick()"
    @contextmenu.prevent="menuOpen = !menuOpen"
  >
    <!-- 批量模式复选框 -->
    <span v-if="ui.batchMode" class="check" :class="{ on: selected }" @click.stop="ui.toggleBatchSelect(bookmark.id)">
      <PhCheck :size="11" weight="bold" />
    </span>

    <div class="row-top">
      <FaviconTile :src="bookmark.favicon" :title="bookmark.title" :size="26" :radius="7" />
      <span v-if="bookmark.pinned && !ui.batchMode" class="pin-mini">
        <PhPushPin :size="10" weight="fill" />
      </span>
      <span class="t mk-clamp-1">{{ bookmark.title }}</span>
      <span v-if="bookmark.needVpn" class="vpn mk-badge">VPN</span>
      <div class="tags">
        <TagPill v-for="tag in tags.slice(0, 2)" :key="tag.id" :name="tag.name" />
        <span v-if="tags.length > 2" class="more mk-mono">+{{ tags.length - 2 }}</span>
      </div>
    </div>
    <div class="row-bottom">
      <span class="d mk-clamp-1">{{ bookmark.description || hostOf(bookmark.url) }}</span>
      <span class="time mk-mono">
        <PhStar v-if="bookmark.favorite" :size="10" weight="fill" class="star" />
        {{ time }}
      </span>
    </div>

    <!-- 操作菜单 -->
    <Transition name="menu">
      <div v-if="menuOpen" class="menu" role="menu" @click.stop>
        <template v-if="bookmark.deleted">
          <button class="menu-item" @click="data.restore(bookmark.id); ui.toast(t('toast.restored')); menuOpen = false">
            <PhArrowCounterClockwise :size="15" />
            {{ t('card.restore') }}
          </button>
          <button class="menu-item danger" @click="data.deleteForever(bookmark.id); menuOpen = false">
            <PhTrash :size="15" />
            {{ t('card.deleteForever') }}
          </button>
        </template>
        <template v-else>
          <button class="menu-item" @click="startEdit">
            <PhPencilSimple :size="15" />
            {{ t('common.edit') }}
          </button>
          <button class="menu-item" @click="startShare">
            <PhShareNetwork :size="15" />
            {{ t('card.share') }}
          </button>
          <button class="menu-item" @click="copyUrl">
            <PhCopy :size="15" />
            {{ t('card.copyUrl') }}
          </button>
          <div class="menu-sep" />
          <button class="menu-item danger" @click="onDelete">
            <PhTrash :size="15" />
            {{ t('card.delete') }}
          </button>
        </template>
      </div>
    </Transition>
  </article>
</template>

<style scoped>
.lrow {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 14px;
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: 10px;
  box-shadow: var(--mk-shadow-card);
  cursor: pointer;
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    border-color var(--mk-dur-fast) var(--mk-ease-out);
}

.lrow:hover,
.lrow.menu-open {
  border-color: var(--mk-color-border-strong);
}

.lrow.menu-open {
  z-index: 30;
}

.lrow.deleted {
  opacity: 0.62;
  cursor: default;
}

.lrow.sortable {
  cursor: grab;
}

.lrow.selected {
  border-color: var(--mk-color-accent);
  box-shadow: 0 0 0 1px var(--mk-color-accent), var(--mk-shadow-card);
  background: var(--mk-color-accent-soft-bg);
}

.row-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pin-mini {
  color: var(--mk-color-accent);
  flex-shrink: 0;
}

.t {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--mk-color-text-primary);
}

.vpn {
  background: var(--mk-color-badge-vpn-bg);
  color: var(--mk-color-badge-vpn-text);
  flex-shrink: 0;
}

.tags {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.more {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-muted);
}

.row-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-2);
  min-width: 0;
}

.d {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--mk-color-text-secondary);
}

.time {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.star {
  color: #e2a700;
}

.check {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  border: 1.5px solid var(--mk-color-border-strong);
  background: var(--mk-color-bg-card);
  color: transparent;
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.check:hover {
  border-color: var(--mk-color-accent);
}

.check.on {
  background: var(--mk-color-accent);
  border-color: var(--mk-color-accent);
  color: #fff;
}

.menu {
  position: absolute;
  top: calc(100% + 2px);
  right: var(--mk-space-2);
  min-width: 150px;
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

.menu-sep {
  height: 1px;
  background: var(--mk-color-border-default);
  margin: var(--mk-space-1) var(--mk-space-1);
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
