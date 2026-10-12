<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PhPlus, PhMagnifyingGlass, PhSquaresFour, PhList, PhGlobeHemisphereWest, PhUsersThree, PhSparkle, PhBriefcase, PhTrash, PhStar, PhArrowCounterClockwise, PhFolderOpen, PhClock, PhArrowUp, PhArrowDown, PhCaretDown, PhCheckSquare } from '@phosphor-icons/vue'
import { useUiStore } from '@/stores/ui'
import { useDataStore } from '@/stores/data'
import { useSkillsStore, type Skill } from '@/stores/skills'
import BrandMark from '@/components/BrandMark.vue'
import UserPanel from '@/components/UserPanel.vue'
import SkillFolderList from '@/components/skills/SkillFolderList.vue'
import SkillCard from '@/components/skills/SkillCard.vue'
import SkillListRow from '@/components/skills/SkillListRow.vue'
import SkillPreview from '@/components/skills/SkillPreview.vue'
import AddSkillModal from '@/components/skills/AddSkillModal.vue'
import SkillsBatchBar from '@/components/skills/SkillsBatchBar.vue'
import { useI18n } from 'vue-i18n'

const ui = useUiStore()
const data = useDataStore()
const store = useSkillsStore()

/** 批量选择切换（卡片/列表行 emit） */
function batchToggle(id: number) {
  ui.toggleBatchSelect(id)
}

/** 全选/反选当前视图 */
const allPicked = computed(() =>
  store.visibleSkills.length > 0 && store.visibleSkills.every((s) => ui.batchIds.has(s.id)),
)
function toggleSelectAll() {
  if (allPicked.value) {
    for (const s of store.visibleSkills) ui.batchIds.delete(s.id)
    ui.batchIds = new Set(ui.batchIds)
  } else {
    ui.batchIds = new Set(store.visibleSkills.map((s) => s.id))
  }
}

// 切换产品模式时退出批量态（防止书签/Skills 互窜）
watch(
  () => ui.currentMode,
  () => {
    if (ui.batchMode) ui.exitBatch()
  },
)
const { t } = useI18n()

/** 分组区新建输入开关（传给 SkillFolderList） */
const folderCreating = ref(false)

onMounted(() => {
  store.bootstrap()
  if (!data.loaded) data.bootstrap()
})

// 进入广场视图拉公开条目；星标视图合并拉广场收藏（v0.4.8）
watch(
  () => store.currentView,
  (v) => {
    if (v === 'plaza') void store.loadPlaza()
    if (v === 'favorite') void store.loadFavoritedPlaza()
  },
  { immediate: true },
)

// 启动即拉一次广场收藏（侧栏角标要含广场收藏数）
void store.loadFavoritedPlaza()

const selectedSkill = ref<Skill | null>(null)
const previewContent = ref('')
const previewOpen = ref(false)
const previewLoading = ref(false)
/** 正文缓存：重复打开同一 Skill 秒开，切换先清空显示骨架屏（v0.4.9） */
const contentCache = new Map<number, string>()

/* 可拖拽分栏：右侧预览宽度（像素，持久化） */
const previewWidth = ref(Number(localStorage.getItem('markit.skillsPreviewW')) || 0) // 0 = 默认 25%
const dragging = ref(false)

function onDragStart(e: MouseEvent) {
  dragging.value = true
  e.preventDefault()
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}
function onDragMove(e: MouseEvent) {
  if (!dragging.value) return
  const w = window.innerWidth - e.clientX
  previewWidth.value = Math.max(280, Math.min(window.innerWidth * 0.55, w))
}
function onDragEnd() {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
  localStorage.setItem('markit.skillsPreviewW', String(previewWidth.value))
}

async function selectSkill(s: Skill) {
  const cached = contentCache.get(s.id)
  selectedSkill.value = s
  previewOpen.value = true
  if (cached !== undefined) {
    previewLoading.value = false
    previewContent.value = cached
    return
  }
  previewContent.value = ''
  previewLoading.value = true
  try {
    const full = await store.getDetail(s.id)
    contentCache.set(s.id, full.content)
    // 期间用户已切到别的条目则丢弃这次结果
    if (selectedSkill.value?.id === s.id) previewContent.value = full.content
  } finally {
    if (selectedSkill.value?.id === s.id) previewLoading.value = false
  }
}

