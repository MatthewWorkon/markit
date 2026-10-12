<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  PhArrowCounterClockwise,
  PhCheck,
  PhCopy,
  PhDotsThree,
  PhGlobe,
  PhPencilSimple,
  PhPushPin,
  PhShareNetwork,
  PhStar,
  PhTrash,
} from '@phosphor-icons/vue'
import type { Bookmark } from '@/types'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { hostOf, timeAgo } from '@/utils/format'
import { api } from '@/api'
import FaviconTile from '@/components/FaviconTile.vue'
import TagPill from '@/components/TagPill.vue'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { PhGlobe as PhGlobeFallback } from '@phosphor-icons/vue'

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

/** 批量模式选中态 */
const selected = computed(() => ui.batchMode && ui.batchIds.has(props.bookmark.id))

/* 悬停 2s 网页预览小窗（v0.4.13）：截图服务两级回退 */
const { visible: hpVisible, style: hpStyle, enter: hpEnter, leave: hpLeave, hide: hpHide } = useHoverPreview(2000)
const shotStage = ref(0)

function hpOnEnter(e: MouseEvent) {
  if (ui.batchMode || props.bookmark.deleted) return
  shotStage.value = 0
  hpEnter(e)
}
function onShotError() {
  shotStage.value++
}
const shotSrc = computed(() => {
  const u = encodeURIComponent(props.bookmark.url)
  if (shotStage.value === 0) return `https://s0.wp.com/mshots/v1/${u}?w=600&h=400`
  if (shotStage.value === 1) return `https://image.thum.io/get/width/600/crop/400/${props.bookmark.url}`
  return ''
})

const tags = computed(() =>
  props.bookmark.tagIds
    .map((id) => data.tags.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => Boolean(x)),
)

const time = computed(() => timeAgo(props.bookmark.createdAt, locale.value))

function openSite() {
  window.open(props.bookmark.url, '_blank', 'noopener')
}

function onCardClick() {
  if (ui.batchMode) {
    ui.toggleBatchSelect(props.bookmark.id)
    return
  }
  if (!props.bookmark.deleted) {
    openSite()
    // 访问计数（fire-and-forget，BK-109）
    api.post(`/api/bookmarks/${props.bookmark.id}/visit`).catch(() => {})
  }
}

function copyUrl() {
  navigator.clipboard?.writeText(props.bookmark.url)
  ui.toast(t('toast.copied'))
  menuOpen.value = false
}

function startEdit() {
  menuOpen.value = false
  ui.editingId = props.bookmark.id
}

function startShare() {
  menuOpen.value = false
  ui.shareTarget = { bookmarkId: props.bookmark.id, title: props.bookmark.title }
}

