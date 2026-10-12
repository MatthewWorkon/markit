<script setup lang="ts">
import { ref } from 'vue'
import {
  PhArrowDown,
  PhArrowUp,
  PhDotsThree,
  PhPencilSimple,
  PhTrash,
} from '@phosphor-icons/vue'
import { useSkillsStore } from '@/stores/skills'
import { useUiStore } from '@/stores/ui'
import FolderIcon from '@/components/FolderIcon.vue'
import IconPicker from '@/components/IconPicker.vue'
import { DEFAULT_FOLDER_ICON } from '@/utils/folder-icons'
import type { SkillFolder } from '@/stores/skills'
import { useI18n } from 'vue-i18n'

/**
 * Skills 一级分组列表（v0.4.1）：交互与书签 FolderTree 同构——
 * 新建（内联输入）/ 点图标换图标（IconPicker）/ 重命名 / 删除（确认弹窗）/ 上下半区拖拽排序 / 上移下移。
 * 区别：无层级（不可建二级），不可分享。
 */
const store = useSkillsStore()
const ui = useUiStore()
const { t } = useI18n()

const vFocus = { mounted: (el: HTMLInputElement) => el.focus() }

/* ---------- 新建（侧栏 + 按钮触发） ---------- */
const creating = defineModel<boolean>('creating', { default: false })
const createValue = ref('')
function submitCreate() {
  const name = createValue.value.trim()
  if (name) store.addFolder(name)
  createValue.value = ''
  creating.value = false
}

/* ---------- 图标弹层 ---------- */
const pickerFor = ref<number | null>(null)
function togglePicker(f: SkillFolder) {
  pickerFor.value = pickerFor.value === f.id ? null : f.id
}
function onIconChange(f: SkillFolder, v: { icon: string; colorKey: string | null }) {
  store.setFolderIcon(f.id, v.icon, v.colorKey)
}
function onIconRemove(f: SkillFolder) {
  store.setFolderIcon(f.id, DEFAULT_FOLDER_ICON, null)
  pickerFor.value = null
}

/* ---------- 操作菜单 ---------- */
const menuFor = ref<number | null>(null)
function onMenuAction(fn: () => void) {
  fn()
  menuFor.value = null
}

/** 删除分组：确认后执行（组内 Skill 自动变为不分组） */
function requestDeleteFolder(f: SkillFolder) {
  ui.confirm({
    title: t('skills.deleteFolderTitle'),
    message: t('skills.deleteFolderMsg', { name: f.name }),
    onConfirm: () => store.deleteFolder(f.id),
  })
}

/* ---------- 重命名 ---------- */
const renamingId = ref<number | null>(null)
const renameValue = ref('')
function startRename(f: SkillFolder) {
  renamingId.value = f.id
  renameValue.value = f.name
}
function commitRename(f: SkillFolder) {
  if (renamingId.value !== f.id) return
  const name = renameValue.value.trim()
  if (name && name !== f.name) store.renameFolder(f.id, name)
  renamingId.value = null
}

/* ---------- 拖拽排序（同 FolderTree：上/下半区落位） ---------- */
const dragId = ref<number | null>(null)
const dropTarget = ref<{ id: number; pos: 'before' | 'after' } | null>(null)

function sortedFolders() {
  return [...store.folders].sort((a, b) => a.sortOrder - b.sortOrder)
}

function onDragStart(f: SkillFolder, e: DragEvent) {
  dragId.value = f.id
  e.dataTransfer?.setData('text/plain', String(f.id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(f: SkillFolder, e: DragEvent) {
  if (dragId.value == null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  dropTarget.value = dragId.value === f.id ? null : { id: f.id, pos }
}
function onDrop() {
  if (dragId.value == null || !dropTarget.value) return resetDrag()
  const list = sortedFolders()
  const dragged = list.find((x) => x.id === dragId.value)
  const target = list.find((x) => x.id === dropTarget.value!.id)
  if (dragged && target) {
    const without = list.filter((x) => x.id !== dragged.id)
    const idx = without.findIndex((x) => x.id === target.id)
    without.splice(dropTarget.value.pos === 'before' ? idx : idx + 1, 0, dragged)
    store.reorderFolders(without.map((x) => x.id))
  }
  resetDrag()
}
function resetDrag() {
  dragId.value = null
  dropTarget.value = null
}
</script>

<template>
  <div class="sf-list">
    <div
      v-for="f in sortedFolders()"
      :key="f.id"
      class="row"
      :class="{
        active: store.currentView === 'folder' && store.folderId === f.id,
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
      <!-- 图标：点击换图标 -->
      <button class="icon-slot" :title="t('folderIcon.change')" @mousedown.stop @click.stop="togglePicker(f)">
        <FolderIcon :name="f.icon" :color-key="f.iconColor" :size="22" />
      </button>

      <button class="folder-btn" @click="store.setFolderView(f.id)">
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
        <span class="folder-count mk-mono">{{ store.folderCount(f.id) }}</span>
      </button>

      <button class="folder-more" :title="t('common.edit')" @click.stop="menuFor = menuFor === f.id ? null : f.id">
        <PhDotsThree :size="15" weight="bold" />
      </button>

      <!-- 操作菜单（同书签分组，无分享） -->
      <Transition name="menu">
        <div v-if="menuFor === f.id" v-click-outside="() => (menuFor = null)" class="menu" @click.stop>
          <button class="menu-item" @click="onMenuAction(() => startRename(f))">
            <PhPencilSimple :size="15" />
            {{ t('common.edit') }}
          </button>
          <button class="menu-item" @click="onMenuAction(() => store.moveFolder(f.id, -1))">
            <PhArrowUp :size="15" />
            {{ t('folderMove.up') }}
          </button>
          <button class="menu-item" @click="onMenuAction(() => store.moveFolder(f.id, 1))">
            <PhArrowDown :size="15" />
            {{ t('folderMove.down') }}
          </button>
          <button class="menu-item danger" @click="onMenuAction(() => requestDeleteFolder(f))">
            <PhTrash :size="15" />
            {{ t('common.delete') }}
          </button>
        </div>
      </Transition>

      <!-- 图标选择弹层 -->
      <IconPicker
        v-if="pickerFor === f.id"
        :icon="f.icon"
        :color-key="f.iconColor"
        @change="(v) => onIconChange(f, v)"
        @remove="onIconRemove(f)"
        @close="pickerFor = null"
      />
    </div>

    <!-- 新建内联输入 -->
    <div v-if="creating" class="inline-create">
      <FolderIcon :name="DEFAULT_FOLDER_ICON" :size="22" />
      <input
        v-model="createValue"
        class="rename-input"
        :placeholder="t('skills.newFolder')"
        @keyup.enter="submitCreate"
        @keyup.esc="creating = false"
        @blur="submitCreate"
        v-focus
      />
    </div>
  </div>
</template>

<style scoped>
.sf-list {
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

.inline-create {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  height: 34px;
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