const viewTitle = computed(() => {
  switch (store.currentView) {
    case 'plaza': return t('skills.plaza')
    case 'all': return t('skills.all')
    case 'uncategorized': return t('skills.uncategorized')
    case 'global': return t('skills.global')
    case 'project': return t('skills.project')
    case 'favorite': return t('view.favorite')
    case 'trash': return t('skills.trash')
    case 'folder': return store.folders.find(f => f.id === store.folderId)?.name ?? ''
    default: return t('skills.all')
  }
})

function purgeSkill(s: Skill) {
  ui.confirm({
    title: t('skills.purgeConfirmTitle'),
    message: t('skills.purgeConfirmMsg', { title: s.title }),
    confirmText: t('skills.purge'),
    onConfirm: () => store.purge(s.id),
  })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

/** 预览内保存/回退/同步后：更新正文并同步缓存 */
function onPreviewSaved(content: string) {
  previewContent.value = content
  if (selectedSkill.value) contentCache.set(selectedSkill.value.id, content)
}

/** 广场条目复制到我的库（落未分组），成功后跳到我的库查看 */
async function copyToLibrary(s: Skill) {
  await store.copyFromPlaza(s.id)
  store.currentView = 'uncategorized'
  ui.toast(t('skills.copiedToLibrary', { title: s.title }))
}

async function restoreSkill(id: number) {
  await store.restore(id)
  ui.toast(t('toast.restored'))
}

/* 排序下拉（同书签模式样式；v0.4.5） */
const sortMenuOpen = ref(false)
const sortOptions = [
  { key: 'updated', label: t('skills.sortUpdated'), icon: PhClock },
  { key: 'oldest', label: t('skills.sortOldest'), icon: PhArrowUp },
  { key: 'downloads', label: t('skills.sortDownloads'), icon: PhArrowDown },
] as const
</script>

<template>
  <div class="shell">
    <!-- 侧栏 -->
    <aside class="sidebar">
      <div class="brand">
        <BrandMark :size="26" />
        <span class="brand-name">Markit</span>
        <div class="mode-toggle">
          <button class="mt-btn" title="书签收藏" @click="$router.push('/')">{{ t('nav.modeSite') }}</button>
          <button class="mt-btn on" title="Skills 管理">{{ t('nav.modeSkill') }}</button>
        </div>
      </div>

      <nav class="scroll">
        <!-- 广场 -->
        <section class="section">
          <div class="section-label">{{ t('skills.plazaSection') }}</div>
          <button
            class="nav-item"
            :class="{ active: store.currentView === 'plaza' }"
            @click="store.currentView = 'plaza'"
          >
            <PhUsersThree :size="16" />
            <span class="nav-name">{{ t('skills.plaza') }}</span>
            <span class="nav-count mk-mono">{{ store.plazaCount }}</span>
          </button>
          <button
            class="nav-item"
            :class="{ active: store.currentView === 'favorite' }"
            @click="store.currentView = 'favorite'"
          >
            <PhStar :size="16" />
            <span class="nav-name">{{ t('view.favorite') }}</span>
            <span class="nav-count mk-mono">{{ store.favoriteCount }}</span>
          </button>
        </section>

        <!-- 系统分类 -->
        <section class="section">
          <div class="section-label">{{ t('skills.mySkills') }}</div>
          <button class="nav-item" :class="{ active: store.currentView === 'all' }" @click="store.currentView = 'all'">
            <PhSparkle :size="16" />
            <span class="nav-name">{{ t('skills.all') }}</span>
            <span class="nav-count mk-mono">{{ store.stats.all }}</span>
          </button>
          <button class="nav-item" :class="{ active: store.currentView === 'uncategorized' }" @click="store.currentView = 'uncategorized'">
            <PhFolderOpen :size="16" />
            <span class="nav-name">{{ t('skills.uncategorized') }}</span>
            <span class="nav-count mk-mono">{{ store.uncategorizedCount }}</span>
          </button>
          <button class="nav-item" :class="{ active: store.currentView === 'global' }" @click="store.currentView = 'global'">
            <PhGlobeHemisphereWest :size="16" />
            <span class="nav-name">{{ t('skills.global') }}</span>
            <span class="nav-count mk-mono">{{ store.stats.global }}</span>
          </button>
          <button class="nav-item" :class="{ active: store.currentView === 'project' }" @click="store.currentView = 'project'">
            <PhBriefcase :size="16" />
            <span class="nav-name">{{ t('skills.project') }}</span>
            <span class="nav-count mk-mono">{{ store.stats.project }}</span>
          </button>
        </section>

        <!-- 自定义分组（一级；新建/图标/重命名/删除/拖拽同书签模式） -->
        <section class="section">
          <div class="section-label skills-label">
            {{ t('skills.folders') }}
            <button class="icon-btn" :title="t('skills.newFolder')" @click="folderCreating = true">
              <PhPlus :size="13" weight="bold" />
            </button>
          </div>
          <SkillFolderList v-model:creating="folderCreating" />
        </section>
      </nav>

      <!-- 底部固定区（与书签模式共用 UserPanel） -->
      <div class="bottom">
        <button
          class="nav-item"
          :class="{ active: store.currentView === 'trash' }"
          @click="store.currentView = 'trash'"
        >
          <PhTrash :size="16" weight="regular" />
          <span class="nav-name">{{ t('skills.trash') }}</span>
          <span v-if="store.trashCount" class="nav-count mk-mono">{{ store.trashCount }}</span>
        </button>

        <UserPanel />
      </div>
    </aside>

    <!-- 主区 -->
    <main class="main">
      <header class="topbar">
        <div class="left">
          <h1 class="title">{{ viewTitle }}</h1>
          <span class="count mk-mono">{{ store.visibleSkills.length }}</span>
        </div>
        <div class="right">
          <div class="search">
            <PhMagnifyingGlass :size="15" class="search-icon" />
            <input v-model="store.searchQuery" type="text" class="search-input" :placeholder="t('skills.searchPlaceholder')" />
          </div>
          <!-- 排序下拉（同书签模式） -->
          <div v-click-outside="() => (sortMenuOpen = false)" class="sort-dd">
            <button class="sort-trigger" @click="sortMenuOpen = !sortMenuOpen">
              <component :is="sortOptions.find(o => o.key === store.sortMode)?.icon" :size="14" />
              <span class="sort-label">{{ sortOptions.find(o => o.key === store.sortMode)?.label }}</span>
              <PhCaretDown :size="11" class="sort-caret" :class="{ up: sortMenuOpen }" />
            </button>
            <Transition name="menu">
              <div v-if="sortMenuOpen" class="sort-menu">
                <button
                  v-for="opt in sortOptions"
                  :key="opt.key"
                  class="sort-option"
                  :class="{ on: store.sortMode === opt.key }"
                  @click="store.setSortMode(opt.key); sortMenuOpen = false"
                >
                  <component :is="opt.icon" :size="14" />
                  {{ opt.label }}
                  <PhCheckSquare v-if="store.sortMode === opt.key" :size="13" class="sort-check" />
                </button>
              </div>
            </Transition>
          </div>

          <div class="view-toggle">
            <button class="vt-btn" :class="{ on: ui.skillsViewMode === 'grid' }" @click="ui.setSkillsViewMode('grid')">
              <PhSquaresFour :size="15" />
            </button>
            <button class="vt-btn" :class="{ on: ui.skillsViewMode === 'list' }" @click="ui.setSkillsViewMode('list')">
              <PhList :size="15" />
            </button>
          </div>
          <!-- 批量管理：全选（批量态）/ 管理入口 -->
          <button
            v-if="ui.batchMode && ui.batchScope === 'skills'"
            class="mk-btn-secondary"
            @click="toggleSelectAll"
          >
            {{ allPicked ? t('batch.unselectAll') : t('batch.selectAll') }}
          </button>
          <button
            v-if="!ui.batchMode || ui.batchScope !== 'skills'"
            class="manage-btn mk-btn-secondary"
            @click="ui.enterBatch('skills')"
          >
            <PhCheckSquare :size="15" />
            <span class="manage-label">{{ t('batch.manage') }}</span>
          </button>
          <button class="mk-btn-primary" @click="ui.addSkillModalOpen = true">
            <PhPlus :size="16" weight="bold" />
            {{ t('skills.add') }}
          </button>
        </div>
      </header>

      <div class="content">
        <!-- 左侧：卡片/列表 -->
        <div class="list-area">
          <!-- 回收站视图 -->
          <div v-if="store.currentView === 'trash'" class="trash-list">
            <div v-if="!store.visibleSkills.length" class="trash-empty">{{ t('skills.trashEmpty') }}</div>
            <template v-else>
              <div v-for="s in store.visibleSkills" :key="s.id" class="trash-row">
                <div class="trash-meta">
                  <span class="trash-title">{{ s.title }}</span>
                  <span class="trash-sub">{{ s.scope === 'global' ? t('skills.global') : s.projectName }} · {{ fmtDate(s.updatedAt) }}</span>
                </div>
                <div class="trash-actions">
                  <button class="trash-btn" @click="restoreSkill(s.id)">
                    <PhArrowCounterClockwise :size="14" />
                    {{ t('skills.restore') }}
                  </button>
                  <button class="trash-btn danger" @click="purgeSkill(s)">
                    <PhTrash :size="14" />
                    {{ t('skills.purge') }}
                  </button>
                </div>
              </div>
            </template>
          </div>
          <div v-else-if="ui.skillsViewMode === 'grid'" class="grid">
            <SkillCard
              v-for="s in store.visibleSkills"
              :key="s.id"
              :skill="s"
              :selected="selectedSkill?.id === s.id"
              :readonly="store.currentView === 'plaza' || !!s.authorUsername"
              @click="ui.batchMode && ui.batchScope === 'skills' ? batchToggle(s.id) : selectSkill(s)"
              @copy="copyToLibrary(s)"
              @batch-toggle="batchToggle(s.id)"
            />
          </div>
          <div v-else class="list">
            <SkillListRow
              v-for="s in store.visibleSkills"
              :key="s.id"
              :skill="s"
              :selected="selectedSkill?.id === s.id"
              :readonly="store.currentView === 'plaza' || !!s.authorUsername"
              @click="ui.batchMode && ui.batchScope === 'skills' ? batchToggle(s.id) : selectSkill(s)"
              @copy="copyToLibrary(s)"
              @batch-toggle="batchToggle(s.id)"
            />
          </div>
        </div>

        <!-- 拖拽分界线 -->
        <div
          v-if="previewOpen && selectedSkill"
          class="split-handle"
          :class="{ dragging }"
          @mousedown="onDragStart"
        >
          <span class="handle-bar" />
        </div>

        <!-- 右侧：Markdown 预览 -->
        <Transition name="slide">
          <div
            v-if="previewOpen && selectedSkill"
            class="preview-area"
            :style="previewWidth ? { width: previewWidth + 'px' } : {}"
          >
            <SkillPreview
              :skill="selectedSkill"
              :content="previewContent"
              :loading="previewLoading"
              :readonly="store.currentView === 'plaza' || !!selectedSkill?.authorUsername"
              @close="previewOpen = false"
              @saved="onPreviewSaved"
            />
          </div>
        </Transition>
      </div>
    </main>

    <SkillsBatchBar />
    <AddSkillModal />
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100dvh; overflow: hidden; }
.sidebar {
  display: flex; flex-direction: column; width: var(--mk-sidebar-width);
  background: var(--mk-color-bg-sidebar); border-right: 1px solid var(--mk-color-border-default);
}
.brand { display: flex; align-items: center; gap: var(--mk-space-2); padding: 0 var(--mk-space-5); height: var(--mk-topbar-height); flex-shrink: 0; }
.brand-name { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; }
.mode-toggle { display: inline-flex; margin-left: auto; background: var(--mk-color-bg-card); border: 1px solid var(--mk-color-border-default); border-radius: var(--mk-radius-full); padding: 2px; gap: 1px; }
.mt-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0 10px; height: 26px; border-radius: var(--mk-radius-full); font-size: 12px; font-weight: 500; color: var(--mk-color-text-faint); transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.mt-btn:hover { color: var(--mk-color-text-primary); }
.mt-btn.on { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--mk-space-3); display: flex; flex-direction: column; gap: var(--mk-space-5); }
.section-label { padding: 0 var(--mk-space-2); margin-bottom: var(--mk-space-1); font-size: var(--mk-font-size-xs); font-weight: 500; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mk-color-text-faint); }
/* 分组标题行（带新建按钮，同书签模式） */
.skills-label { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--mk-space-2); }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: var(--mk-radius-sm); color: var(--mk-color-text-muted); transition: background var(--mk-dur-fast) var(--mk-ease-out), color var(--mk-dur-fast) var(--mk-ease-out); }
.icon-btn:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.nav-item { display: flex; align-items: center; gap: var(--mk-space-2); width: 100%; padding: 7px var(--mk-space-2); border-radius: var(--mk-radius-sm); color: var(--mk-color-text-secondary); transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.nav-item:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.nav-item.active { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); font-weight: 500; }
.nav-item.active svg { color: var(--mk-color-accent); }
.nav-name { flex: 1; text-align: left; font-size: var(--mk-font-size-md); }
.nav-count { font-size: var(--mk-font-size-xs); color: var(--mk-color-text-faint); }
.bottom { flex-shrink: 0; border-top: 1px solid var(--mk-color-border-default); padding: var(--mk-space-3); display: flex; flex-direction: column; gap: var(--mk-space-2); }