async function toggleVpnFlag() {
  menuOpen.value = false
  try {
    await api.patch(`/api/bookmarks/${props.bookmark.id}`, { needVpn: !props.bookmark.needVpn })
    const b = data.bookmarks.find((x) => x.id === props.bookmark.id)
    if (b) b.needVpn = !b.needVpn
  } catch { /* 静默 */ }
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

function onDeleteForever() {
  menuOpen.value = false
  ui.confirm({
    title: t('confirm.deleteForeverTitle'),
    message: t('confirm.deleteForever', { name: props.bookmark.title }),
    onConfirm: () => data.deleteForever(props.bookmark.id),
  })
}

/** 点击外部关闭菜单 */
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
    class="card mk-stagger"
    :class="{ 'menu-open': menuOpen, deleted: bookmark.deleted, selected, batch: ui.batchMode, sortable: draggableView }"
    :style="{ '--i': index }"
    @click="onCardClick(); hpHide()"
    @contextmenu.prevent="menuOpen = !menuOpen"
    @mouseenter="hpOnEnter"
    @mouseleave="hpLeave"
  >
    <!-- 批量模式复选框 -->
    <span v-if="ui.batchMode" class="check" :class="{ on: selected }" @click.stop="ui.toggleBatchSelect(bookmark.id)">
      <PhCheck :size="11" weight="bold" />
    </span>

    <!-- Pin 角标 -->
    <span v-if="bookmark.pinned && !ui.batchMode" class="pin-flag" :title="t('card.pin')" />

    <div class="head">
      <FaviconTile
        :src="bookmark.favicon"
        :title="bookmark.title"
        :size="30"
        :radius="8"
      />
      <div class="head-text">
        <h3 class="title mk-clamp-1">{{ bookmark.title }}</h3>
        <span class="url mk-mono mk-clamp-1">{{ hostOf(bookmark.url) }}</span>
      </div>

      <!-- hover 快捷操作 -->
      <div v-if="!bookmark.deleted" class="quick" @click.stop>
        <button class="q-btn" :title="bookmark.favorite ? t('card.unfavorite') : t('card.favorite')" @click="data.toggleFavorite(bookmark.id)">
          <PhStar :size="15" :weight="bookmark.favorite ? 'fill' : 'regular'" :class="{ starred: bookmark.favorite }" />
        </button>
        <button class="q-btn" :title="bookmark.pinned ? t('card.unpin') : t('card.pin')" @click="data.togglePin(bookmark.id)">
          <PhPushPin :size="15" :weight="bookmark.pinned ? 'fill' : 'regular'" :class="{ pinned: bookmark.pinned }" />
        </button>
        <button class="q-btn" :title="t('common.edit')" @click="menuOpen = !menuOpen">
          <PhDotsThree :size="15" weight="bold" />
        </button>
      </div>
    </div>

    <p class="desc mk-clamp-2">{{ bookmark.description }}</p>

    <div class="foot">
      <div class="foot-tags">
        <span v-if="bookmark.needVpn" class="vpn mk-badge">
          <PhGlobe :size="11" weight="fill" />
          VPN
        </span>
        <TagPill v-for="tag in tags.slice(0, 2)" :key="tag.id" :name="tag.name" />
        <span v-if="tags.length > 2" class="more-tags mk-mono">+{{ tags.length - 2 }}</span>
      </div>
      <span class="time mk-mono">
        <PhStar v-if="bookmark.favorite" :size="11" weight="fill" class="star-mark" />
        {{ time }}
      </span>
    </div>

    <!-- 卡片菜单 -->
    <Transition name="menu">
      <div v-if="menuOpen" class="menu" role="menu" @click.stop>
        <template v-if="bookmark.deleted">
          <button class="menu-item" @click="data.restore(bookmark.id); ui.toast(t('toast.restored')); menuOpen = false">
            <PhArrowCounterClockwise :size="15" />
            {{ t('card.restore') }}
          </button>
          <button class="menu-item danger" @click="onDeleteForever">
            <PhTrash :size="15" />
            {{ t('card.deleteForever') }}
          </button>
        </template>
        <template v-else>
          <button class="menu-item" @click="startEdit">
            <PhPencilSimple :size="15" />
            {{ t('common.edit') }}
          </button>
          <button class="menu-item" @click="copyUrl">
            <PhCopy :size="15" />
            {{ t('card.copyUrl') }}
          </button>
          <button class="menu-item" @click="startShare">
            <PhShareNetwork :size="15" />
            {{ t('card.share') }}
          </button>
          <button class="menu-item" @click="toggleVpnFlag">
            <PhGlobe :size="15" />
            {{ bookmark.needVpn ? t('card.unmarkVpn') : t('card.markVpn') }}
          </button>
          <div class="menu-sep" />
          <button class="menu-item danger" @click="onDelete">
            <PhTrash :size="15" />
            {{ t('card.delete') }}
          </button>
        </template>
      </div>
    </Transition>

    <!-- 悬停 2s 网页预览小窗（截图服务，Teleport 避免裁剪；纯展示不拦截交互） -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="hpVisible" class="hover-preview" :style="hpStyle">
          <img v-if="shotStage < 2" :src="shotSrc" alt="" @error="onShotError">
          <div v-else class="hp-fallback">
            <PhGlobeFallback :size="22" />
            <span>{{ t('preview.unavailable') }}</span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-2);
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-card);
  cursor: pointer;
  transition: transform var(--mk-dur) var(--mk-ease-out),
    box-shadow var(--mk-dur) var(--mk-ease-out),
    border-color var(--mk-dur) var(--mk-ease-out);
}

