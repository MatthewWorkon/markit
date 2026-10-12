<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PhArrowCounterClockwise,
  PhCheck,
  PhDownloadSimple,
  PhFolderSimple,
  PhPlus,
  PhStar,
  PhTagSimple,
  PhTrash,
  PhX,
} from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api'
import FolderIcon from '@/components/FolderIcon.vue'
import { useI18n } from 'vue-i18n'

const data = useDataStore()
const ui = useUiStore()
const { t } = useI18n()

const ids = computed(() => [...ui.batchIds])
const isTrash = computed(() => data.currentView.kind === 'trash')
/** 文字确认阈值：超过则需输入「删除」（2026-10-09 用户决策：20） */
const HARD_CONFIRM_LIMIT = 20

const busy = ref(false)

/* ---------- 结果反馈与本地刷新 ---------- */
async function run(action: string, payload?: Record<string, unknown>) {
  if (busy.value || !ids.value.length) return
  busy.value = true
  try {
    const r = await api.post<{ ok: number; failed: Array<{ id: number }> }>(
      '/api/bookmarks/batch',
      { ids: ids.value, action, payload },
    )
    if (r.failed.length) {
      ui.toast(t('batch.partialDone', { ok: r.ok, failed: r.failed.length }))
    } else {
      ui.toast(t('batch.done', { n: r.ok }))
    }
    await data.bootstrap()
    ui.batchIds = new Set()
  } catch {
    ui.toast(t('error.loadFailed'))
  } finally {
    busy.value = false
  }
}

function askDelete() {
  const n = ids.value.length
  const hard = n > HARD_CONFIRM_LIMIT
  ui.confirm({
    title: isTrash.value ? t('batch.purgeTitle') : t('batch.deleteTitle'),
    message: isTrash.value
      ? t('batch.purgeMsg', { n })
      : t('batch.deleteMsg', { n }),
    requireText: hard ? t('batch.hardWord') : undefined,
    onConfirm: () => run(isTrash.value ? 'purge' : 'delete'),
  })
}

/* ---------- 分组 / 标签弹层 ---------- */
const popover = ref<null | 'folder' | 'tag'>(null)
const folderIds = ref<number[]>([])
const tagNames = ref<string[]>([])
const tagInput = ref('')

const folderQuery = ref('')
const creatingFolder = ref(false)
const filteredFolders = computed(() => {
  const q = folderQuery.value.trim().toLowerCase()
  if (!q) return data.folders
  return data.folders.filter((f) => f.name.toLowerCase().includes(q))
})
const exactFolder = computed(() => {
  const q = folderQuery.value.trim()
  if (!q) return undefined
  return data.folders.find((f) => f.name.toLowerCase() === q.toLowerCase())
})
const canCreateFolder = computed(() => {
  const q = folderQuery.value.trim()
  return Boolean(q) && !exactFolder.value
})

async function createFolderFromQuery() {
  const name = folderQuery.value.trim()
  if (!name || exactFolder.value || creatingFolder.value) return
  creatingFolder.value = true
  try {
    const id = await data.addFolder(name, null)
    if (!folderIds.value.includes(id)) folderIds.value.push(id)
    folderQuery.value = ''
    ui.toast(t('addModal.folderCreated', { name }))
  } catch {
    ui.toast(t('error.loadFailed'))
  } finally {
    creatingFolder.value = false
  }
}

function onFolderQueryEnter() {
  if (exactFolder.value) {
    if (!folderIds.value.includes(exactFolder.value.id)) folderIds.value.push(exactFolder.value.id)
    folderQuery.value = ''
  } else {
    createFolderFromQuery()
  }
}

function openPopover(kind: 'folder' | 'tag') {
  folderIds.value = []
  tagNames.value = []
  tagInput.value = ''
  folderQuery.value = ''
  popover.value = kind
}

function confirmFolder() {
  if (!folderIds.value.length) return
  run('move', { folderIds: folderIds.value })
  popover.value = null
}

