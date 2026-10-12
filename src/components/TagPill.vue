<script setup lang="ts">
import { computed } from 'vue'
import { tagPalette } from '@/utils/format'

const props = defineProps<{ name: string }>()
const p = computed(() => tagPalette(props.name))
</script>

<template>
  <span class="tag" :data-p="p"># {{ name }}</span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  font-size: var(--mk-font-size-xs);
  font-weight: 500;
  line-height: 1;
  border-radius: var(--mk-radius-full);
  white-space: nowrap;
}

.tag[data-p='1'] {
  background: var(--mk-tag-1-bg);
  color: var(--mk-tag-1-text);
}

.tag[data-p='2'] {
  background: var(--mk-tag-2-bg);
  color: var(--mk-tag-2-text);
}

.tag[data-p='3'] {
  background: var(--mk-tag-3-bg);
  color: var(--mk-tag-3-text);
}

.tag[data-p='4'] {
  background: var(--mk-tag-4-bg);
  color: var(--mk-tag-4-text);
}

.tag[data-p='5'] {
  background: var(--mk-tag-5-bg);
  color: var(--mk-tag-5-text);
}
</style>
