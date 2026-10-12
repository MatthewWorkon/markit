<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  PhDownloadSimple,
  PhFolderSimple,
  PhStar,
  PhTrash,
  PhX,
} from '@phosphor-icons/vue'
import { useSkillsStore } from '@/stores/skills'
import { useUiStore } from '@/stores/ui'
import { useI18n } from 'vue-i18n'

/**
 * Skills 批量管理底条（v0.4.8，样式同书签 BatchBar）：
 * 移动到分组 / 星标 / 批量删除；>20 条删除需输入「删除」强确认。
 */
const store = useSkillsStore()
const ui = useUiStore()
const { t } = useI18n()

const n = computed(() => ui.batchIds.size)
const folderMenuOpen = ref(false)
const confirmText = ref('')

const HARD_CONFIRM_LIMIT = 20
const needText = computed(() => n.value > HARD_CONFIRM_LIMIT)
const canDelete = computed(() => !needText.value || confirmText.value.trim() === t('batch.hardWord'))

function exit() {
  ui.exitBatch()
  folderMenuOpen.value = false
  confirmText.value = ''
}

function toggleFav() {
  const ids = [...ui.batchIds]
  void store.batch(ids, 'star')
  ui.toast(t('skills.batchStarred', { n: ids.length }))
  exit()
}

function remove() {
  if (!canDelete.value) return
  const ids = [...ui.batchIds]
  store.batch(ids, 'delete')
  ui.toast(t('skills.batchDeleted', { n: ids.length }))
  exit()
}

async function moveTo(folderId: number | null) {
  const ids = [...ui.batchIds]
  await store.batch(ids, 'move', folderId)
  folderMenuOpen.value = false
  ui.toast(t('skills.batchMoved', { n: ids.length }))
  exit()
}

function downloadAll() {
  // 批量导出为逐个 .md 下载（数量大时浏览器会询问允许多个下载）
  const ids = [...ui.batchIds]
  void (async () => {
    for (const id of ids) {
      try {
        const full = await store.getDetail(id)
        const s = store.skills.find((x) => x.id === id)
        if (s) {
          const { downloadSkillMd } = await import('@/utils/skill-export')
          downloadSkillMd(s, full.content)
          store.bumpDownload(id)
        }
      } catch { /* 单个失败跳过 */ }
    }
    ui.toast(t('skills.batchDownloadStarted', { n: ids.length }))
    exit()
  })()
}
</script>

<template>
  <Transition name="bar">
    <div v-if="ui.batchMode && ui.batchScope === 'skills'" class="bar">
      <button class="count" @click="exit">
        {{ t('batch.selected', { n }) }}
        <PhX :size="12" weight="bold" />
      </button>

      <!-- 移动到分组 -->
      <div v-click-outside="() => (folderMenuOpen = false)" class="dd">
        <button class="act" @click="folderMenuOpen = !folderMenuOpen">
          <PhFolderSimple :size="14" />
          {{ t('skills.batchMove') }}
        </button>
        <Transition name="menu">
          <div v-if="folderMenuOpen" class="dd-menu">
            <button class="dd-item" @click="moveTo(null)">{{ t('skills.noFolder') }}</button>
            <button v-for="f in store.folders" :key="f.id" class="dd-item" @click="moveTo(f.id)">
              {{ f.name }}
            </button>
          </div>
        </Transition>
      </div>

      <button class="act" @click="toggleFav">
        <PhStar :size="14" />
        {{ t('skills.batchStar') }}
      </button>

      <button class="act" @click="downloadAll">
        <PhDownloadSimple :size="14" />
        {{ t('skills.downloadMd') }}
      </button>

      <!-- 删除（>20 条强确认） -->
      <div v-click-outside="() => (needText && (confirmText = ''))" class="dd">
        <button class="act danger" @click="needText ? undefined : remove()">
          <PhTrash :size="14" />
          {{ t('batch.delete') }}
        </button>
        <Transition name="menu">
          <div v-if="needText" class="dd-menu confirm-box">
            <p class="cf-tip">{{ t('skills.batchDeleteWarn', { n }) }}</p>
            <input
              v-model="confirmText"
              class="cf-input"
              :placeholder="t('batch.hardWord')"
              @keyup.enter="remove"
            />
            <button class="cf-btn" :disabled="!canDelete" @click="remove">{{ t('common.confirm') }}</button>
          </div>
        </Transition>
      </div>

      <button class="act exit" @click="exit">
        <PhX :size="14" />
        {{ t('batch.exit') }}
      </button>
    </div>
  </Transition>
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
  white-space: nowrap;
}

.count {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px var(--mk-space-3);
  margin-right: var(--mk-space-2);
  border-radius: var(--mk-radius-md);
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  color: var(--mk-color-text-primary);
  background: var(--mk-color-bg-subtle);
}

.act {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px var(--mk-space-3);
  border-radius: var(--mk-radius-md);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-secondary);
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.act:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.act.danger,
.exit {
  color: var(--mk-color-status-danger-text);
}

.act.danger:hover,
.exit:hover {
  background: var(--mk-color-status-danger-bg);
}

.dd {
  position: relative;
}

.dd-menu {
  position: absolute;
  bottom: calc(100% + var(--mk-space-2));
  left: 50%;
  transform: translateX(-50%);
  min-width: 150px;
  background: var(--mk-color-bg-raised);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-popover);
  padding: var(--mk-space-1);
  z-index: var(--mk-z-dropdown);
}

.dd-item {
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

.dd-item:hover {
  background: var(--mk-color-bg-subtle);
}

.confirm-box {
  min-width: 230px;
  padding: var(--mk-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-2);
  transform: none;
  left: auto;
  right: 0;
}

.cf-tip {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-status-danger-text);
  line-height: 1.5;
}

.cf-input {
  height: 34px;
  padding: 0 var(--mk-space-2);
  font-size: var(--mk-font-size-md);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-sm);
  outline: none;
  color: var(--mk-color-text-primary);
}

.cf-btn {
  padding: 7px 0;
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  background: var(--mk-color-status-danger-text);
  color: #fff;
}

.cf-btn:disabled {
  opacity: 0.4;
}

.bar-enter-active,
.bar-leave-active {
  transition: all var(--mk-dur) var(--mk-ease-out);
}

.bar-enter-from,
.bar-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(10px);
}

.menu-enter-active,
.menu-leave-active {
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.menu-enter-from,
.menu-leave-to {
  opacity: 0;
  transform: translate(-50%, 4px);
}
</style>
