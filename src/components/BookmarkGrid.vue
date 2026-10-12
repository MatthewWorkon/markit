<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import draggable from 'vuedraggable'
import type { Bookmark } from '@/types'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import BookmarkCard from '@/components/BookmarkCard.vue'
import BookmarkListRow from '@/components/BookmarkListRow.vue'

const ui = useUiStore()
const data = useDataStore()

/**
 * 内容区：卡片网格 / 两栏分栏列表（v0.3.10）。
 * 拖拽排序仅卡片模式；列表模式复用同一排序列表。
 */
const localList = ref<Bookmark[]>([])
const dragEnabled = computed(() => {
  const v = data.currentView
  return (
    !ui.batchMode &&
    !data.searchQuery.trim() &&
    (v.kind === 'all' || v.kind === 'folder')
  )
})

watch(
  () => [data.visibleBookmarks, ui.batchMode] as const,
  () => {
    localList.value = [...data.visibleBookmarks]
  },
  { immediate: true },
)

async function onDrop() {
  if (!dragEnabled.value) return
  const orderedIds = localList.value.map((b) => b.id)
  const v = data.currentView
  if (v.kind === 'folder') {
    await data.reorderBookmarks('folder', v.folderId, orderedIds)
  } else {
    await data.reorderBookmarks('global', null, orderedIds)
  }
}
</script>

<template>
  <draggable
    v-model="localList"
    item-key="id"
    tag="div"
    class="grid"
    :data-density="ui.density"
    :data-view="ui.viewMode"
    :animation="150"
    :disabled="!dragEnabled"
    @end="onDrop"
  >
    <template #item="{ element, index }">
      <BookmarkCard
        v-if="ui.viewMode === 'grid'"
        :bookmark="element"
        :index="index"
        :draggable-view="dragEnabled"
      />
      <BookmarkListRow
        v-else
        :bookmark="element"
        :index="index"
        :draggable-view="dragEnabled"
      />
    </template>
  </draggable>
</template>

<style scoped>
/* 卡片网格 */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: var(--mk-space-3);
}

.grid[data-density='compact'] {
  grid-template-columns: repeat(auto-fill, minmax(204px, 1fr));
  gap: 10px;
}

/* 两栏分栏列表 */
.grid[data-view='list'] {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 10px;
}

.grid[data-view='list'][data-density='compact'] {
  gap: 4px 8px;
}

@media (max-width: 900px) {
  /* 窄屏退化为单栏列表 */
  .grid[data-view='list'] {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .grid,
  .grid[data-density='compact'] {
    grid-template-columns: 1fr;
  }
}
</style>
