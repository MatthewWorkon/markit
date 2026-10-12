<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PhArrowDown,
  PhArrowUp,
  PhCaretDown,
  PhCaretRight,
  PhDotsThree,
  PhPencilSimple,
  PhPlus,
  PhShareNetwork,
  PhTrash,
} from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import FolderIcon from '@/components/FolderIcon.vue'
import IconPicker from '@/components/IconPicker.vue'
import { DEFAULT_FOLDER_ICON } from '@/utils/folder-icons'
import type { Folder } from '@/types'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  folders?: Folder[]
  depth?: number
}>()

const data = useDataStore()
const ui = useUiStore()
const { t } = useI18n()
const depth = computed(() => props.depth ?? 0)

/** 输入框自动聚焦 */
const vFocus = { mounted: (el: HTMLInputElement) => el.focus() }

/** 渲染列表：外部传入（递归子级），或根级时自动取顶层文件夹 */
const list = computed(() =>
  props.folders ??
  data.folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder),
)

/** 展开状态：第一层默认展开，深层默认收起；toggled 记录用户显式切换 */
const toggled = ref(new Map<number, boolean>())
function isExpanded(f: Folder) {
  const explicit = toggled.value.get(f.id)
  return explicit ?? depth.value === 0
}
function toggle(f: Folder) {
  toggled.value.set(f.id, !isExpanded(f))
}

const childrenOf = (id: number | null) =>
  data.folders.filter((f) => f.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder)

/** 图标选择弹层（Notion 式：图形 + 底色，实时生效） */
const pickerFor = ref<number | null>(null)
function togglePicker(f: Folder) {
  pickerFor.value = pickerFor.value === f.id ? null : f.id
}
function onIconChange(f: Folder, v: { icon: string; colorKey: string | null }) {
  data.setFolderIcon(f.id, v.icon, v.colorKey)
}
function onIconRemove(f: Folder) {
  data.setFolderIcon(f.id, DEFAULT_FOLDER_ICON, null)
  pickerFor.value = null
}

/** 操作菜单 */
const menuFor = ref<number | null>(null)
function onMenuAction(fn: () => void) {
  fn()
  menuFor.value = null
}

/** 删除分类：危险操作，先弹确认（说明条目去向） */
function requestDeleteFolder(f: Folder) {
  const parent =
    f.parentId != null ? data.folders.find((x) => x.id === f.parentId) : null
  ui.confirm({
    title: t('confirm.deleteFolderTitle'),
    message: parent
      ? t('confirm.deleteFolderMerge', { name: f.name, parent: parent.name })
      : t('confirm.deleteFolderRoot', { name: f.name }),
    onConfirm: () => data.deleteFolder(f.id),
  })
}

/** 重命名内联输入：Enter 提交，点击其他区域（blur）也提交 */
const renamingId = ref<number | null>(null)
const renameValue = ref('')
function startRename(f: Folder) {
  renamingId.value = f.id
  renameValue.value = f.name
}
function commitRename(f: Folder) {
  if (renamingId.value !== f.id) return
  const name = renameValue.value.trim()
  if (name && name !== f.name) data.renameFolder(f.id, name)
  renamingId.value = null
}

/** 同级拖拽排序（BK-109）：拖到某行的上/下半部落位 */
const dragId = ref<number | null>(null)
const dropTarget = ref<{ id: number; pos: 'before' | 'after' } | null>(null)