function addTag(name: string) {
  const n = name.trim().replace(/^#/, '')
  if (n && !tagNames.value.includes(n)) tagNames.value.push(n)
  tagInput.value = ''
}

function confirmTag() {
  if (!tagNames.value.length) return
  run('tag', { tagNames: tagNames.value })
  popover.value = null
}

const tagSuggestions = computed(() =>
  data.tags
    .filter((x) => !tagNames.value.includes(x.name) && x.name.includes(tagInput.value.trim()))
    .slice(0, 6),
)

/* ---------- 导出选中 ---------- */
function exportSelected(format: 'json' | 'html') {
  const a = document.createElement('a')
  a.href = `/api/export?format=${format}&ids=${ids.value.join(',')}`
  a.click()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="bar">
      <div v-if="ui.batchMode" class="bar" role="toolbar">
        <span class="count">
          {{ t('batch.selected', { n: ids.length }) }}
          <button class="clear" :title="t('batch.clearSelection')" @click="ui.batchIds = new Set()">
            <PhX :size="12" weight="bold" />
          </button>
        </span>

        <template v-if="!isTrash">
          <button class="act" :disabled="!ids.length || busy" @click="openPopover('folder')">
            <PhFolderSimple :size="15" />
            <span class="act-label">{{ t('batch.moveTo') }}</span>
          </button>
          <button class="act" :disabled="!ids.length || busy" @click="openPopover('tag')">
            <PhTagSimple :size="15" />
            <span class="act-label">{{ t('batch.addTag') }}</span>
          </button>
          <button class="act" :disabled="!ids.length || busy" @click="run('star')">
            <PhStar :size="15" weight="fill" />
            <span class="act-label">{{ t('batch.star') }}</span>
          </button>
        </template>

        <template v-else>
          <button class="act" :disabled="!ids.length || busy" @click="run('restore')">
            <PhArrowCounterClockwise :size="15" />
            <span class="act-label">{{ t('batch.restore') }}</span>
          </button>
        </template>

        <button class="act" :disabled="!ids.length || busy" @click="askDelete">
          <PhTrash :size="15" />
          <span class="act-label">
            {{ isTrash ? t('batch.purge') : t('batch.delete') }}
            <em v-if="ids.length > HARD_CONFIRM_LIMIT" class="hard-mark">{{ t('batch.hardWord') }}</em>
          </span>
        </button>

        <button
          v-if="!isTrash"
          class="act"
          :disabled="!ids.length || busy"
          :title="t('batch.exportJson')"
          @click="exportSelected('json')"
        >
          <PhDownloadSimple :size="15" />
          <span class="act-label">{{ t('batch.export') }}</span>
        </button>

        <span class="flex" />
        <button class="act exit" @click="ui.exitBatch()">
          <PhX :size="14" />
          {{ t('batch.exit') }}
        </button>

        <!-- 分组多选弹层（查找或创建） -->
        <div v-if="popover === 'folder'" class="pop mk-anim-pop-in" @click.stop>
          <div class="pop-title">{{ t('batch.moveTo') }}</div>
          <div class="folder-search">
            <input
              v-model="folderQuery"
              type="text"
              class="search-input"
              :placeholder="t('addModal.folderSearchPlaceholder')"
              @keydown.enter.prevent="onFolderQueryEnter"
            />
          </div>
          <div class="pop-list">
            <button
              v-for="f in filteredFolders"
              :key="f.id"
              class="pop-option"
              :class="{ checked: folderIds.includes(f.id) }"
              @click="folderIds.includes(f.id) ? folderIds = folderIds.filter(x => x !== f.id) : folderIds.push(f.id)"
            >
              <FolderIcon :name="f.icon" :color-key="f.iconColor" :size="20" />
              <span class="pop-name">{{ f.name }}</span>
              <PhCheck v-if="folderIds.includes(f.id)" :size="14" weight="bold" class="pop-check" />
            </button>
            <p v-if="!filteredFolders.length" class="pop-empty">{{ t('addModal.folderNoMatch') }}</p>
          </div>
          <button
            v-if="canCreateFolder"
            class="folder-create"
            :disabled="creatingFolder"
            @click="createFolderFromQuery"
          >
            <PhPlus :size="14" weight="bold" />
            {{ t('addModal.folderCreate', { name: folderQuery.trim() }) }}
          </button>
          <div class="pop-foot">
            <button class="mk-btn-ghost" @click="popover = null">{{ t('common.cancel') }}</button>
            <button class="mk-btn-primary" :disabled="!folderIds.length" @click="confirmFolder">
              {{ t('batch.apply', { n: ids.length }) }}
            </button>
          </div>
        </div>

        <!-- 标签弹层 -->
        <div v-else-if="popover === 'tag'" class="pop mk-anim-pop-in" @click.stop>
          <div class="pop-title">{{ t('batch.addTag') }}</div>
          <div class="tag-box">
            <span v-for="name in tagNames" :key="name" class="chip">
              {{ name }}
              <i class="chip-x" @click="tagNames = tagNames.filter(x => x !== name)">
                <PhX :size="10" weight="bold" />
              </i>
            </span>
            <input
              v-model="tagInput"
              type="text"
              class="tag-input"
              :placeholder="t('addModal.tagsPlaceholder')"
              @keydown.enter.prevent="addTag(tagInput)"
            />
          </div>
          <div v-if="tagSuggestions.length && tagInput.trim()" class="tag-sug">
            <button v-for="s in tagSuggestions" :key="s.id" class="sug" @click="addTag(s.name)">
              {{ s.name }}
            </button>
          </div>
          <div class="pop-foot">
            <button class="mk-btn-ghost" @click="popover = null">{{ t('common.cancel') }}</button>
            <button class="mk-btn-primary" :disabled="!tagNames.length" @click="confirmTag">
              {{ t('batch.apply', { n: ids.length }) }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bar {
  position: fixed;
  left: 50%;
  bottom: var(--mk-space-6);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--mk-space-1);
  max-width: calc(100vw - var(--mk-space-8));
  padding: var(--mk-space-2) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-lg);
  box-shadow: var(--mk-shadow-modal);
  z-index: calc(var(--mk-z-dropdown) + 10);
}

.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  color: var(--mk-color-text-primary);
  white-space: nowrap;
}

