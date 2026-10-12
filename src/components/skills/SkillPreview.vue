<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import {
  PhCheck,
  PhCode,
  PhDownloadSimple,
  PhCopySimple,
  PhArrowClockwise,
  PhArrowUpRight,
  PhClockCounterClockwise,
  PhTextHTwo,
  PhImage,
  PhListBullets,
  PhPencilSimple,
  PhPencilSimpleLine,
  PhQuotes,
  PhStar,
  PhTextB,
  PhTextItalic,
  PhLinkSimple,
  PhTrash,
  PhX,
} from '@phosphor-icons/vue'
import type { Skill } from '@/stores/skills'
import { useSkillsStore } from '@/stores/skills'
import { useUiStore } from '@/stores/ui'
import { useI18n } from 'vue-i18n'
import { downloadSkillMd } from '@/utils/skill-export'

const props = defineProps<{ skill: Skill; content: string; loading?: boolean; readonly?: boolean }>()
const emit = defineEmits<{ close: []; saved: [content: string] }>()

const store = useSkillsStore()
const ui = useUiStore()
const { t } = useI18n()

const md = new MarkdownIt({ html: true, linkify: true, breaks: true })
const rendered = computed(() => md.render(props.content || ''))

const copied = ref(false)
function downloadMd() {
  downloadSkillMd(props.skill, props.content)
  if (!props.readonly) store.bumpDownload(props.skill.id)
  ui.toast(t('skills.downloaded'))
}

/* ---------------- 检查更新（预览窗内通知条） ---------------- */
// kind=update → 有新版，需交互（立即更新 / 忽略），不自动消失
// kind=latest/updated/nopath/failed → 提示类，自动淡出
type SyncNotice = { kind: 'update' | 'updated' | 'latest' | 'nopath' | 'failed' }
const syncNotice = ref<SyncNotice | null>(null)
const syncing = ref(false)
let autoFadeTimer: ReturnType<typeof setTimeout> | null = null

function showNotice(n: SyncNotice, autoFadeMs = 3200) {
  syncNotice.value = n
  if (autoFadeTimer) clearTimeout(autoFadeTimer)
  if (n.kind !== 'update') {
    autoFadeTimer = setTimeout(() => { syncNotice.value = null }, autoFadeMs)
  }
}

/** 探测：只看线上有无新版（不落库） */
async function probe(): Promise<SyncNotice> {
  try {
    const hasUpdate = await store.checkRemoteUpdate(props.skill.id)
    return { kind: hasUpdate ? 'update' : 'latest' }
  } catch (e) {
    const noPath = (e as { code?: string })?.code === 'no_source_path'
    return { kind: noPath ? 'nopath' : 'failed' }
  }
}

/** 广场他人条目收藏切换 */
async function togglePlazaFav() {
  try {
    await store.togglePlazaFavorite(props.skill.id)
  } catch { /* 静默 */ }
}

/** dock「检查更新」按钮：探测 + 结果展示 */
async function checkUpdate() {
  if (syncing.value) return
  syncing.value = true
  const n = await probe()
  syncing.value = false
  showNotice(n)
}

/** 通知条「立即更新」：真正拉取覆盖 */
async function applyUpdate() {
  syncNotice.value = null
  const updated = await store.syncFromGithub(props.skill.id)
  if (updated) {
    const full = await store.getDetail(props.skill.id)
    emit('saved', full.content)
    showNotice({ kind: 'updated' })
  } else {
    showNotice({ kind: 'latest' })
  }
}

/** 每天首次打开 GitHub 来源条目时自动检查（v0.4.5） */
function autoSyncIfNeeded() {
  if (props.readonly || props.skill.source !== 'github') return
  const today = new Date().toISOString().slice(0, 10)
  const key = 'markit.skillSyncCheck'
  let last: Record<string, string> = {}
  try { last = JSON.parse(localStorage.getItem(key) || '{}') } catch { /* 坏数据按空处理 */ }
  if (last[props.skill.id] === today) return
  last[props.skill.id] = today
  localStorage.setItem(key, JSON.stringify(last))
  void probe().then((n) => { showNotice(n) })
}

