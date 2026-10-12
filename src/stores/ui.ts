import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export interface Toast {
  id: number
  message: string
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  /** 强确认：需输入该文字（如「删除」）才能点确认 */
  requireText?: string
  onConfirm: () => void
}

/** UI 全局状态：弹窗、抽屉、Toast */
export const useUiStore = defineStore('ui', () => {
  const addModalOpen = ref(false)
  /** 编辑书签：非 null 时表单弹窗以编辑模式打开该条 */
  const editingId = ref<number | null>(null)
  const settingsOpen = ref(false)
  /** 分享弹窗目标（BK-105；v0.4.1 支持 Skill） */
  const shareTarget = ref<null | { bookmarkId?: number; folderId?: number; skillId?: number; title: string }>(null)
  const mobileSidebarOpen = ref(false)
  const density = ref<'comfortable' | 'compact'>('comfortable')
  /** 产品模式：bookmarks=书签 / skills=Skills 管理（v0.4.0） */
  const currentMode = ref<'bookmarks' | 'skills'>('bookmarks')
  /** Skills 新增弹窗 */
  const addSkillModalOpen = ref(false)
  /** 编辑 Skill：非 null 时新增弹窗以编辑模式打开该条（v0.4.1） */
  const editingSkillId = ref<number | null>(null)
  /** Skills 视图模式：grid=卡片 / list=列表 */
  const skillsViewMode = ref<'grid' | 'list'>(
    (localStorage.getItem('markit.skillsViewMode') as 'grid' | 'list') || 'grid',
  )
  function setSkillsViewMode(v: 'grid' | 'list') {
    skillsViewMode.value = v
    localStorage.setItem('markit.skillsViewMode', v)
  }
  /** 内容区视图模式：grid=卡片 / list=分栏列表（v0.3.10） */
  const viewMode = ref<'grid' | 'list'>(
    (localStorage.getItem('markit.viewMode') as 'grid' | 'list') || 'grid',
  )
  function setViewMode(v: 'grid' | 'list') {
    viewMode.value = v
    localStorage.setItem('markit.viewMode', v)
  }

  /* ---------------- 主题（BK-111：浅色/深色/跟随系统） ---------------- */
  type ThemeChoice = 'light' | 'dark' | 'system'
  const theme = ref<ThemeChoice>(
    (localStorage.getItem('markit.theme') as ThemeChoice) || 'system',
  )
  const systemDark = ref(
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const themeResolved = computed<'light' | 'dark'>(() =>
    theme.value === 'system' ? (systemDark.value ? 'dark' : 'light') : theme.value,
  )

  function applyTheme() {
    const dark = themeResolved.value === 'dark'
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#141412' : '#FAFAF8')
  }

  function setTheme(v: ThemeChoice) {
    theme.value = v
    localStorage.setItem('markit.theme', v)
    applyTheme()
  }

  // 跟随系统：监听系统配色变化
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (e) => {
      systemDark.value = e.matches
      applyTheme()
    })
  applyTheme()

  // 移动端新建分类弹窗（复用输入对话框，后端阶段换成完整表单）
  const newFolderParentId = ref<number | null | undefined>(undefined)

  const toasts = ref<Toast[]>([])
  let toastSeq = 0

  /** 批量管理模式（BK-107 方案 A）：显式进入，操作完成不自动退出 */
  const batchMode = ref(false)
  /** 批量模式作用域：bookmarks / skills（互斥，切模式时清空） */
  const batchScope = ref<'bookmarks' | 'skills'>('bookmarks')
  const batchIds = ref<Set<number>>(new Set())

  function enterBatch(scope: 'bookmarks' | 'skills' = 'bookmarks') {
    batchMode.value = true
    batchScope.value = scope
    batchIds.value = new Set()
  }

  function exitBatch() {
    batchMode.value = false
    batchIds.value = new Set()
  }

  function toggleBatchSelect(id: number) {
    const next = new Set(batchIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    batchIds.value = next
  }

  /** 危险操作确认弹窗（标题+正文+确认/取消），全局单例 */
  const confirmState = ref<ConfirmOptions | null>(null)
  function confirm(opts: ConfirmOptions) {
    confirmState.value = opts
  }
  function resolveConfirm(ok: boolean) {
    const c = confirmState.value
    confirmState.value = null
    if (ok) c?.onConfirm()
  }

  function toast(message: string) {
    const id = ++toastSeq
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 2600)
  }

  return {
    addModalOpen,
    editingId,
    settingsOpen,
    shareTarget,
    mobileSidebarOpen,
    density,
    currentMode,
    addSkillModalOpen,
    editingSkillId,
    skillsViewMode,
    setSkillsViewMode,
    viewMode,
    setViewMode,
    theme,
    themeResolved,
    setTheme,
    newFolderParentId,
    toasts,
    toast,
    batchMode,
    batchScope,
    batchIds,
    enterBatch,
    exitBatch,
    toggleBatchSelect,
    confirmState,
    confirm,
    resolveConfirm,
  }
})