function onDragStart(f: Folder, e: DragEvent) {
  dragId.value = f.id
  e.dataTransfer?.setData('text/plain', String(f.id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(f: Folder, e: DragEvent) {
  if (dragId.value == null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  dropTarget.value = dragId.value === f.id ? null : { id: f.id, pos }
}

function onDrop() {
  if (dragId.value == null || !dropTarget.value) return resetDrag()
  const dragged = data.folders.find((x) => x.id === dragId.value)
  const target = data.folders.find((x) => x.id === dropTarget.value!.id)
  if (!dragged || !target || dragged.parentId !== target.parentId) return resetDrag()
  const siblings = data.folders
    .filter((x) => x.parentId === dragged.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const without = siblings.filter((x) => x.id !== dragged.id)
  const idx = without.findIndex((x) => x.id === target.id)
  without.splice(dropTarget.value.pos === 'before' ? idx : idx + 1, 0, dragged)
  data.reorderFolders(dragged.parentId, without.map((x) => x.id))
  resetDrag()
}

function resetDrag() {
  dragId.value = null
  dropTarget.value = null
}

/** 移动端：上移/下移（触屏无拖拽） */
function moveDir(f: Folder, dir: -1 | 1) {
  onMenuAction(() => data.moveFolder(f.id, dir))
}

/** 新建子分类内联输入：Enter 提交，点击其他区域（blur）提交/放弃 */
const creatingIn = ref<number | 'root' | null>(null)
const createValue = ref('')
function submitCreate() {
  if (creatingIn.value == null) return
  const name = createValue.value.trim()
  if (name) {
    data.addFolder(name, creatingIn.value === 'root' ? null : (creatingIn.value as number))
  }
  creatingIn.value = null
  createValue.value = ''
}

/** 侧栏「新建分类」按钮 → 根级内联输入（仅根级实例响应） */
if (depth.value === 0) {
  watch(
    () => ui.newFolderParentId,
    (v) => {
      if (v !== undefined) {
        creatingIn.value = 'root'
        createValue.value = ''
        ui.newFolderParentId = undefined
      }
    },
  )
}
</script>

<template>
  <ul class="tree" :style="{ '--depth': depth }">
    <li v-for="f in list" :key="f.id">
      <div
        class="row"
        :class="{
          active: data.currentView.kind === 'folder' && data.currentView.folderId === f.id,
          'menu-open': menuFor === f.id,
          'drop-before': dropTarget?.id === f.id && dropTarget.pos === 'before',
          'drop-after': dropTarget?.id === f.id && dropTarget.pos === 'after',
        }"
        :draggable="dragId == null || dragId === f.id"
        @dragstart="onDragStart(f, $event)"
        @dragover="onDragOver(f, $event)"
        @dragleave="dropTarget?.id === f.id && (dropTarget = null)"
        @drop.prevent="onDrop()"
        @dragend="resetDrag"
      >
        <button
          v-if="childrenOf(f.id).length"
          class="caret"
          :title="isExpanded(f) ? '收起' : '展开'"
          @click.stop="toggle(f)"
        >
          <PhCaretDown v-if="isExpanded(f)" :size="12" weight="fill" />
          <PhCaretRight v-else :size="12" weight="fill" />
        </button>
        <span v-else class="caret-spacer" />

        <!-- 图标：点击打开更换弹层 -->
        <button
          class="icon-slot"
          :title="t('folderIcon.change')"
          @mousedown.stop
          @click.stop="togglePicker(f)"
        >
          <FolderIcon :name="f.icon" :color-key="f.iconColor" :size="22" />
        </button>

        <button class="folder-btn" :title="f.description || f.name" @click="data.currentView = { kind: 'folder', folderId: f.id }">
          <span v-if="renamingId !== f.id" class="folder-name mk-clamp-1">{{ f.name }}</span>
          <input
            v-else
            v-model="renameValue"
            class="rename-input"
            @keyup.enter="commitRename(f)"
            @keyup.esc="renamingId = null"
            @blur="commitRename(f)"
            @click.stop
            v-focus
          />
          <span class="folder-count mk-mono">{{ data.folderCount.get(f.id) ?? 0 }}</span>
        </button>

        <button class="folder-more" :title="t('common.edit')" @click.stop="menuFor = menuFor === f.id ? null : f.id">
          <PhDotsThree :size="15" weight="bold" />
        </button>

        <!-- 文件夹操作菜单 -->
        <Transition name="menu">
          <div v-if="menuFor === f.id" v-click-outside="() => (menuFor = null)" class="menu" @click.stop>
            <button class="menu-item" @click="onMenuAction(() => { creatingIn = f.id; createValue = '' })">
              <PhPlus :size="15" />
              {{ t('nav.newFolder') }}
            </button>
            <button class="menu-item" @click="onMenuAction(() => startRename(f))">
              <PhPencilSimple :size="15" />
              {{ t('common.edit') }}
            </button>
            <button class="menu-item" @click="onMenuAction(() => moveDir(f, -1))">
              <PhArrowUp :size="15" />
              {{ t('folderMove.up') }}
            </button>
            <button class="menu-item" @click="onMenuAction(() => moveDir(f, 1))">
              <PhArrowDown :size="15" />
              {{ t('folderMove.down') }}
            </button>
            <button class="menu-item" @click="onMenuAction(() => { ui.shareTarget = { folderId: f.id, title: f.name } })">
              <PhShareNetwork :size="15" />
              {{ t('card.share') }}
            </button>
            <button class="menu-item danger" @click="onMenuAction(() => requestDeleteFolder(f))">
              <PhTrash :size="15" />
              {{ t('common.delete') }}
            </button>
          </div>
        </Transition>

        <!-- 图标选择弹层（Notion 式） -->
        <IconPicker
          v-if="pickerFor === f.id"
          :icon="f.icon"
          :color-key="f.iconColor"
          @change="(v) => onIconChange(f, v)"
          @remove="onIconRemove(f)"
          @close="pickerFor = null"
        />
      </div>

      <!-- 子分类 -->
      <div v-if="childrenOf(f.id).length && isExpanded(f)" class="children">
        <FolderTree :folders="childrenOf(f.id)" :depth="depth + 1" />

        <!-- 新建子分类内联输入 -->
        <div v-if="creatingIn === f.id" class="inline-create">
          <span class="caret-spacer" />
          <FolderIcon :name="DEFAULT_FOLDER_ICON" :size="22" />
          <input
            v-model="createValue"
            class="rename-input"
            :placeholder="t('nav.newFolder')"
            @keyup.enter="submitCreate"
            @keyup.esc="creatingIn = null"
            @blur="submitCreate"
            @click.stop
            v-focus
          />
        </div>
      </div>

      <!-- 无子目录时的新建子分类内联输入 -->
      <div v-else-if="creatingIn === f.id" class="inline-create">
        <span class="caret-spacer" />
        <FolderIcon :name="DEFAULT_FOLDER_ICON" :size="22" />
        <input
          v-model="createValue"
          class="rename-input"
          :placeholder="t('nav.newFolder')"
          @keyup.enter="submitCreate"
          @keyup.esc="creatingIn = null"
          @blur="submitCreate"
          @click.stop
          v-focus
        />
      </div>
    </li>

    <!-- 根级新建 -->
    <li v-if="creatingIn === 'root'" class="inline-create">
      <FolderIcon :name="DEFAULT_FOLDER_ICON" :size="22" />
      <input
        v-model="createValue"
        class="rename-input"
        :placeholder="t('nav.newFolder')"
        @keyup.enter="submitCreate"
        @keyup.esc="creatingIn = null"
        @blur="submitCreate"
        v-focus
      />
    </li>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--mk-radius-sm);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}

.row:hover,
.row.menu-open {
  background: var(--mk-color-bg-subtle);
}

.row.active {
  background: var(--mk-color-bg-subtle);
}

.row.active .folder-name {
  color: var(--mk-color-text-primary);
  font-weight: 500;
}

.caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 34px;
  flex-shrink: 0;
  color: var(--mk-color-text-faint);
}

.caret-spacer {
  width: 18px;
  flex-shrink: 0;
}

/* 图标槽：hover 微亮提示可点 */
.row.drop-before {
  box-shadow: inset 0 2px 0 var(--mk-color-accent);
}

.row.drop-after {
  box-shadow: inset 0 -2px 0 var(--mk-color-accent);
}

.icon-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: var(--mk-space-1);
  border-radius: 6px;
  flex-shrink: 0;
  transition: transform var(--mk-dur-fast) var(--mk-ease-out);
}