watch(
  () => props.skill.id,
  () => { syncNotice.value = null },
  { immediate: true },
)

const noticeText = computed(() => {
  const n = syncNotice.value
  if (!n) return ''
  if (n.kind === 'update') return t('skills.syncAvailable', { title: props.skill.title })
  if (n.kind === 'updated') return t('skills.syncUpdated')
  if (n.kind === 'latest') return t('skills.syncLatest')
  if (n.kind === 'nopath') return t('skills.syncNoPath')
  return t('skills.syncFailed')
})
/* ---------------- 历史版本（保留最近 3 条） ---------------- */
interface VersionRow { id: number; size: number; reason: string; createdAt: string; preview: string }
const versionsOpen = ref(false)
const versions = ref<VersionRow[]>([])
const versionsLoading = ref(false)
const rollingBack = ref(false)

const reasonText = (r: string) =>
  r === 'edit' ? t('skills.verEdit') : r === 'sync' ? t('skills.verSync') : t('skills.verRollback')

async function openVersions() {
  versionsOpen.value = true
  versionsLoading.value = true
  try {
    versions.value = await store.listVersions(props.skill.id)
  } catch {
    versions.value = []
  } finally {
    versionsLoading.value = false
  }
}

/** 只刷新徽章计数（切换条目时 fab 角标要跟着换） */
async function refreshVersionCount() {
  versionsOpen.value = false // 换条目时收起面板，避免展示上一条的历史
  try {
    versions.value = await store.listVersions(props.skill.id)
  } catch {
    versions.value = []
  }
}

async function doRollback(v: VersionRow) {
  if (rollingBack.value) return
  rollingBack.value = true
  try {
    // 编辑中回退：先把当前编辑内容保存为正式版（其旧正文自动入历史），再回退
    if (editing.value && editContent.value !== props.content) {
      await store.update(props.skill.id, { content: editContent.value })
      editing.value = false
    }
    await store.rollbackTo(props.skill.id, v.id)
    const full = await store.getDetail(props.skill.id)
    emit('saved', full.content)
    ui.toast(t('skills.rolledBack'))
    versions.value = await store.listVersions(props.skill.id)
  } catch {
    ui.toast(t('skills.syncFailed'))
  } finally {
    rollingBack.value = false
  }
}

