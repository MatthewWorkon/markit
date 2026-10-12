<template>
  <div class="grid">
    <div v-for="i in 8" :key="i" class="sk-card">
      <div class="sk-row">
        <div class="mk-skeleton sk-icon" />
        <div class="sk-lines">
          <div class="mk-skeleton sk-line w70" />
          <div class="mk-skeleton sk-line w45" />
        </div>
      </div>
      <div class="mk-skeleton sk-body" />
      <div class="mk-skeleton sk-foot" />
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: var(--mk-space-3);
}

.sk-card {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-3);
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
}

.sk-row {
  display: flex;
  gap: var(--mk-space-3);
  align-items: center;
}

.sk-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  flex-shrink: 0;
}

.sk-lines {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.sk-line {
  height: 11px;
  border-radius: var(--mk-radius-full);
}

.w70 {
  width: 70%;
}

.w45 {
  width: 45%;
}

.sk-body {
  height: 38px;
  border-radius: var(--mk-radius-sm);
}

.sk-foot {
  height: 18px;
  width: 56%;
  border-radius: var(--mk-radius-full);
}
</style>