/* 回收站视图 */
.trash-list { display: flex; flex-direction: column; gap: 6px; }
.trash-empty { padding: var(--mk-space-8) 0; text-align: center; color: var(--mk-color-text-faint); font-size: var(--mk-font-size-md); }
.trash-row { display: flex; align-items: center; gap: var(--mk-space-4); padding: var(--mk-space-3) var(--mk-space-4); background: var(--mk-color-bg-card); border: 1px solid var(--mk-color-border-default); border-radius: var(--mk-radius-md); }
.trash-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.trash-title { font-size: var(--mk-font-size-md); font-weight: 500; color: var(--mk-color-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trash-sub { font-size: var(--mk-font-size-xs); color: var(--mk-color-text-faint); }
.trash-actions { display: flex; gap: var(--mk-space-2); flex-shrink: 0; }
.trash-btn { display: inline-flex; align-items: center; gap: 4px; padding: 6px var(--mk-space-3); border-radius: var(--mk-radius-sm); font-size: var(--mk-font-size-sm); color: var(--mk-color-text-secondary); border: 1px solid var(--mk-color-border-default); background: var(--mk-color-bg-card); transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.trash-btn:hover { color: var(--mk-color-text-primary); background: var(--mk-color-bg-subtle); }
.trash-btn.danger:hover { color: var(--mk-color-status-danger-text); background: var(--mk-color-status-danger-bg); }

.main { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.topbar {
  display: flex; align-items: center; justify-content: space-between; gap: var(--mk-space-4);
  height: var(--mk-topbar-height); padding: 0 var(--mk-space-6);
  border-bottom: 1px solid var(--mk-color-border-default);
  background: var(--mk-color-bg-topbar); backdrop-filter: blur(8px);
  position: sticky; top: 0; z-index: 100; flex-shrink: 0;
}
.left { display: flex; align-items: baseline; gap: var(--mk-space-3); min-width: 0; }
.title { font-size: var(--mk-font-size-xl); font-weight: 600; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.count { font-size: var(--mk-font-size-sm); color: var(--mk-color-text-faint); flex-shrink: 0; }
.right { display: flex; align-items: center; gap: var(--mk-space-3); flex-shrink: 0; }

.search { display: flex; align-items: center; gap: var(--mk-space-2); width: 260px; height: 38px; padding: 0 var(--mk-space-3) 0 var(--mk-space-4); background: var(--mk-color-bg-card); border: 1px solid var(--mk-color-border-default); border-radius: var(--mk-radius-full); }
.search:focus-within { border-color: var(--mk-color-accent); box-shadow: var(--mk-shadow-focus); }
.search-icon { color: var(--mk-color-text-faint); flex-shrink: 0; }
.search-input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary); }
.search-input::placeholder { color: var(--mk-color-text-faint); }

.sort-dd { position: relative; flex-shrink: 0; }
.sort-trigger {
  display: inline-flex; align-items: center; gap: 5px; height: 36px; padding: 0 var(--mk-space-3);
  background: var(--mk-color-bg-card); border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full); font-size: var(--mk-font-size-sm); color: var(--mk-color-text-secondary);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.sort-trigger:hover { border-color: var(--mk-color-border-strong); color: var(--mk-color-text-primary); }
.sort-caret { transition: transform var(--mk-dur-fast) var(--mk-ease-out); color: var(--mk-color-text-faint); }
.sort-caret.up { transform: rotate(180deg); }
.sort-menu {
  position: absolute; top: calc(100% + 4px); right: 0; min-width: 140px;
  background: var(--mk-color-bg-raised); border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md); box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1); z-index: var(--mk-z-dropdown);
}
.sort-option {
  display: flex; align-items: center; gap: var(--mk-space-2); width: 100%;
  padding: 8px var(--mk-space-2); border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md); color: var(--mk-color-text-primary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.sort-option:hover { background: var(--mk-color-bg-subtle); }
.sort-option.on { color: var(--mk-color-accent); }
.sort-check { margin-left: auto; color: var(--mk-color-accent); }
.menu-enter-active, .menu-leave-active { transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(4px); }

.view-toggle { display: inline-flex; background: var(--mk-color-bg-card); border: 1px solid var(--mk-color-border-default); border-radius: var(--mk-radius-full); padding: 2px; gap: 1px; flex-shrink: 0; }
.vt-btn { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--mk-radius-full); color: var(--mk-color-text-muted); transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.vt-btn:hover { color: var(--mk-color-text-primary); }
.vt-btn.on { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }

.content { flex: 1; min-height: 0; display: flex; overflow: hidden; }
.list-area { flex: 1; min-width: 0; overflow-y: auto; padding: var(--mk-space-5) var(--mk-space-6); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: var(--mk-space-3); }
.list { display: flex; flex-direction: column; gap: 6px; }

.preview-area {
  width: 25%; min-width: 280px; flex-shrink: 0;
  border-left: none;
  background: var(--mk-color-bg-card);
  overflow: hidden; display: flex; flex-direction: column;
}

/* 拖拽分界线 */
.split-handle {
  width: 5px; flex-shrink: 0; cursor: col-resize;
  display: flex; align-items: center; justify-content: center;
  background: var(--mk-color-bg-base);
  border-left: 1px solid var(--mk-color-border-default);
  border-right: 1px solid var(--mk-color-border-default);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
  touch-action: none;
  user-select: none;
}
.split-handle:hover, .split-handle.dragging {
  background: var(--mk-color-accent-soft-bg);
}
.handle-bar {
  width: 2px; height: 32px; border-radius: 1px;
  background: var(--mk-color-border-strong);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.split-handle:hover .handle-bar, .split-handle.dragging .handle-bar {
  background: var(--mk-color-accent);
}

.slide-enter-active, .slide-leave-active { transition: all var(--mk-dur) var(--mk-ease-out); }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateX(20px); }

@media (max-width: 1200px) {
  .split-handle { display: none; }
  .preview-area { position: fixed; right: 0; top: var(--mk-topbar-height); bottom: 0; width: 400px !important; z-index: 50; box-shadow: var(--mk-shadow-popover); }
}
@media (max-width: 768px) {
  .sidebar { display: none; }
  .search { width: 38px; padding: 0; justify-content: center; }
  .search-input { display: none; }
  .search:focus-within { width: auto; flex: 1; padding: 0 var(--mk-space-3) 0 var(--mk-space-4); }
  .search:focus-within .search-input { display: block; }
}
</style>
