<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  PhPencilSimple, PhGithubLogo, PhUploadSimple, PhLinkSimple,
  PhX, PhSpinner, PhFileMd, PhCaretDown, PhCheck, PhMagnifyingGlass, PhPlus, PhFolderSimple,
} from '@phosphor-icons/vue'
import { useUiStore } from '@/stores/ui'
import { useSkillsStore } from '@/stores/skills'
import FolderIcon from '@/components/FolderIcon.vue'
import ScopeSelect from '@/components/skills/ScopeSelect.vue'
import { DEFAULT_FOLDER_ICON } from '@/utils/folder-icons'
import ModalBase from '@/components/ModalBase.vue'
import { useI18n } from 'vue-i18n'

const ui = useUiStore()
const store = useSkillsStore()
const { t } = useI18n()

const open = computed(() => ui.addSkillModalOpen)
/** 编辑模式：非 null 时只展示「手动编写」表单并预填该条（v0.4.1） */
const editingId = computed(() => ui.editingSkillId)
/** 编辑条目的 GitHub 来源链接（仅编辑模式展示） */
const sourceUrl = computed(() => {
  if (editingId.value == null) return ''
  return store.skills.find((s) => s.id === editingId.value)?.githubUrl ?? ''
})
const tab = ref<'manual' | 'github' | 'upload'>('manual')

watch(open, async (v) => {
  if (v) {
    tab.value = 'manual'
    Object.assign(manual, { title: '', description: '', content: '', scope: 'global', projectName: '', folderId: null, isPublic: false })
    ghState.value = 'input'
    ghUrl.value = ''
    ghItems.value = []
    ghProjectName.value = ''
    uploadItems.value = []
    folderDropdown.value = false
    folderQuery.value = ''
    // 编辑模式：预填（内容走详情接口）
    if (editingId.value != null) {
      const meta = store.skills.find((s) => s.id === editingId.value)
      if (meta) {
        manual.title = meta.title
        manual.description = meta.description
        manual.scope = meta.scope
        manual.projectName = meta.projectName
        manual.folderId = meta.folderId
        manual.isPublic = meta.isPublic
      }
      try {
        const full = await store.getDetail(editingId.value)
        manual.content = full.content
      } catch { /* 内容拉取失败保持空 */ }
    } else if (store.currentView === 'folder' && store.folderId != null) {
      // 处于某分组视图时新建：自动回填当前分组（同书签模式逻辑）
      manual.folderId = store.folderId
    }
  }
})

function closeModal() {
  ui.addSkillModalOpen = false
  ui.editingSkillId = null
}

/* ---------- Tab 1: 手动 ---------- */
const manual = reactive({
  title: '', description: '', content: '',
  scope: 'global' as 'global' | 'project',
  projectName: '', folderId: null as number | null,
  isPublic: false,
})

/* ---------- 分组 combobox（单选；查找或创建，样式同书签表单） ---------- */
const folderDropdown = ref(false)
const folderQuery = ref('')
const folderSearchEl = ref<HTMLInputElement>()
const creatingFolder = ref(false)

const folderOf = (id: number | null) =>
  store.folders.find((f) => f.id === id) ?? { icon: DEFAULT_FOLDER_ICON, iconColor: null as string | null, name: '' }

const filteredFolders = computed(() => {
  const q = folderQuery.value.trim().toLowerCase()
  if (!q) return store.folders
  return store.folders.filter((f) => f.name.toLowerCase().includes(q))
})

const exactFolder = computed(() => {
  const q = folderQuery.value.trim()
  if (!q) return undefined
  return store.folders.find((f) => f.name.toLowerCase() === q.toLowerCase())
})

const canCreateFolder = computed(() => Boolean(folderQuery.value.trim()) && !exactFolder.value)

function selectFolder(id: number | null) {
  manual.folderId = id
  folderQuery.value = ''
  folderDropdown.value = false
}

