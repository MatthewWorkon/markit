<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  PhArrowsClockwise,
  PhCheck,
  PhCaretDown,
  PhFolderSimple,
  PhMagnifyingGlass,
  PhPlus,
  PhSparkle,
  PhTagSimple,
  PhX,
} from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import ModalBase from '@/components/ModalBase.vue'
import FolderIcon from '@/components/FolderIcon.vue'
import { DEFAULT_FOLDER_ICON } from '@/utils/folder-icons'
import { api, ApiError } from '@/api'
import type { Bookmark } from '@/types'
import { useI18n } from 'vue-i18n'

const data = useDataStore()
const ui = useUiStore()
const { t } = useI18n()

/** 双模式：新增（addModalOpen） / 编辑（editingId，BK-004） */
const open = computed(() => ui.addModalOpen || ui.editingId !== null)
const editing = computed(() =>
  ui.editingId != null
    ? (data.bookmarks.find((b) => b.id === ui.editingId) ?? null)
    : null,
)
const isEdit = computed(() => editing.value !== null)

function close() {
  ui.addModalOpen = false
  ui.editingId = null
}

interface FormState {
  title: string
  url: string
  description: string
  folderIds: number[]
  tags: string[]
}

const initial = (): FormState => ({ title: '', url: '', description: '', folderIds: [], tags: [] })
const form = reactive<FormState>(initial())

watch(open, (v) => {
  if (!v) return
  errors.value = {}
  folderDropdown.value = false
  tagInput.value = ''
  if (editing.value) {
    form.title = editing.value.title
    form.url = editing.value.url
    form.description = editing.value.description
    form.folderIds = [...editing.value.folderIds]
    form.tags = [...editing.value.tags]
  } else {
    Object.assign(form, initial())
    // 处于某分类视图时，归属分组自动回填当前分组（迭代 3）
    const v = data.currentView
    if (v.kind === 'folder' && !form.folderIds.includes(v.folderId)) {
      form.folderIds = [v.folderId]
    }
  }
})

const errors = ref<Record<string, string>>({})

/** 分组多选下拉 */
const folderDropdown = ref(false)
const folderOf = (id: number) =>
  id === 0
    ? { icon: DEFAULT_FOLDER_ICON, iconColor: null as string | null }
    : (data.folders.find((f) => f.id === id) ?? { icon: DEFAULT_FOLDER_ICON, iconColor: null as string | null })
const folderName = (id: number) =>
  id === 0 ? t('view.uncategorized') : (data.folders.find((f) => f.id === id)?.name ?? '')

function toggleFolder(id: number) {
  const i = form.folderIds.indexOf(id)
  i >= 0 ? form.folderIds.splice(i, 1) : form.folderIds.push(id)
}

/** 分组 combobox：查找或创建（2026-10-09 方案确认：根级创建 + 默认中性外观） */
const folderQuery = ref('')
const creatingFolder = ref(false)
const folderSearchEl = ref<HTMLInputElement>()

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
    if (!form.folderIds.includes(id)) form.folderIds.push(id)
    folderQuery.value = ''
    ui.toast(t('addModal.folderCreated', { name }))
  } catch {
    ui.toast(t('error.loadFailed'))
  } finally {
    creatingFolder.value = false
  }
}

/** 回车：精确匹配已有 → 选中；否则创建 */
function onFolderQueryEnter() {
  if (exactFolder.value) {
    toggleFolder(exactFolder.value.id)
    folderQuery.value = ''
  } else {
    createFolderFromQuery()
  }
}

watch(folderDropdown, (v) => {
  if (v) {
    folderQuery.value = ''
    nextTick(() => folderSearchEl.value?.focus())
  }
})

/** 标签输入（回车添加 / 已有标签点击补全） */
const tagInput = ref('')
const tagSuggestions = computed(() =>
  data.tags
    .filter((x) => !form.tags.includes(x.name) && x.name.includes(tagInput.value.trim()))
    .slice(0, 6),
)