function copyAll() {
  navigator.clipboard?.writeText(props.content)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

const editing = ref(false)
const editContent = ref('')
/** 编辑态子视图：write=编写 / preview=预览渲染（GitHub 评论框式，v0.4.1） */
const editTab = ref<'write' | 'preview'>('write')
const editorEl = ref<HTMLTextAreaElement | null>(null)

const mdBodyEl = ref<HTMLElement | null>(null)

/** 正文切换时滚回顶部（切换条目/保存/回退/同步后内容都会变） */
watch([() => props.skill.id, () => props.content], () => {
  nextTick(() => {
    if (mdBodyEl.value) mdBodyEl.value.scrollTop = 0
  })
})

watch(() => props.skill.id, () => {
  editing.value = false
  void refreshVersionCount()
  autoSyncIfNeeded()
})

// 组件挂载即算一次（关闭预览 = 组件销毁，重新打开 = 新实例）
void refreshVersionCount()
autoSyncIfNeeded()

function startEdit() {
  editContent.value = props.content
  editTab.value = 'write'
  editing.value = true
}

async function saveEdit() {
  await store.update(props.skill.id, { content: editContent.value })
  editing.value = false
  ui.toast(t('skills.contentSaved'))
  // 通知父级刷新预览正文（否则 props.content 仍是旧内容）
  emit('saved', editContent.value)
  void refreshVersionCount() // 历史 +1，角标即时更新
}

/** 取消编辑：丢弃改动，回到阅读态 dock */
function cancelEdit() {
  editing.value = false
}

/** 编写/预览切换（回编写时聚焦文本区） */
function switchTab(tab: 'write' | 'preview') {
  editTab.value = tab
  if (tab === 'write') {
    nextTick(() => editorEl.value?.focus())
  }
}

/* ---------------- Markdown 工具栏 ---------------- */

/** 包裹选区（无选区时插入占位文本并选中） */
function wrapSel(before: string, after: string, placeholder: string) {
  const el = editorEl.value
  if (!el) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const sel = editContent.value.slice(s, e) || placeholder
  editContent.value = editContent.value.slice(0, s) + before + sel + after + editContent.value.slice(e)
  nextTick(() => {
    el.focus()
    el.selectionStart = s + before.length
    el.selectionEnd = s + before.length + sel.length
  })
}

/** 行前缀（标题/引用/列表）：选区跨行时逐行加 */
function linePrefix(prefix: string) {
  const el = editorEl.value
  if (!el) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const start = editContent.value.lastIndexOf('\n', s - 1) + 1
  const block = editContent.value.slice(start, e) || ' '
  const patched = block
    .split('\n')
    .map((l) => (l.startsWith(prefix) ? l : prefix + l))
    .join('\n')
  editContent.value = editContent.value.slice(0, start) + patched + editContent.value.slice(e)
  nextTick(() => {
    el.focus()
    el.selectionStart = start
    el.selectionEnd = start + patched.length
  })
}

const tools = [
  { icon: PhTextB, titleKey: 'editor.bold', run: () => wrapSel('**', '**', t('editor.text')) },
  { icon: PhTextItalic, titleKey: 'editor.italic', run: () => wrapSel('*', '*', t('editor.text')) },
  { icon: PhTextHTwo, titleKey: 'editor.heading', run: () => linePrefix('## ') },
  { icon: PhListBullets, titleKey: 'editor.list', run: () => linePrefix('- ') },
  { icon: PhQuotes, titleKey: 'editor.quote', run: () => linePrefix('> ') },
  { icon: PhCode, titleKey: 'editor.code', run: () => wrapSel('`', '`', t('editor.codeText')) },
  { icon: PhLinkSimple, titleKey: 'editor.link', run: () => wrapSel('[', '](https://)', t('editor.linkText')) },
] as const

function deleteSkill() {
  ui.confirm({
    title: t('skills.deleteConfirmTitle'),
    message: t('skills.deleteConfirmMsg', { title: props.skill.title }),
    onConfirm: async () => {
      await store.softDelete(props.skill.id)
      ui.toast(t('toast.deleted'))
      emit('close')
    },
  })
}
</script>

<template>
  <div class="preview">
    <header class="head">
      <h3 class="title mk-clamp-1">{{ skill.title }}</h3>
      <span class="times mk-mono">{{ t('skills.times', { c: skill.createdAt.slice(0, 10), m: skill.updatedAt.slice(0, 10) }) }}</span>
      <button class="act close" :title="t('common.close')" @click="editing ? (editing = false) : emit('close')">
        <PhX :size="15" />
      </button>
    </header>

    <!-- 检查更新通知条：update=需交互（立即更新/忽略）；提示类自动淡出 -->
    <Transition name="notice">
      <div v-if="syncNotice" class="sync-notice" :class="syncNotice.kind">
        <PhArrowClockwise v-if="syncNotice.kind !== 'failed' && syncNotice.kind !== 'nopath'" :size="14" class="n-ico" />
        <PhWarning v-else :size="14" class="n-ico" />
        <span class="n-text">{{ noticeText }}</span>
        <template v-if="syncNotice.kind === 'update'">
          <button class="n-action" @click="applyUpdate">{{ t('skills.syncApply') }}</button>
          <button class="n-dismiss" @click="syncNotice = null">{{ t('skills.syncIgnore') }}</button>
        </template>
        <button class="n-close" :title="t('common.close')" @click="syncNotice = null">
          <PhX :size="12" weight="bold" />
        </button>
      </div>
    </Transition>

    <!-- 编辑模式：顶部只留 Markdown 工具；编写/预览切换与取消/保存都在底部 dock -->
    <div v-if="editing" class="editor-area">
      <div class="editor-toolbar" :class="{ off: editTab === 'preview' }">
        <div class="tool-group">
          <button
            v-for="tool in tools"
            :key="tool.titleKey"
            class="tool-btn"
            :title="t(tool.titleKey)"
            type="button"
            @click="tool.run"
          >
            <component :is="tool.icon" :size="14" />
          </button>
        </div>
      </div>
      <textarea
        v-show="editTab === 'write'"
        ref="editorEl"
        v-model="editContent"
        class="editor"
        spellcheck="false"
      />
      <div v-show="editTab === 'preview'" class="md-body editor-preview" v-html="md.render(editContent || '')" />
    </div>

    <!-- Markdown 预览（加载中显示骨架屏；编辑态只显示编辑区，避免上下双区域） -->
    <div v-else-if="loading" class="md-body">
      <div class="skel sk-40" />
      <div class="skel" />
      <div class="skel sk-90" />
      <div class="skel sk-70" />
      <div class="skel sk-55" />
      <div class="skel" />
      <div class="skel sk-80" />
    </div>
    <div v-else ref="mdBodyEl" class="md-body" v-html="rendered" />

    <!-- 底部操作 dock（样式同批量管理条）：阅读态=内容操作；编辑态=编写/预览切换 + 取消/保存 -->
    <div class="dock">
      <template v-if="editing">
        <button class="dock-item" :class="{ on: editTab === 'write' }" @click="switchTab('write')">
          <PhPencilSimpleLine :size="14" />
          {{ t('editor.write') }}
        </button>
        <button class="dock-item" :class="{ on: editTab === 'preview' }" @click="switchTab('preview')">
          <PhImage :size="14" />
          {{ t('editor.preview') }}
        </button>
        <span class="dock-sep" />
        <button class="dock-item" @click="cancelEdit">
          <PhX :size="14" />
          {{ t('common.cancel') }}
        </button>
        <button class="dock-item primary" @click="saveEdit">
          <PhCheck :size="14" weight="bold" />
          {{ t('common.save') }}
        </button>
      </template>
      <template v-else>
        <button v-if="readonly" class="dock-item" @click="togglePlazaFav">
          <PhStar :size="14" :weight="skill.favorite ? 'fill' : 'regular'" :class="{ starred: skill.favorite }" />
          {{ skill.favorite ? t('card.unfavorite') : t('card.favorite') }}
        </button>
        <button v-if="!readonly" class="dock-item" @click="startEdit">
          <PhPencilSimple :size="14" />
          {{ t('common.edit') }}
        </button>
        <button class="dock-item" @click="copyAll">
          <PhCheck v-if="copied" :size="14" weight="bold" />
          <PhCopySimple v-else :size="14" />
          {{ t('skills.copyAll') }}
        </button>
        <button class="dock-item" @click="downloadMd">
          <PhDownloadSimple :size="14" />
          {{ t('skills.downloadMd') }}
          <span v-if="skill.downloadCount" class="dl-count mk-mono">{{ skill.downloadCount }}</span>
        </button>
        <button v-if="skill.source === 'github' && !readonly" class="dock-item" @click="checkUpdate">
          <PhArrowClockwise :size="14" />
          {{ t('skills.checkUpdate') }}
        </button>
        <button v-if="!readonly" class="dock-item danger" @click="deleteSkill">
          <PhTrash :size="14" />
          {{ t('common.delete') }}
        </button>
      </template>
    </div>

    <!-- 右侧吸附浮层组：历史版本 + GitHub 来源访问（同级，间距 40pt） -->
    <div class="ver-anchor">
      <a
        v-if="skill.githubUrl && !readonly"
        class="src-fab"
        :href="skill.githubUrl"
        target="_blank"
        rel="noopener"
        :title="t('skills.openSource')"
      >
        <PhArrowUpRight :size="15" />
      </a>
      <Transition name="notice" mode="out-in">
        <button
          v-if="!versionsOpen"
          key="collapsed"
          class="ver-fab"
          :title="t('skills.history')"
          @click="openVersions"
        >
          <PhClockCounterClockwise :size="15" />
          <span v-if="versions.length" class="ver-fab-badge mk-mono">{{ versions.length }}</span>
        </button>
        <div v-else key="expanded" class="ver-card">
          <div class="ver-head">
            <PhClockCounterClockwise :size="14" class="ver-ico" />
            <span class="ver-title">{{ t('skills.historyTitle', { n: versions.length }) }}</span>
            <span class="ver-note">{{ t('skills.historyNote', { n: 5 }) }}</span>
            <button class="n-close" :title="t('common.close')" @click="versionsOpen = false">
              <PhX :size="13" weight="bold" />
            </button>
          </div>
          <div class="ver-list">
            <p v-if="versionsLoading" class="ver-empty">{{ t('common.loading') }}</p>
            <p v-else-if="!versions.length" class="ver-empty">{{ t('skills.verEmpty') }}</p>
            <div v-for="(v, i) in versions" :key="v.id" class="ver-item">
              <div class="ver-meta">
                <span class="ver-name">{{ t('skills.verN', { n: versions.length - i }) }}</span>
                <span class="ver-reason" :class="v.reason">{{ reasonText(v.reason) }}</span>
                <button class="ver-restore" :disabled="rollingBack" @click="doRollback(v)">
                  {{ t('skills.verRestore') }}
                </button>
              </div>
              <p class="ver-preview mk-mono">{{ v.preview }}</p>
              <div class="ver-sub mk-mono">
                <span>{{ v.createdAt }}</span>
                <span>{{ v.size < 1024 ? v.size + 'B' : (v.size / 1024).toFixed(1) + 'KB' }}</span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.preview { position: relative; display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--mk-space-2);
  padding: var(--mk-space-3) var(--mk-space-4); border-bottom: 1px solid var(--mk-color-border-default);
  flex-shrink: 0;
}
.title { flex: 1; min-width: 0; font-size: var(--mk-font-size-lg); font-weight: 600; letter-spacing: -0.015em; }
.times { flex-shrink: 0; font-size: var(--mk-font-size-xs); color: var(--mk-color-text-faint); white-space: nowrap; }
.act {
  display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px;
  border-radius: var(--mk-radius-sm); color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.act.close:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }

