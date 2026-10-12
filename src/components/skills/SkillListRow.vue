<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  PhCheck,
  PhBriefcase,
  PhDownloadSimple,
  PhArrowClockwise,
  PhDotsThree,
  PhGlobe,
  PhGithubLogo,
  PhLock,
  PhPencilSimple,
  PhShareNetwork,
  PhStar,
  PhTrash,
  PhUsersThree,
} from '@phosphor-icons/vue'
import type { Skill } from '@/stores/skills'
import { useSkillsStore } from '@/stores/skills'
import { downloadSkillMd } from '@/utils/skill-export'
import { useUiStore } from '@/stores/ui'
import { useHoverPreview } from '@/composables/useHoverPreview'
import { md } from '@/utils/md'

/**
 * Skill 分栏列表行（v0.4.1 对齐书签卡片交互）：
 * hover = 星标 + ··· 菜单（编辑/分享/删除）；右键同菜单。
 */
const props = defineProps<{ skill: Skill; selected?: boolean; readonly?: boolean }>()
const emit = defineEmits<{ click: []; copy: []; batchToggle: [] }>()

const store = useSkillsStore()
const ui = useUiStore()
const { t } = useI18n()

const menuOpen = ref(false)
const root = ref<HTMLElement>()

/** 批量模式选中态（仅 Skills 管理模式） */
const batchSelected = computed(() => ui.batchMode && ui.batchScope === 'skills' && ui.batchIds.has(props.skill.id))

/* 悬停 2s Markdown 预览小窗（v0.4.13） */
const { visible: hpVisible, style: hpStyle, enter: hpEnter, leave: hpLeave, hide: hpHide } = useHoverPreview(2000)
const hpLoading = ref(false)
const hpHtml = ref('')
const hpCache = new Map<number, string>()

function hpOnEnter(e: MouseEvent) {
  if (ui.batchMode) return
  hpEnter(e)
  if (hpCache.has(props.skill.id)) {
    hpHtml.value = md.render(hpCache.get(props.skill.id) || '')
    return
  }
  hpLoading.value = true
  hpHtml.value = ''
  void store
    .getDetail(props.skill.id)
    .then((full) => {
      hpCache.set(props.skill.id, full.content)
      if (hpVisible.value) hpHtml.value = md.render(full.content)
    })
    .catch(() => {})
    .finally(() => {
      hpLoading.value = false
    })
}

/** 广场他人条目收藏切换 */
async function togglePlazaFav() {
  try {
    await store.togglePlazaFavorite(props.skill.id)
  } catch { /* 静默 */ }
}

/** GitHub 来源：检查线上是否有新版 */
async function checkUpdate() {
  menuOpen.value = false
  try {
    const updated = await store.syncFromGithub(props.skill.id)
    ui.toast(updated ? t('skills.syncUpdated') : t('skills.syncLatest'))
  } catch (e) {
    const noPath = (e as { code?: string })?.code === 'no_source_path'
    ui.toast(noPath ? t('skills.syncNoPath') : t('skills.syncFailed'))
  }
}

async function downloadMd() {
  menuOpen.value = false
  try {
    const full = await store.getDetail(props.skill.id)
    downloadSkillMd(props.skill, full.content)
    store.bumpDownload(props.skill.id)
    ui.toast(t('skills.downloaded'))
  } catch { /* 详情拉取失败静默 */ }
}

/** 广场条目：复制到我的库（父级统一处理） */
function copyToLibrary() {
  menuOpen.value = false
  emit('copy')
}

function startEdit() {
  menuOpen.value = false
  ui.editingSkillId = props.skill.id
  ui.addSkillModalOpen = true
}

function startShare() {
  menuOpen.value = false
  ui.shareTarget = { skillId: props.skill.id, title: props.skill.title }
}