/** 回车智能：有精确匹配 → 选中；无 → 创建 */
function onFolderQueryEnter() {
  if (exactFolder.value) {
    selectFolder(exactFolder.value.id)
  } else if (canCreateFolder.value) {
    createFolderFromQuery()
  }
}

async function createFolderFromQuery() {
  const name = folderQuery.value.trim()
  if (!name || exactFolder.value || creatingFolder.value) return
  creatingFolder.value = true
  try {
    const id = await store.addFolder(name)
    manual.folderId = id
    folderQuery.value = ''
    folderDropdown.value = false
    ui.toast(t('addModal.folderCreated', { name }))
  } catch {
    ui.toast(t('error.loadFailed'))
  } finally {
    creatingFolder.value = false
  }
}

watch(folderDropdown, (v) => {
  if (v) {
    folderQuery.value = ''
    nextTick(() => folderSearchEl.value?.focus())
  }
})

async function saveManual() {
  if (!manual.title.trim() || !manual.content.trim()) return
  if (editingId.value != null) {
    await store.update(editingId.value, {
      title: manual.title.trim(),
      description: manual.description.trim(),
      content: manual.content,
      scope: manual.scope,
      projectName: manual.scope === 'project' ? manual.projectName.trim() : '',
      folderId: manual.folderId,
      isPublic: manual.isPublic,
    })
  } else {
    await store.create({
      title: manual.title.trim(),
      description: manual.description.trim(),
      content: manual.content,
      scope: manual.scope,
      projectName: manual.scope === 'project' ? manual.projectName.trim() : '',
      folderId: manual.folderId,
      isPublic: manual.isPublic,
      source: 'manual',
    })
  }
  ui.toast(t('skills.saved'))
  closeModal()
}

/* ---------- Tab 2: GitHub ---------- */
const ghUrl = ref('')
const ghState = ref<'input' | 'preview'>('input')
const ghParsing = ref(false)
const ghItems = ref<Array<{ title: string; description: string; path: string; size: number; content: string; checked: boolean }>>([])
const ghProjectName = ref('')
const ghAuthor = ref('')
const ghRepoUrl = ref('')
const ghScope = ref<'global' | 'project'>('global')

async function parseGithub() {
  if (!ghUrl.value.trim() || ghParsing.value) return
  ghParsing.value = true
  try {
    const r = await store.parseGithub(ghUrl.value.trim())
    ghItems.value = r.items.map((i) => ({ ...i, checked: true }))
    ghProjectName.value = r.projectName
    ghAuthor.value = r.author
    ghRepoUrl.value = r.repoUrl
    ghState.value = 'preview'
  } catch {
    ui.toast(t('skills.githubParseFailed'))
  } finally {
    ghParsing.value = false
  }
}

async function saveGithub() {
  const selected = ghItems.value.filter((i) => i.checked)
  if (!selected.length) return
  const r = await store.importConfirm(
    selected.map((i) => ({ title: i.title, description: i.description, content: i.content, path: i.path })),
    {
      scope: ghScope.value,
      projectName: ghScope.value === 'project' ? ghProjectName.value : '',
      source: 'github',
      githubUrl: ghRepoUrl.value,
      githubAuthor: ghAuthor.value,
    },
  )
  ui.toast(t('skills.imported', { n: r.added }))
  closeModal()
}

/* ---------- Tab 3: 上传 ---------- */
const uploadItems = ref<Array<{ title: string; description: string; content: string; size: number; checked: boolean; path?: string }>>([])
const uploadScope = ref<'global' | 'project'>('global')
const uploadProjectName = ref('')
const dragOver = ref(false)

function onDrop(e: DragEvent) {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.name.endsWith('.md'))
  for (const f of files) readFile(f)
}

function onFileInput(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
  for (const f of files) readFile(f)
  ;(e.target as HTMLInputElement).value = ''
}