/* 底部操作 dock（样式同批量管理条 BatchBar） */
.dock {
  position: absolute;
  left: 50%;
  bottom: var(--mk-space-4);
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--mk-space-1);
  max-width: calc(100% - var(--mk-space-6));
  padding: var(--mk-space-2) var(--mk-space-3);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-lg);
  box-shadow: var(--mk-shadow-modal);
  z-index: calc(var(--mk-z-dropdown) + 5);
  white-space: nowrap;
}
.dock-item {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px var(--mk-space-3);
  border-radius: var(--mk-radius-md);
  font-size: var(--mk-font-size-md); color: var(--mk-color-text-secondary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}
.dock-item:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.dock-item.on { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); font-weight: 500; }
.dock-item.primary { background: var(--mk-color-accent); color: var(--mk-color-text-inverse); }
.dock-item.primary:hover { background: var(--mk-color-accent); filter: brightness(1.06); }
.dock-item.danger { color: var(--mk-color-status-danger-text); }
.dock-item.danger:hover { background: var(--mk-color-status-danger-bg); }
.dock-sep { width: 1px; height: 18px; background: var(--mk-color-border-default); margin: 0 var(--mk-space-1); flex-shrink: 0; }
.dl-count { font-size: 10px; color: var(--mk-color-text-faint); }
.starred { color: #e2a400; }

/* 检查更新通知条（预览窗内顶部居中） */
.sync-notice {
  position: absolute;
  top: var(--mk-space-3);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  max-width: calc(100% - var(--mk-space-6));
  padding: 8px var(--mk-space-3) 8px var(--mk-space-4);
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-modal);
  z-index: calc(var(--mk-z-dropdown) + 8);
  white-space: nowrap;
}
.sync-notice .n-ico { color: var(--mk-color-accent-soft-text); flex-shrink: 0; }
.sync-notice.failed .n-ico, .sync-notice.nopath .n-ico { color: var(--mk-color-status-danger-text); }
.n-text { font-size: var(--mk-font-size-sm); color: var(--mk-color-text-primary); overflow: hidden; text-overflow: ellipsis; }
.n-action {
  flex-shrink: 0;
  padding: 4px var(--mk-space-3);
  border-radius: var(--mk-radius-full);
  font-size: var(--mk-font-size-xs); font-weight: 500;
  background: var(--mk-color-accent); color: var(--mk-color-text-inverse);
}
.n-dismiss {
  flex-shrink: 0;
  padding: 4px var(--mk-space-3);
  border-radius: var(--mk-radius-full);
  font-size: var(--mk-font-size-xs); font-weight: 500;
  color: var(--mk-color-text-secondary);
  border: 1px solid var(--mk-color-border-default);
}
.n-dismiss:hover { color: var(--mk-color-text-primary); border-color: var(--mk-color-border-strong); }
.n-close {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted); flex-shrink: 0;
}
.n-close:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.notice-enter-active, .notice-leave-active { transition: all var(--mk-dur) var(--mk-ease-out); }
.notice-enter-from, .notice-leave-to { opacity: 0; transform: translate(-50%, -6px); }