.card:hover,
.card.menu-open {
  transform: translateY(-2px);
  box-shadow: var(--mk-shadow-card-hover);
  border-color: var(--mk-color-border-strong);
}

.card.menu-open {
  z-index: 30;
}

.card.deleted {
  opacity: 0.62;
  cursor: default;
}

.card.deleted:hover {
  transform: none;
  box-shadow: var(--mk-shadow-card);
  border-color: var(--mk-color-border-default);
}

/* 批量模式：可点击选择、悬停不浮动、隐藏快捷操作 */
.card.batch {
  cursor: pointer;
}

/* 手动排序模式：显示拖动光标 */
.card.sortable {
  cursor: grab;
}

.card.sortable:active {
  cursor: grabbing;
}

.card.batch:hover {
  transform: none;
  box-shadow: var(--mk-shadow-card);
  border-color: var(--mk-color-border-default);
}

.card.batch .quick {
  display: none;
}

.card.selected {
  border-color: var(--mk-color-accent);
  box-shadow: 0 0 0 1px var(--mk-color-accent), var(--mk-shadow-card);
  background: var(--mk-color-accent-soft-bg);
}

.check {
  position: absolute;
  top: 10px;
  left: 10px;
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

.card.batch .head {
  /* 给左上复选框让位 */
  padding-left: 28px;
}

/* Pin 钴蓝角标（右上角小三角） */
.pin-flag {
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  border-top: 22px solid var(--mk-color-accent);
  border-left: 22px solid transparent;
  border-top-right-radius: var(--mk-radius-md);
}

.head {
  display: flex;
  align-items: flex-start;
  gap: var(--mk-space-3);
  padding-right: 4px;
}

.head-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.title {
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
  letter-spacing: -0.01em;
  color: var(--mk-color-text-primary);
  line-height: 1.35;
}

.url {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
  line-height: 1.4;
}

.quick {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  box-shadow: var(--mk-shadow-card-hover);
  opacity: 0;
  transform: translateY(-3px);
  transition: opacity var(--mk-dur-fast) var(--mk-ease-out),
    transform var(--mk-dur-fast) var(--mk-ease-out);
}

.card:hover .quick,
.card.menu-open .quick {
  opacity: 1;
  transform: translateY(0);
}

/* Pin 角标与快捷操作重叠避让 */
.card:not(:hover):not(.menu-open) .pin-flag {
  opacity: 1;
}

.card:hover .pin-flag,
.card.menu-open .pin-flag {
  opacity: 0;
}

.q-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.q-btn:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.starred {
  color: #e2a400;
}

.pinned {
  color: var(--mk-color-accent);
}

.desc {
  flex: 1;
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-secondary);
  line-height: 1.55;
  min-height: calc(2 * 1.55em);
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-2);
}

.foot-tags {
  display: flex;
  align-items: center;
  gap: var(--mk-space-1);
  min-width: 0;
  overflow: hidden;
}

.vpn {
  background: var(--mk-color-badge-vpn-bg);
  color: var(--mk-color-badge-vpn-text);
  flex-shrink: 0;
}

.more-tags {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-muted);
  flex-shrink: 0;
}

.time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.star-mark {
  color: #e2a700;
}

.menu {
  position: absolute;
  top: 44px;
  right: var(--mk-space-2);
  min-width: 156px;
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

.menu-item:hover:not(.disabled) {
  background: var(--mk-color-bg-subtle);
}

.menu-item.danger {
  color: var(--mk-color-status-danger-text);
}

.menu-item.danger:hover {
  background: var(--mk-color-status-danger-bg);
}

.menu-item.disabled {
  color: var(--mk-color-text-faint);
  cursor: not-allowed;
}

.soon {
  margin-left: auto;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mk-color-text-muted);
  background: var(--mk-color-bg-subtle);
  border-radius: var(--mk-radius-full);
  padding: 1px 6px;
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--mk-dur-fast) var(--mk-ease-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