function readFile(f: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const content = String(reader.result ?? '')
    // 解析 frontmatter
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    const title = fm ? (/name:\s*(.+)/.exec(fm[1])?.[1]?.trim() ?? f.name.replace('.md', '')) : f.name.replace('.md', '')
    const description = fm ? (/description:\s*(.+)/.exec(fm[1])?.[1]?.trim() ?? '') : ''
    uploadItems.value.push({ title, description, content, size: f.size, checked: true })
  }
  reader.readAsText(f)
}

async function saveUpload() {
  const selected = uploadItems.value.filter((i) => i.checked)
  if (!selected.length) return
  const r = await store.importConfirm(
    selected.map((i) => ({ title: i.title, description: i.description, content: i.content, path: i.path })),
    { scope: uploadScope.value, projectName: uploadScope.value === 'project' ? uploadProjectName.value : '', source: 'upload' },
  )
  ui.toast(t('skills.imported', { n: r.added }))
  closeModal()
}
</script>

<template>
  <ModalBase :open="open" :title="editingId != null ? t('skills.editTitle') : t('skills.addTitle')" :width="620" @close="closeModal">
    <!-- Tab 切换（编辑模式只展示手动表单） -->
    <div v-if="editingId == null" class="tabs">
      <button class="tab" :class="{ on: tab === 'manual' }" @click="tab = 'manual'">
        <PhPencilSimple :size="14" /> {{ t('skills.tabManual') }}
      </button>
      <button class="tab" :class="{ on: tab === 'github' }" @click="tab = 'github'">
        <PhGithubLogo :size="14" /> {{ t('skills.tabGithub') }}
      </button>
      <button class="tab" :class="{ on: tab === 'upload' }" @click="tab = 'upload'">
        <PhUploadSimple :size="14" /> {{ t('skills.tabUpload') }}
      </button>
    </div>

    <!-- Tab 1: 手动 -->
    <div v-if="tab === 'manual'" class="pane">
      <div class="field">
        <label class="mk-label">{{ t('skills.titleLabel') }}</label>
        <input v-model="manual.title" class="mk-input" type="text" :placeholder="t('skills.titlePlaceholder')" />
      </div>
      <!-- GitHub 来源链接（编辑 GitHub 来源条目时展示，可点击访问） -->
      <div v-if="editingId != null && sourceUrl" class="field">
        <label class="mk-label">{{ t('skills.sourceUrlLabel') }}</label>
        <a :href="sourceUrl" target="_blank" rel="noopener" class="source-link">
          <PhGithubLogo :size="15" />
          <span class="sl-url mk-mono mk-clamp-1">{{ sourceUrl }}</span>
          <PhLinkSimple :size="13" class="sl-ico" />
        </a>
      </div>
      <div class="field">
        <label class="mk-label">{{ t('skills.descLabel') }}</label>
        <input v-model="manual.description" class="mk-input" type="text" :placeholder="t('skills.descPlaceholder')" />
      </div>
      <div class="field">
        <label class="mk-label">{{ t('skills.contentLabel') }}</label>
        <textarea v-model="manual.content" class="mk-input mono" :placeholder="t('skills.contentPlaceholder')" rows="8" />
      </div>
      <div class="field-row">
        <div class="field">
          <label class="mk-label">{{ t('skills.scopeLabel') }}</label>
          <ScopeSelect :model-value="manual.scope" :project-name="manual.projectName" @update="manual.scope = $event" />
        </div>
        <div v-if="manual.scope === 'project'" class="field">
          <label class="mk-label">{{ t('skills.projectNameLabel') }}</label>
          <input v-model="manual.projectName" class="mk-input" type="text" :placeholder="t('skills.projectNamePlaceholder')" />
        </div>
        <div class="field">
          <label class="mk-label">{{ t('skills.folderLabel') }}</label>
          <div v-click-outside="() => (folderDropdown = false)" class="folder-select" :class="{ open: folderDropdown }">
            <button type="button" class="folder-trigger" @click="folderDropdown = !folderDropdown">
              <template v-if="manual.folderId != null">
                <FolderIcon :name="folderOf(manual.folderId).icon" :color-key="folderOf(manual.folderId).iconColor" :size="15" class="folder-icon" />
                <span class="trigger-name">{{ folderOf(manual.folderId).name }}</span>
              </template>
              <template v-else>
                <PhFolderSimple :size="15" class="folder-icon" />
                <span class="trigger-placeholder">{{ t('skills.folderPlaceholder') }}</span>
              </template>
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
                    type="button"
                    class="folder-option"
                    :class="{ checked: manual.folderId == null }"
                    @click="selectFolder(null)"
                  >
                    <FolderIcon :name="DEFAULT_FOLDER_ICON" :size="20" />
                    <span class="opt-name">{{ t('skills.noFolder') }}</span>
                    <PhCheck v-if="manual.folderId == null" :size="14" weight="bold" class="opt-check" />
                  </button>
                  <button
                    v-for="f in filteredFolders"
                    :key="f.id"
                    type="button"
                    class="folder-option"
                    :class="{ checked: manual.folderId === f.id }"
                    @click="selectFolder(f.id)"
                  >
                    <FolderIcon :name="f.icon" :color-key="f.iconColor" :size="20" />
                    <span class="opt-name">{{ f.name }}</span>
                    <PhCheck v-if="manual.folderId === f.id" :size="14" weight="bold" class="opt-check" />
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
      </div>
      <div class="field-row">
        <label class="switch-row">
          <button class="mk-switch" :data-on="manual.isPublic" @click="manual.isPublic = !manual.isPublic" />
          <span>{{ t('skills.publicSwitch') }}</span>
        </label>
      </div>
    </div>

    <!-- Tab 2: GitHub -->
    <div v-else-if="tab === 'github'" class="pane">
      <template v-if="ghState === 'input'">
        <div class="field">
          <label class="mk-label">{{ t('skills.githubUrlLabel') }}</label>
          <input v-model="ghUrl" class="mk-input mono" type="text" placeholder="https://github.com/user/repo" spellcheck="false" @keyup.enter="parseGithub" />
        </div>
        <button class="mk-btn-primary" style="width:100%" :disabled="ghParsing" @click="parseGithub">
          <PhSpinner v-if="ghParsing" :size="14" class="spin" />
          {{ ghParsing ? t('skills.parsing') : t('skills.parseBtn') }}
        </button>
      </template>
      <template v-else-if="ghState === 'preview'">
        <div class="field-row">
          <div class="field">
            <label class="mk-label">{{ t('skills.scopeLabel') }}</label>
            <ScopeSelect :model-value="ghScope" :project-name="ghProjectName" @update="ghScope = $event" />
          </div>
          <div v-if="ghScope === 'project'" class="field">
            <label class="mk-label">{{ t('skills.projectNameLabel') }}</label>
            <input v-model="ghProjectName" class="mk-input" type="text" />
          </div>
        </div>
        <p class="hint">{{ t('skills.githubFound', { n: ghItems.length }) }}</p>
        <div class="file-list">
          <label v-for="(item, i) in ghItems" :key="i" class="file-item">
            <input v-model="item.checked" type="checkbox" />
            <PhFileMd :size="14" class="file-ico" />
            <span class="file-title mk-clamp-1">{{ item.title }}</span>
            <span class="file-size mk-mono">{{ item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}KB` }}</span>
          </label>
        </div>
      </template>
    </div>

    <!-- Tab 3: 上传 -->
    <div v-else-if="tab === 'upload'" class="pane">
      <div
        class="dropzone"
        :class="{ over: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <PhUploadSimple :size="24" class="dz-icon" />
        <p>{{ t('skills.dropHint') }}</p>
        <label class="mk-btn-secondary dz-btn">
          {{ t('skills.chooseFile') }}
          <input type="file" accept=".md" multiple style="display:none" @change="onFileInput" />
        </label>
      </div>
      <template v-if="uploadItems.length">
        <div class="field-row">
          <div class="field">
            <label class="mk-label">{{ t('skills.scopeLabel') }}</label>
            <ScopeSelect :model-value="uploadScope" :project-name="uploadProjectName" @update="uploadScope = $event" />
          </div>
          <div v-if="uploadScope === 'project'" class="field">
            <label class="mk-label">{{ t('skills.projectNameLabel') }}</label>
            <input v-model="uploadProjectName" class="mk-input" type="text" />
          </div>
        </div>
        <div class="file-list">
          <label v-for="(item, i) in uploadItems" :key="i" class="file-item">
            <input v-model="item.checked" type="checkbox" />
            <PhFileMd :size="14" class="file-ico" />
            <span class="file-title mk-clamp-1">{{ item.title }}</span>
            <span class="file-size mk-mono">{{ item.size < 1024 ? `${item.size}B` : `${(item.size / 1024).toFixed(1)}KB` }}</span>
            <button class="file-del" @click.prevent="uploadItems.splice(i, 1)"><PhX :size="10" /></button>
          </label>
        </div>
      </template>
    </div>

    <template #foot>
      <button class="mk-btn-ghost" @click="closeModal">{{ t('common.cancel') }}</button>
      <button
        v-if="tab === 'manual'"
        class="mk-btn-primary"
        :disabled="!manual.title.trim() || !manual.content.trim()"
        @click="saveManual"
      >{{ t('skills.save') }}</button>
      <button
        v-else-if="tab === 'github' && ghState === 'preview'"
        class="mk-btn-primary"
        :disabled="!ghItems.filter(i => i.checked).length"
        @click="saveGithub"
      >{{ t('skills.save') }} ({{ ghItems.filter(i => i.checked).length }})</button>
      <button
        v-else-if="tab === 'upload' && uploadItems.length"
        class="mk-btn-primary"
        :disabled="!uploadItems.filter(i => i.checked).length"
        @click="saveUpload"
      >{{ t('skills.save') }} ({{ uploadItems.filter(i => i.checked).length }})</button>
    </template>
  </ModalBase>
</template>

<style scoped>
.tabs {
  display: flex; gap: var(--mk-space-1); padding: var(--mk-space-1);
  background: var(--mk-color-bg-base); border-radius: var(--mk-radius-md);
  margin-bottom: var(--mk-space-4);
}
.tab {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px var(--mk-space-3); border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md); font-weight: 500; color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.tab:hover { color: var(--mk-color-text-primary); }
.tab.on { background: var(--mk-color-bg-card); color: var(--mk-color-text-primary); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

.pane { display: flex; flex-direction: column; gap: var(--mk-space-4); }
.source-link {
  display: flex; align-items: center; gap: var(--mk-space-2);
  min-height: 40px; padding: var(--mk-space-1) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-accent-soft-text);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out);
}
.source-link:hover { border-color: var(--mk-color-accent); }
.sl-url { flex: 1; min-width: 0; font-size: var(--mk-font-size-sm); color: var(--mk-color-text-secondary); }
.sl-ico { color: var(--mk-color-text-faint); flex-shrink: 0; }
.field { display: flex; flex-direction: column; }
.field-row { display: flex; gap: var(--mk-space-3); }
.field-row .field { flex: 1; }
.mono { font-family: var(--mk-font-family-mono); font-size: var(--mk-font-size-md); }

.hint { font-size: var(--mk-font-size-sm); color: var(--mk-color-text-muted); }

.file-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.file-item {
  display: flex; align-items: center; gap: var(--mk-space-2);
  padding: 8px var(--mk-space-2); border-radius: var(--mk-radius-sm);
  cursor: pointer; transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.file-item:hover { background: var(--mk-color-bg-subtle); }
.file-item input[type='checkbox'] { accent-color: var(--mk-color-accent); }
.file-ico { color: var(--mk-color-accent-soft-text); flex-shrink: 0; }
.file-title { flex: 1; min-width: 0; font-size: var(--mk-font-size-md); }
.file-size { font-size: var(--mk-font-size-xs); color: var(--mk-color-text-faint); flex-shrink: 0; }
.file-del {
  display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px;
  border-radius: var(--mk-radius-full); color: var(--mk-color-text-muted); flex-shrink: 0;
}
.file-del:hover { background: var(--mk-color-status-danger-bg); color: var(--mk-color-status-danger-text); }

.dropzone {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--mk-space-2);
  padding: var(--mk-space-8); border: 2px dashed var(--mk-color-border-strong);
  border-radius: var(--mk-radius-md); color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.dropzone.over { border-color: var(--mk-color-accent); background: var(--mk-color-accent-soft-bg); }
.dz-icon { color: var(--mk-color-text-faint); }
.dz-btn { cursor: pointer; }

.switch-row { display: flex; align-items: center; gap: var(--mk-space-3); cursor: pointer; }
.spin { animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* ---------- 分组 combobox（样式同书签表单） ---------- */
.folder-select { position: relative; }
.folder-trigger {
  display: flex; align-items: center; gap: var(--mk-space-2);
  width: 100%; min-height: 40px; padding: var(--mk-space-1) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
  transition: border-color var(--mk-dur-fast) var(--mk-ease-out),
    box-shadow var(--mk-dur-fast) var(--mk-ease-out);
}
.folder-select.open .folder-trigger,
.folder-trigger:focus-visible { border-color: var(--mk-color-accent); box-shadow: var(--mk-shadow-focus); }
.folder-icon { color: var(--mk-color-text-faint); flex-shrink: 0; }
.trigger-name { flex: 1; min-width: 0; text-align: left; font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trigger-placeholder { color: var(--mk-color-text-faint); font-size: var(--mk-font-size-md); }
.caret { color: var(--mk-color-text-faint); flex-shrink: 0; transition: transform var(--mk-dur-fast) var(--mk-ease-out); }
.caret.up { transform: rotate(180deg); }

.folder-menu {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  max-height: 280px; overflow-y: auto;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1);
  z-index: var(--mk-z-dropdown);
}
.folder-search {
  display: flex; align-items: center; gap: var(--mk-space-2);
  padding: var(--mk-space-1) var(--mk-space-2); margin-bottom: var(--mk-space-1);
  border-bottom: 1px solid var(--mk-color-border-default);
}
.search-ico { color: var(--mk-color-text-faint); flex-shrink: 0; }
.search-input {
  flex: 1; min-width: 0; height: 30px; border: none; outline: none;
  background: transparent; font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary);
}
.search-input::placeholder { color: var(--mk-color-text-faint); }
.folder-list { display: flex; flex-direction: column; gap: 1px; }
.folder-empty { padding: var(--mk-space-2); font-size: var(--mk-font-size-sm); color: var(--mk-color-text-faint); text-align: center; }
.folder-option {
  display: flex; align-items: center; gap: var(--mk-space-2);
  width: 100%; padding: 8px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.folder-option:hover { background: var(--mk-color-bg-subtle); }
.opt-name { flex: 1; min-width: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.opt-check { color: var(--mk-color-accent); flex-shrink: 0; }
.folder-create {
  display: flex; align-items: center; gap: var(--mk-space-2);
  position: sticky; bottom: 0;
  width: calc(100% - var(--mk-space-2)); margin: var(--mk-space-1);
  padding: 8px var(--mk-space-2); border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md); font-weight: 500;
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.folder-create:hover:not(:disabled) { background: var(--mk-color-accent); color: var(--mk-color-text-inverse); }
.folder-create:disabled { opacity: 0.6; cursor: progress; }

.menu-enter-active, .menu-leave-active { transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(4px); }
</style>