/* 历史版本：右侧吸附（关闭钮下方 ~40pt） */
.ver-anchor {
  position: absolute;
  top: calc(var(--mk-space-3) + 28px + 40px); /* 头部内边距 + 关闭钮高度 + 40pt 间距 */
  right: var(--mk-space-4);
  z-index: calc(var(--mk-z-dropdown) + 12);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 40px;
}
.src-fab {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  box-shadow: var(--mk-shadow-card-hover);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.src-fab:hover { color: var(--mk-color-accent); border-color: var(--mk-color-accent); }
.ver-fab {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  box-shadow: var(--mk-shadow-card-hover);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.ver-fab:hover { color: var(--mk-color-accent); border-color: var(--mk-color-accent); }
.ver-fab-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 15px; height: 15px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 4px;
  font-size: 9px; font-weight: 600;
  background: var(--mk-color-accent); color: var(--mk-color-text-inverse);
  border-radius: var(--mk-radius-full);
}
.ver-card {
  width: 300px; max-height: 420px;
  display: flex; flex-direction: column;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-lg);
  box-shadow: var(--mk-shadow-modal);
  overflow: hidden;
}
.ver-head {
  display: flex; align-items: center; gap: var(--mk-space-2);
  padding: var(--mk-space-2) var(--mk-space-3);
  border-bottom: 1px solid var(--mk-color-border-default);
  flex-shrink: 0;
}
.ver-ico { color: var(--mk-color-accent-soft-text); }
.ver-title { flex: 1; font-size: var(--mk-font-size-sm); font-weight: 600; }
.ver-note { flex-shrink: 0; font-size: 9px; color: var(--mk-color-text-faint); margin-right: var(--mk-space-1); }
.ver-list { flex: 1; overflow-y: auto; padding: var(--mk-space-2); }
.ver-empty { padding: var(--mk-space-5) 0; text-align: center; font-size: var(--mk-font-size-xs); color: var(--mk-color-text-faint); }
.ver-item {
  padding: var(--mk-space-2) var(--mk-space-3);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  margin-bottom: var(--mk-space-1);
  background: var(--mk-color-bg-card);
}
.ver-meta { display: flex; align-items: center; gap: var(--mk-space-1); }
.ver-name { font-size: var(--mk-font-size-xs); font-weight: 600; color: var(--mk-color-text-primary); }
.ver-reason {
  font-size: 9px; font-weight: 500;
  padding: 1px 6px; border-radius: var(--mk-radius-full);
  background: var(--mk-color-bg-subtle); color: var(--mk-color-text-muted);
}
.ver-reason.sync { background: var(--mk-color-accent-soft-bg); color: var(--mk-color-accent-soft-text); }
.ver-restore {
  margin-left: auto;
  padding: 3px 9px;
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  font-size: 10px; font-weight: 500;
  color: var(--mk-color-text-secondary);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.ver-restore:hover:not(:disabled) { border-color: var(--mk-color-accent); color: var(--mk-color-accent); }
.ver-restore:disabled { opacity: 0.5; }
.ver-preview {
  margin: var(--mk-space-1) 0;
  font-size: 10px; line-height: 1.5; color: var(--mk-color-text-muted);
  max-height: 2.8em; overflow: hidden;
  white-space: pre-wrap; word-break: break-all;
}
.ver-sub { display: flex; justify-content: space-between; font-size: 9px; color: var(--mk-color-text-faint); }

.editor-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

/* 工具栏（文本编辑器风格） */
.editor-toolbar {
  display: flex; align-items: center; gap: var(--mk-space-2);
  padding: var(--mk-space-2) var(--mk-space-3);
  border-bottom: 1px solid var(--mk-color-border-default);
  background: var(--mk-color-bg-sidebar);
  flex-shrink: 0;
}
.tool-group { display: flex; gap: 1px; transition: opacity var(--mk-dur-fast) var(--mk-ease-out); }
.editor-toolbar.off .tool-group { opacity: 0.35; pointer-events: none; }
.tool-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.tool-btn:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.editor {
  flex: 1; padding: var(--mk-space-4) var(--mk-space-4) 72px; border: none; outline: none; resize: none;
  font-family: var(--mk-font-family-mono); font-size: 13px; line-height: 1.7;
  background: var(--mk-color-bg-base); color: var(--mk-color-text-primary);
}
.editor-preview { background: var(--mk-color-bg-base); }

.md-body { flex: 1; overflow-y: auto; padding: var(--mk-space-4) var(--mk-space-5) 72px; font-size: 14px; line-height: 1.75; }
/* 加载骨架屏 */
.skel {
  height: 13px; border-radius: var(--mk-radius-full);
  background: var(--mk-color-bg-subtle);
  margin: var(--mk-space-3) 0;
  animation: skel-pulse 1.2s ease-in-out infinite;
}
.skel-40 { width: 40%; height: 20px; }
.skel-90 { width: 90%; }
.skel-80 { width: 80%; }
.skel-70 { width: 70%; }
.skel-55 { width: 55%; }
@keyframes skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
.md-body :deep(h1) { font-size: 1.6em; font-weight: 600; margin: 1.2em 0 0.6em; border-bottom: 1px solid var(--mk-color-border-default); padding-bottom: 0.3em; }
.md-body :deep(h2) { font-size: 1.3em; font-weight: 600; margin: 1.2em 0 0.5em; }
.md-body :deep(h3) { font-size: 1.1em; font-weight: 600; margin: 1em 0 0.4em; }
.md-body :deep(p) { margin: 0.6em 0; }
.md-body :deep(ul), .md-body :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.md-body :deep(li) { margin: 0.2em 0; }
.md-body :deep(code) {
  font-family: var(--mk-font-family-mono); font-size: 0.9em;
  background: var(--mk-color-bg-subtle); padding: 2px 6px; border-radius: 4px;
}
.md-body :deep(pre) {
  background: var(--mk-color-bg-subtle); padding: var(--mk-space-3); border-radius: 8px;
  overflow-x: auto; margin: 0.8em 0;
}
.md-body :deep(pre code) { background: none; padding: 0; }
.md-body :deep(blockquote) {
  border-left: 3px solid var(--mk-color-accent); padding-left: var(--mk-space-4);
  margin: 0.8em 0; color: var(--mk-color-text-secondary);
}
.md-body :deep(a) { color: var(--mk-color-accent); text-decoration: none; }
.md-body :deep(a:hover) { text-decoration: underline; }
.md-body :deep(hr) { border: none; border-top: 1px solid var(--mk-color-border-default); margin: 1.5em 0; }
.md-body :deep(table) { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid var(--mk-color-border-default); padding: 6px 10px; text-align: left; }
.md-body :deep(th) { background: var(--mk-color-bg-subtle); font-weight: 500; }
.md-body :deep(img) { max-width: 100%; border-radius: 8px; }
</style>
