<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import Sidebar from '@/components/Sidebar.vue'
import TopBar from '@/components/TopBar.vue'
import BookmarkGrid from '@/components/BookmarkGrid.vue'
import EmptyState from '@/components/EmptyState.vue'
import SkeletonGrid from '@/components/SkeletonGrid.vue'
import BookmarkFormModal from '@/components/BookmarkFormModal.vue'
import BatchBar from '@/components/BatchBar.vue'

const data = useDataStore()
const ui = useUiStore()

/** 首屏骨架 → bootstrap 拉取真实数据 */
const loading = ref(true)
onMounted(async () => {
  await data.bootstrap()
  loading.value = false
})
</script>

<template>
  <div class="shell">
    <!-- 桌面侧栏 / 移动端抽屉 -->
    <div
      class="sidebar-layer"
      :class="{ open: ui.mobileSidebarOpen }"
      @click.self="ui.mobileSidebarOpen = false"
    >
      <Sidebar />
    </div>
    <div
      v-if="ui.mobileSidebarOpen"
      class="sidebar-mask"
      @click="ui.mobileSidebarOpen = false"
    />

    <main class="main">
      <TopBar />
      <div class="content">
        <SkeletonGrid v-if="loading" />
        <BookmarkGrid v-else-if="data.visibleBookmarks.length" :key="JSON.stringify(data.currentView) + data.searchQuery" />
        <EmptyState v-else />
      </div>
    </main>

    <BookmarkFormModal />
    <BatchBar />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100dvh;      /* 应用式布局：整页不滚动 */
  overflow: hidden;
}

.sidebar-layer {
  flex-shrink: 0;
}

.sidebar-mask {
  display: none;
}

.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;    /* 滚动内聚：只有内容区滚，顶栏恒定且滚动条不穿过它 */
  padding: var(--mk-space-5) var(--mk-space-6) var(--mk-space-8);
  width: 100%;
}

@media (max-width: 768px) {
  .sidebar-layer {
    position: fixed;
    inset: 0 auto 0 0;
    width: var(--mk-sidebar-width);
    transform: translateX(-100%);
    transition: transform var(--mk-dur) var(--mk-ease-out);
    z-index: var(--mk-z-modal);
  }

  .sidebar-layer.open {
    transform: translateX(0);
    box-shadow: var(--mk-shadow-modal);
  }

  .sidebar-mask {
    display: block;
    position: fixed;
    inset: 0;
    background: var(--mk-color-bg-overlay);
    z-index: calc(var(--mk-z-modal) - 1);
  }

  .content {
    padding: var(--mk-space-4) var(--mk-space-4) var(--mk-space-6);
  }
}
</style>