.count .mk-num {
  font-family: var(--mk-font-family-mono);
}

.clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
}

.clear:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-secondary);
  border-radius: var(--mk-radius-sm);
  white-space: nowrap;
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.act:hover:not(:disabled) {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.act:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.act.exit {
  color: var(--mk-color-text-muted);
}

.hard-mark {
  font-style: normal;
  margin-left: 4px;
  padding: 0 6px;
  font-size: 10px;
  font-weight: 600;
  color: var(--mk-color-status-danger-text);
  background: var(--mk-color-status-danger-bg);
  border-radius: var(--mk-radius-full);
}

.flex {
  flex: 1;
}

/* 弹层 */
.pop {
  position: absolute;
  bottom: calc(100% + var(--mk-space-2));
  left: var(--mk-space-4);
  width: 300px;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-3);
}

.pop-title {
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  margin-bottom: var(--mk-space-2);
}

.folder-search {
  padding: var(--mk-space-1) var(--mk-space-2);
  margin-bottom: var(--mk-space-1);
  border-bottom: 1px solid var(--mk-color-border-default);
}

.search-input {
  width: 100%;
  height: 30px;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-primary);
}

.search-input::placeholder {
  color: var(--mk-color-text-faint);
}

.folder-create {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  width: calc(100% - var(--mk-space-2));
  margin: var(--mk-space-1);
  padding: 8px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}

.folder-create:hover:not(:disabled) {
  background: var(--mk-color-accent);
  color: var(--mk-color-text-inverse);
}

.folder-create:disabled {
  opacity: 0.6;
  cursor: progress;
}

.pop-empty {
  padding: var(--mk-space-2);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
  text-align: center;
}

.pop-list {
  max-height: 220px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.pop-option {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  padding: 7px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-primary);
  text-align: left;
}

.pop-option:hover {
  background: var(--mk-color-bg-subtle);
}

.pop-name {
  flex: 1;
}

.pop-check {
  color: var(--mk-color-accent);
}

.pop-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--mk-space-2);
  margin-top: var(--mk-space-3);
}

.tag-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 40px;
  padding: var(--mk-space-1) var(--mk-space-3);
  background: var(--mk-color-bg-base);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
}

.tag-box:focus-within {
  border-color: var(--mk-color-accent);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 4px 0 9px;
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  border-radius: var(--mk-radius-full);
}

.chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  cursor: pointer;
  font-style: normal;
}

.chip-x:hover {
  background: rgba(46, 91, 230, 0.14);
  color: var(--mk-color-accent-soft-text);
}

.tag-input {
  flex: 1;
  min-width: 100px;
  height: 28px;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--mk-font-size-md);
}

.tag-input::placeholder {
  color: var(--mk-color-text-faint);
}

.tag-sug {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mk-space-1);
  margin-top: var(--mk-space-2);
}

.sug {
  height: 24px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-secondary);
  background: var(--mk-color-bg-base);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
}

.sug:hover {
  border-color: var(--mk-color-accent);
}

.bar-enter-active,
.bar-leave-active {
  transition: all var(--mk-dur) var(--mk-ease-spring);
}

.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}

@media (max-width: 768px) {
  .bar {
    left: var(--mk-space-3);
    right: var(--mk-space-3);
    transform: none;
    flex-wrap: wrap;
    bottom: var(--mk-space-3);
  }

  .bar-enter-from,
  .bar-leave-to {
    transform: translateY(16px);
  }

  .act-label {
    display: none;
  }

  .pop {
    left: 0;
    right: 0;
    width: auto;
  }
}
</style>