.icon-slot:hover {
  transform: scale(1.08);
}

.icon-slot:active {
  transform: scale(0.96);
}

.folder-btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  min-width: 0;
  height: 34px;
  padding-right: var(--mk-space-1);
  color: var(--mk-color-text-secondary);
  text-align: left;
}

.folder-name {
  flex: 1;
  min-width: 0;
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-secondary);
}

.folder-count {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
}

.folder-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-right: 3px;
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-muted);
  opacity: 0;
  transition: opacity var(--mk-dur-fast) var(--mk-ease-out),
    background var(--mk-dur-fast) var(--mk-ease-out);
}

.row:hover .folder-more,
.row.menu-open .folder-more {
  opacity: 1;
}

.folder-more:hover {
  background: var(--mk-color-border-default);
}

.menu {
  position: absolute;
  top: calc(100% + 2px);
  right: 0;
  min-width: 148px;
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
  padding: 7px var(--mk-space-2);
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

.children {
  padding-left: calc(18px + var(--mk-space-1));
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.inline-create {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  height: 34px;
  padding-left: 18px;
}

.rename-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 var(--mk-space-2);
  font-size: var(--mk-font-size-md);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-accent);
  border-radius: var(--mk-radius-sm);
  box-shadow: var(--mk-shadow-focus);
  outline: none;
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