function addTag(name: string) {
  const n = name.trim().replace(/^#/, '')
  if (n && !form.tags.includes(n)) form.tags.push(n)
  tagInput.value = ''
}

/** 保存成功后延迟拉取后台补全的真标题/图标（点击即保存，静默升级） */
function scheduleRefetch(id: number) {
  setTimeout(async () => {
    try {
      const bm = await api.get<Bookmark>(`/api/bookmarks/${id}`)
      data.replaceLocal(bm)
    } catch { /* 静默 */ }
  }, 2600)
}

/** 手动抓取标题（即时填入表单，可见可控） */
const fetchingTitle = ref(false)
async function fetchTitle() {
  if (fetchingTitle.value || !form.url.trim()) return
  fetchingTitle.value = true
  try {
    const r = await api.get<{ title: string | null }>(
      `/api/fetch-title?url=${encodeURIComponent(form.url.trim())}`,
    )
    if (r.title) {
      form.title = r.title
    } else {
      ui.toast(t('addModal.fetchTitleFailed'))
    }
  } catch {
    ui.toast(t('addModal.aiFailed'))
  } finally {
    fetchingTitle.value = false
  }
}

/** AI 生成简介/标签（后端 BK-101：服务端抓页面 + 调绑定的大模型） */
const aiDescLoading = ref(false)
const aiTagsLoading = ref(false)

function ensureUrl(): boolean {
  if (form.url.trim()) return true
  errors.value = { url: t('addModal.aiNeedUrl') }
  return false
}

const aiErrMsg = (code: string, detail?: string) =>
  code === 'ai_disabled'
    ? `${t('addModal.aiDisabled')}（${detail || t('addModal.aiDisabledHint')}）`
    : t('addModal.aiFailed')

async function aiGenerateDesc() {
  if (aiDescLoading.value || !ensureUrl()) return
  aiDescLoading.value = true
  try {
    const r = await api.post<{ desc: string }>('/api/ai/generate', {
      kind: 'desc', url: form.url.trim(), title: form.title.trim(),
    })
    form.description = r.desc
  } catch (e) {
    ui.toast(e instanceof ApiError ? aiErrMsg(e.code, e.detail) : t('addModal.aiFailed'))
  } finally {
    aiDescLoading.value = false
  }
}

async function aiGenerateTags() {
  if (aiTagsLoading.value || !ensureUrl()) return
  aiTagsLoading.value = true
  try {
    const r = await api.post<{ tags: string[] }>('/api/ai/generate', {
      kind: 'tags', url: form.url.trim(), title: form.title.trim(),
    })
    form.tags = r.tags
    ui.toast(t('addModal.aiTagsDone', { n: form.tags.length }))
  } catch (e) {
    ui.toast(e instanceof ApiError ? aiErrMsg(e.code, e.detail) : t('addModal.aiFailed'))
  } finally {
    aiTagsLoading.value = false
  }
}

async function submit(keepOpen: boolean) {
  const errs: Record<string, string> = {}
  const url = form.url.trim()
  if (!url) errs.url = t('addModal.urlRequired')
  else {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    try {
      new URL(normalized)
      // 去重校验：编辑模式排除自身（BK-004）
      if (data.urlExists(normalized, editing.value?.id)) errs.url = t('addModal.urlDuplicated')
    } catch {
      errs.url = t('addModal.urlInvalid')
    }
  }
  errors.value = errs
  if (Object.keys(errs).length) return

  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`

  const payload = {
    title: form.title.trim() || normalized.replace(/^https?:\/\//, ''),
    url: normalized,
    description: form.description.trim(),
    folderIds: [...form.folderIds],
    tagNames: [...form.tags],
  }

  try {
    if (editing.value) {
      await data.updateBookmark(editing.value.id, payload)
      ui.toast(t('addModal.updatedToast', { title: payload.title }))
      scheduleRefetch(editing.value.id)
      close()
      return
    }

    const bm = await data.addBookmark(payload)
    ui.toast(t('addModal.addedToast', { title: bm.title }))
    scheduleRefetch(bm.id)
  } catch (e) {
    if (e instanceof ApiError && e.code === 'url_duplicated') {
      errors.value = { url: t('addModal.urlDuplicated') }
      return
    }
    ui.toast(e instanceof ApiError ? e.code : t('error.loadFailed'))
    return
  }

  if (keepOpen) {
    Object.assign(form, initial())
    folderDropdown.value = false
    tagInput.value = ''
    errors.value = {}
  } else {
    close()
  }
}
</script>

<template>
  <ModalBase
    :open="open"
    :title="isEdit ? t('addModal.editTitle') : t('addModal.title')"
    :width="560"
    @close="close"
  >
    <form class="form" @submit.prevent="submit(false)">
      <div class="field">
        <label class="mk-label" for="add-url">{{ t('addModal.urlLabel') }}</label>
        <input
          id="add-url"
          v-model="form.url"
          class="mk-input"
          type="text"
          :placeholder="t('addModal.urlPlaceholder')"
          spellcheck="false"
          autocomplete="off"
        />
        <p v-if="errors.url" class="mk-field-error">{{ errors.url }}</p>
      </div>

      <div class="field">
        <div class="label-row">
          <label class="mk-label" for="add-title">{{ t('addModal.titleLabel') }}</label>
          <button
            type="button"
            class="ai-chip"
            :disabled="fetchingTitle || !form.url.trim()"
            :title="t('addModal.fetchTitle')"
            @click="fetchTitle"
          >
            <PhArrowsClockwise :size="12" :class="{ spin: fetchingTitle }" />
            {{ fetchingTitle ? t('addModal.fetching') : t('addModal.fetchTitle') }}
          </button>
        </div>
        <input
          id="add-title"
          v-model="form.title"
          class="mk-input"
          type="text"
          :placeholder="t('addModal.titlePlaceholder')"
        />
      </div>

      <div class="field">
        <div class="label-row">
          <label class="mk-label" for="add-desc">{{ t('addModal.descLabel') }}</label>
          <button
            type="button"
            class="ai-chip"
            :disabled="aiDescLoading"
            :title="t('addModal.aiGenerate')"
            @click="aiGenerateDesc"
          >
            <PhSparkle :size="12" weight="fill" :class="{ spin: aiDescLoading }" />
            {{ aiDescLoading ? t('addModal.aiGenerating') : t('addModal.aiGenerate') }}
          </button>
        </div>
        <textarea
          id="add-desc"
          v-model="form.description"
          class="mk-input"
          :placeholder="t('addModal.descPlaceholder')"
        />
      </div>

      <!-- 分组多选 -->
      <div class="field">
        <label class="mk-label">{{ t('addModal.foldersLabel') }}</label>
        <div v-click-outside="() => (folderDropdown = false)" class="folder-select" :class="{ open: folderDropdown }">
          <button type="button" class="folder-trigger" @click="folderDropdown = !folderDropdown">
            <PhFolderSimple :size="15" class="folder-icon" />
            <span v-if="!form.folderIds.length" class="placeholder">{{ t('addModal.foldersPlaceholder') }}</span>
            <span v-else class="chips">
              <span v-for="fid in form.folderIds" :key="fid" class="chip">
                <FolderIcon :name="folderOf(fid).icon" :color-key="folderOf(fid).iconColor" :size="14" />
                {{ folderName(fid) }}
                <i class="chip-x" @click.stop="toggleFolder(fid)"><PhX :size="10" weight="bold" /></i>
              </span>
            </span>
            <PhCaretDown :size="13" class="caret" :class="{ up: folderDropdown }" />
          </button>

          <Transition name="menu">
            <div v-if="folderDropdown" class="folder-menu">
              <div class="folder-search">
                <PhMagnifyingGlass :size="14" class="search-ico" />
                <input
                  ref="folderSearchEl"
                  v-model="folderQuery"
                  type="text"
                  class="search-input"
                  :placeholder="t('addModal.folderSearchPlaceholder')"
                  @keydown.enter.prevent="onFolderQueryEnter"
                />
              </div>
              <div class="folder-list">
                <button
                  v-for="f in filteredFolders"
                  :key="f.id"
                  type="button"
                  class="folder-option"
                  :class="{ checked: form.folderIds.includes(f.id) }"
                  @click="toggleFolder(f.id)"
                >
                  <FolderIcon :name="f.icon" :color-key="f.iconColor" :size="20" />
                  <span class="opt-name">{{ f.name }}</span>
                  <PhCheck v-if="form.folderIds.includes(f.id)" :size="14" weight="bold" class="opt-check" />
                </button>
                <p v-if="!filteredFolders.length" class="folder-empty">{{ t('addModal.folderNoMatch') }}</p>
              </div>
              <button
                v-if="canCreateFolder"
                type="button"
                class="folder-create"
                :disabled="creatingFolder"
                @click="createFolderFromQuery"
              >
                <PhPlus :size="14" weight="bold" />
                {{ t('addModal.folderCreate', { name: folderQuery.trim() }) }}
              </button>
            </div>
          </Transition>
        </div>
      </div>

      <!-- 标签 -->
      <div class="field">
        <div class="label-row">
          <label class="mk-label" for="add-tags">{{ t('addModal.tagsLabel') }}</label>
          <button
            type="button"
            class="ai-chip"
            :disabled="aiTagsLoading"
            :title="t('addModal.aiGenerate')"
            @click="aiGenerateTags"
          >
            <PhSparkle :size="12" weight="fill" :class="{ spin: aiTagsLoading }" />
            {{ aiTagsLoading ? t('addModal.aiGenerating') : t('addModal.aiGenerate') }}
          </button>
        </div>
        <div class="tag-box">
          <span v-for="name in form.tags" :key="name" class="chip tag-chip">
            {{ name }}
            <i class="chip-x" @click="form.tags = form.tags.filter((x) => x !== name)"><PhX :size="10" weight="bold" /></i>
          </span>
          <input
            id="add-tags"
            v-model="tagInput"
            type="text"
            class="tag-input"
            :placeholder="form.tags.length ? '' : t('addModal.tagsPlaceholder')"
            @keydown.enter.prevent="addTag(tagInput)"
            @keydown.,="addTag(tagInput)"
          />
        </div>
        <div v-if="tagSuggestions.length && tagInput.trim()" class="tag-sug">
          <button v-for="s in tagSuggestions" :key="s.id" type="button" class="sug" @click="addTag(s.name)">
            <PhTagSimple :size="12" />
            {{ s.name }}
          </button>
        </div>
      </div>
    </form>

    <template #foot>
      <button
        v-if="!isEdit"
        class="mk-btn-ghost"
        type="button"
        @click="Object.assign(form, initial()); tagInput = ''; errors = {}"
      >
        {{ t('addModal.reset') }}
      </button>
      <span class="spacer" />
      <button v-if="!isEdit" class="mk-btn-secondary" type="button" @click="submit(true)">
        {{ t('addModal.saveAndMore') }}
      </button>
      <button v-if="isEdit" class="mk-btn-ghost" type="button" @click="close">
        {{ t('common.cancel') }}
      </button>
      <button class="mk-btn-primary" type="button" @click="submit(false)">
        {{ isEdit ? t('common.save') : t('addModal.submit') }}
      </button>
    </template>
  </ModalBase>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-5);
}

.field {
  display: flex;
  flex-direction: column;
}

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-2);
  margin-bottom: var(--mk-space-2);
}

.label-row .mk-label {
  margin-bottom: 0;
}

/* AI 生成按钮：淡蓝 pill，点击生成，加载时 sparkle 旋转 */
.ai-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  border-radius: var(--mk-radius-full);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    transform var(--mk-dur-fast) var(--mk-ease-out);
}

.ai-chip:hover:not(:disabled) {
  background: #dfe8fd;
  transform: scale(1.04);
}

.ai-chip:active:not(:disabled) {
  transform: scale(0.96);
}

.ai-chip:disabled {
  opacity: 0.7;
  cursor: progress;
}

.spin {
  animation: mk-spin 0.9s linear infinite;
}

@keyframes mk-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 分组多选 */
.folder-select {
  position: relative;
}

.folder-trigger {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  width: 100%;
  min-height: 40px;
  padding: var(--mk-space-1) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out),
    box-shadow var(--mk-dur-fast) var(--mk-ease-out);
}

.folder-select.open .folder-trigger,
.folder-trigger:focus-visible {
  border-color: var(--mk-color-accent);
  box-shadow: var(--mk-shadow-focus);
}

.folder-icon {
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.placeholder {
  color: var(--mk-color-text-faint);
  font-size: var(--mk-font-size-lg);
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  flex: 1;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 4px 0 9px;
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-primary);
  background: var(--mk-color-bg-subtle);
  border-radius: var(--mk-radius-full);
  white-space: nowrap;
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
  background: var(--mk-color-border-default);
  color: var(--mk-color-text-primary);
}

.caret {
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
  transition: transform var(--mk-dur-fast) var(--mk-ease-out);
}

.caret.up {
  transform: rotate(180deg);
}

.folder-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 280px;
  overflow-y: auto;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1);
  z-index: var(--mk-z-dropdown);
}

/* combobox：查找或创建 */
.folder-search {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  padding: var(--mk-space-1) var(--mk-space-2);
  margin-bottom: var(--mk-space-1);
  border-bottom: 1px solid var(--mk-color-border-default);
}

.search-ico {
  color: var(--mk-color-text-faint);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
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

.folder-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.folder-empty {
  padding: var(--mk-space-2);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
  text-align: center;
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

.folder-create {
  position: sticky;
  bottom: 0;
}

.folder-option {
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

.folder-option:hover {
  background: var(--mk-color-bg-subtle);
}

.opt-name {
  flex: 1;
  text-align: left;
}

.opt-check {
  color: var(--mk-color-accent);
}

/* 标签 */
.tag-box {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  min-height: 40px;
  padding: var(--mk-space-1) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out),
    box-shadow var(--mk-dur-fast) var(--mk-ease-out);
}

.tag-box:focus-within {
  border-color: var(--mk-color-accent);
  box-shadow: var(--mk-shadow-focus);
}

.tag-chip {
  background: var(--mk-color-accent-soft-bg);
  color: var(--mk-color-accent-soft-text);
}

.tag-input {
  flex: 1;
  min-width: 120px;
  height: 28px;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--mk-font-size-lg);
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-secondary);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.sug:hover {
  border-color: var(--mk-color-accent);
  color: var(--mk-color-accent-soft-text);
}

.spacer {
  flex: 1;
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