function onDelete() {
  menuOpen.value = false
  ui.confirm({
    title: t('skills.deleteConfirmTitle'),
    message: t('skills.deleteConfirmMsg', { title: props.skill.title }),
    onConfirm: () => {
      store.softDelete(props.skill.id)
      ui.toast(t('toast.deleted'))
    },
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
    class="lrow mk-stagger"
    :class="{ selected, 'menu-open': menuOpen, batch: ui.batchMode && ui.batchScope === 'skills', picked: batchSelected }"
    @click="ui.batchMode && ui.batchScope === 'skills' ? (emit('batchToggle'), hpHide()) : ($emit('click'), hpHide())"
    @contextmenu.prevent="!(ui.batchMode && ui.batchScope === 'skills') && (menuOpen = !menuOpen)"
    @mouseenter="hpOnEnter"
    @mouseleave="hpLeave"
  >
    <span
      v-if="ui.batchMode && ui.batchScope === 'skills'"
      class="check"
      :class="{ on: batchSelected }"
      @click.stop="emit('batchToggle')"
    >
      <PhCheck :size="11" weight="bold" />
    </span>
    <span
      v-if="ui.batchMode && ui.batchScope === 'skills'"
      class="check"
      :class="{ on: batchSelected }"
      @click.stop="emit('batchToggle')"
    >
      <PhCheck :size="11" weight="bold" />
    </span>
    <div class="row-top">
      <span class="scope-ico">
        <PhGlobe v-if="skill.scope === 'global'" :size="14" />
        <PhBriefcase v-else :size="14" />
      </span>
      <span class="t mk-clamp-1">{{ skill.title }}</span>
      <span v-if="skill.source === 'github'" class="src"><PhGithubLogo :size="11" /></span>
      <span v-if="skill.isPublic" class="pub"><PhUsersThree :size="10" weight="fill" /></span>
      <span v-else class="priv"><PhLock :size="10" /></span>

      <!-- hover 快捷操作（广场他人条目：星标=收藏） -->
      <div class="quick" @click.stop>
        <button
          class="q-btn"
          :title="skill.favorite ? t('card.unfavorite') : t('card.favorite')"
          @click="readonly ? togglePlazaFav() : store.toggleFavorite(skill.id)"
        >
          <PhStar :size="14" :weight="skill.favorite ? 'fill' : 'regular'" :class="{ starred: skill.favorite }" />
        </button>
        <button class="q-btn" :title="t('common.more')" @click="menuOpen = !menuOpen">
          <PhDotsThree :size="14" weight="bold" />
        </button>
      </div>
    </div>
    <div class="row-bottom">
      <span class="d mk-clamp-1">{{ skill.description || skill.projectName || '—' }}</span>
      <span class="time mk-mono">
        <PhStar v-if="skill.favorite" :size="10" weight="fill" class="star-mark" />
        {{ skill.updatedAt.slice(0, 10) }}
      </span>
    </div>

    <!-- 行菜单 -->
    <Transition name="menu">
      <div v-if="menuOpen" class="menu" role="menu" @click.stop>
        <button v-if="readonly" class="menu-item" @click="togglePlazaFav(); menuOpen = false">
          <PhStar :size="15" :weight="skill.favorite ? 'fill' : 'regular'" :class="{ starred: skill.favorite }" />
          {{ skill.favorite ? t('card.unfavorite') : t('card.favorite') }}
        </button>
        <button v-if="readonly" class="menu-item" @click="copyToLibrary">
          <PhCopySimple :size="15" />
          {{ t('skills.copyToLibrary') }}
        </button>
        <button v-if="!readonly" class="menu-item" @click="startEdit">
          <PhPencilSimple :size="15" />
          {{ t('common.edit') }}
        </button>
        <button v-if="!readonly" class="menu-item" @click="startShare">
          <PhShareNetwork :size="15" />
          {{ t('card.share') }}
        </button>
        <button class="menu-item" @click="downloadMd">
          <PhDownloadSimple :size="15" />
          {{ t('skills.downloadMd') }}
        </button>
        <button v-if="skill.source === 'github' && !readonly" class="menu-item" @click="checkUpdate">
          <PhArrowClockwise :size="15" />
          {{ t('skills.checkUpdate') }}
        </button>
        <template v-if="!readonly">
          <div class="menu-sep" />
          <button class="menu-item danger" @click="onDelete">
            <PhTrash :size="15" />
            {{ t('card.delete') }}
          </button>
        </template>
      </div>
    </Transition>
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="hpVisible" class="hover-preview" :style="hpStyle">
          <div v-if="hpLoading" style="display:flex;flex-direction:column;width:100%;">
            <div class="skel" /><div class="skel sk-70" /><div class="skel sk-85" /><div class="skel sk-60" />
          </div>
          <div v-else class="mini-md" v-html="hpHtml" />
        </div>
      </Transition>
    </Teleport>
  </article>
</template>

<style scoped>
.lrow {
  position: relative;
  display: flex; flex-direction: column; gap: 4px; padding: 10px 14px;
  background: var(--mk-color-bg-card); border: 1px solid var(--mk-color-border-default);
  border-radius: 10px; box-shadow: var(--mk-shadow-card); cursor: pointer;
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.lrow:hover, .lrow.menu-open { border-color: var(--mk-color-border-strong); box-shadow: var(--mk-shadow-card-hover); }
.lrow.menu-open { z-index: 30; }
.lrow.selected { border-color: var(--mk-color-accent); box-shadow: 0 0 0 1px var(--mk-color-accent); }
/* 批量模式（同卡片） */
.lrow.batch:hover { border-color: var(--mk-color-border-default); box-shadow: var(--mk-shadow-card); }
.lrow.batch .quick { display: none; }
.lrow.picked { border-color: var(--mk-color-accent); background: var(--mk-color-accent-soft-bg); }
.check {
  position: absolute; top: 8px; left: 8px; z-index: 5;
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 6px;
  border: 1.5px solid var(--mk-color-border-strong);
  background: var(--mk-color-bg-card); color: transparent;
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}
.check:hover { border-color: var(--mk-color-accent); }
.check.on { background: var(--mk-color-accent); border-color: var(--mk-color-accent); color: #fff; }
.row-top { display: flex; align-items: center; gap: 8px; min-width: 0; padding-right: 4px; }
.scope-ico { color: var(--mk-color-accent-soft-text); flex-shrink: 0; display: inline-flex; }
.t { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; color: var(--mk-color-text-primary); }
.src { color: var(--mk-color-text-muted); flex-shrink: 0; }
.pub { color: var(--mk-color-accent); flex-shrink: 0; }
.priv { color: var(--mk-color-text-faint); flex-shrink: 0; }
/* 公开/私有角标 hover 让位 */
.pub, .priv { transition: opacity var(--mk-dur-fast) var(--mk-ease-out); }
.lrow:hover .pub, .lrow:hover .priv,
.lrow.menu-open .pub, .lrow.menu-open .priv { opacity: 0; }

/* hover 快捷操作 */
.quick {
  display: flex; gap: 2px; padding: 2px; flex-shrink: 0;
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  box-shadow: var(--mk-shadow-card-hover);
  opacity: 0; transform: translateY(-3px);
  transition: opacity var(--mk-dur-fast) var(--mk-ease-out),
    transform var(--mk-dur-fast) var(--mk-ease-out);
}
.lrow:hover .quick, .lrow.menu-open .quick { opacity: 1; transform: translateY(0); }
.q-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: var(--mk-radius-full);
  color: var(--mk-color-text-muted);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}
.q-btn:hover { background: var(--mk-color-bg-subtle); color: var(--mk-color-text-primary); }
.starred { color: #e2a400; }

.row-bottom { display: flex; align-items: center; justify-content: space-between; gap: var(--mk-space-2); min-width: 0; }
.d { flex: 1; min-width: 0; font-size: 12px; color: var(--mk-color-text-secondary); }
.time { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--mk-color-text-faint); flex-shrink: 0; }
.star-mark { color: #e2a700; }

/* 行菜单 */
.menu {
  position: absolute;
  top: 36px;
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
  display: flex; align-items: center; gap: var(--mk-space-2);
  width: 100%; padding: 8px var(--mk-space-2);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-primary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out);
}
.menu-item:hover { background: var(--mk-color-bg-subtle); }
.menu-item.danger { color: var(--mk-color-status-danger-text); }
.menu-item.danger:hover { background: var(--mk-color-status-danger-bg); }
.menu-sep { height: 1px; background: var(--mk-color-border-default); margin: var(--mk-space-1); }
.menu-enter-active, .menu-leave-active { transition: all var(--mk-dur-fast) var(--mk-ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: translateY(4px); }
.fade-enter-active, .fade-leave-active { transition: opacity var(--mk-dur-fast) var(--mk-ease-out); }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
