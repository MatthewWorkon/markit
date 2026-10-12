<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import MarkdownIt from 'markdown-it'
import { PhGlobe, PhKey, PhLockSimple } from '@phosphor-icons/vue'
import BrandMark from '@/components/BrandMark.vue'
import FaviconTile from '@/components/FaviconTile.vue'

/**
 * 访客只读分享页（BK-105）：免登录。
 * 公开链接直接展示；密码链接输入一次密码后展示。
 * v0.4.1：kind=skill 时渲染 Markdown 正文。
 */
const route = useRoute()
const token = route.params.token as string

const md = new MarkdownIt({ html: true, linkify: true, breaks: true })

interface SharedItem {
  id: number; title: string; url: string; description: string
  favicon: string | null; needVpn: boolean; createdAt: string
  content?: string
}

const state = ref<'loading' | 'pw' | 'ready' | 'gone'>('loading')
const meta = ref<{ title: string; kind: string; count: number } | null>(null)
const items = ref<SharedItem[]>([])
const password = ref('')
const wrong = ref(false)
const submitting = ref(false)

const skillContent = computed(() => {
  if (meta.value?.kind !== 'skill') return ''
  return md.render(items.value[0]?.content || '')
})

async function loadMeta() {
  try {
    const r = await fetch(`/api/share/${token}/meta`)
    if (!r.ok) {
      state.value = 'gone'
      return
    }
    const m = await r.json()
    meta.value = m
    state.value = m.needPassword ? 'pw' : 'ready'
    if (!m.needPassword) await view()
  } catch {
    state.value = 'gone'
  }
}

async function view() {
  wrong.value = false
  submitting.value = true
  try {
    const r = await fetch(`/api/share/${token}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value || undefined }),
    })
    if (r.status === 404) {
      state.value = 'gone'
      return
    }
    if (r.status === 401) {
      wrong.value = true
      return
    }
    const data = await r.json()
    items.value = data.items
    if (meta.value) meta.value.title = data.title
    state.value = 'ready'
  } catch {
    /* 网络错误停留在当前态 */
  } finally {
    submitting.value = false
  }
}

onMounted(loadMeta)
</script>

<template>
  <div class="page">
    <header class="head">
      <BrandMark :size="24" />
      <span class="brand">Markit</span>
      <span class="sep">·</span>
      <span class="shared">{{ state === 'ready' ? 'Shared' : '' }}</span>
    </header>

    <main class="card-wrap mk-anim-fade-up">
      <!-- 加载 -->
      <div v-if="state === 'loading'" class="center">
        <div class="mk-skeleton sk-line w40" />
        <div class="mk-skeleton sk-line w70" />
      </div>

      <!-- 失效 -->
      <div v-else-if="state === 'gone'" class="center">
        <PhGlobe :size="30" weight="thin" class="glyph" />
        <h1 class="h">{{ $t('share.goneTitle') }}</h1>
        <p class="sub">{{ $t('share.goneSub') }}</p>
      </div>

      <!-- 密码 -->
      <div v-else-if="state === 'pw'" class="center pw">
        <div class="glyph-ring"><PhLockSimple :size="22" weight="regular" /></div>
        <h1 class="h">{{ meta?.title || $t('share.protected') }}</h1>
        <p class="sub">{{ $t('share.pwPrompt', { n: meta?.count ?? 0 }) }}</p>
        <form class="pw-form" @submit.prevent="view">
          <input
            v-model="password"
            type="password"
            class="mk-input"
            :placeholder="$t('share.pwEnter')"
            :class="{ wrong: wrong }"
            autofocus
          />
          <button class="mk-btn-primary" type="submit" :disabled="submitting">
            <PhKey :size="14" />
            {{ $t('share.unlock') }}
          </button>
        </form>
        <p v-if="wrong" class="mk-field-error">{{ $t('share.pwWrong') }}</p>
      </div>

      <!-- 内容 -->
      <template v-else>
        <div class="list-head">
          <h1 class="title">{{ meta?.title }}</h1>
          <span v-if="meta?.kind !== 'skill'" class="count mk-mono">{{ items.length }}</span>
          <span v-else class="kind-badge">Skill</span>
        </div>

        <!-- Skill 分享：Markdown 正文 -->
        <div v-if="meta?.kind === 'skill'" class="md-body" v-html="skillContent" />

        <!-- 书签/分组分享：卡片网格 -->
        <div v-else class="grid">
          <a
            v-for="b in items"
            :key="b.id"
            :href="b.url"
            target="_blank"
            rel="noopener"
            class="item"
          >
            <div class="item-head">
              <FaviconTile :src="b.favicon" :title="b.title" :size="26" :radius="7" />
              <div class="item-text">
                <h3 class="item-title mk-clamp-1">{{ b.title }}</h3>
                <span class="item-url mk-mono mk-clamp-1">{{ b.url.replace(/^https?:\/\//, '').split('/')[0] }}</span>
              </div>
              <span v-if="b.needVpn" class="vpn mk-badge">VPN</span>
            </div>
            <p v-if="b.description" class="item-desc mk-clamp-2">{{ b.description }}</p>
          </a>
        </div>
        <p class="foot-note">{{ $t('share.footer') }}</p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.page {
  min-height: 100dvh;
  background: var(--mk-color-bg-base);
  padding: var(--mk-space-6) var(--mk-space-4) var(--mk-space-8);
}

.head {
  max-width: 980px;
  margin: 0 auto var(--mk-space-5);
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  color: var(--mk-color-text-secondary);
  font-size: var(--mk-font-size-md);
}

.brand {
  font-weight: 600;
  color: var(--mk-color-text-primary);
}

.sep {
  color: var(--mk-color-text-faint);
}

.shared {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  padding: 1px 8px;
  border-radius: var(--mk-radius-full);
}

.card-wrap {
  max-width: 980px;
  margin: 0 auto;
}

.center {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--mk-space-8) var(--mk-space-4);
  gap: var(--mk-space-2);
}

.glyph {
  color: var(--mk-color-text-muted);
  margin-bottom: var(--mk-space-2);
}

.glyph-ring {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--mk-radius-full);
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-muted);
  margin-bottom: var(--mk-space-3);
}

.h {
  font-size: var(--mk-font-size-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.sub {
  color: var(--mk-color-text-muted);
}

.pw-form {
  margin-top: var(--mk-space-4);
  display: flex;
  gap: var(--mk-space-2);
  width: min(360px, 100%);
}

.pw-form .mk-input.wrong {
  border-color: var(--mk-color-status-danger);
}

.sk-line {
  height: 14px;
  border-radius: var(--mk-radius-full);
}

.w40 { width: 40%; }
.w70 { width: 70%; }

.list-head {
  display: flex;
  align-items: baseline;
  gap: var(--mk-space-3);
  margin-bottom: var(--mk-space-4);
}

.title {
  font-size: var(--mk-font-size-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.count {
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-faint);
}

.kind-badge {
  font-size: var(--mk-font-size-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  padding: 2px 10px;
  border-radius: var(--mk-radius-full);
}

/* Skill 分享的 Markdown 正文（与 Skills 预览同风格） */
.md-body { font-size: 15px; line-height: 1.8; color: var(--mk-color-text-primary); }
.md-body :deep(h1) { font-size: 1.6em; font-weight: 600; margin: 1.2em 0 0.6em; border-bottom: 1px solid var(--mk-color-border-default); padding-bottom: 0.3em; }
.md-body :deep(h2) { font-size: 1.3em; font-weight: 600; margin: 1.2em 0 0.5em; }
.md-body :deep(h3) { font-size: 1.1em; font-weight: 600; margin: 1em 0 0.4em; }
.md-body :deep(p) { margin: 0.6em 0; }
.md-body :deep(ul), .md-body :deep(ol) { padding-left: 1.5em; margin: 0.5em 0; }
.md-body :deep(code) { font-family: var(--mk-font-family-mono); font-size: 0.9em; background: var(--mk-color-bg-subtle); padding: 2px 6px; border-radius: 4px; }
.md-body :deep(pre) { background: var(--mk-color-bg-subtle); padding: var(--mk-space-4); border-radius: 8px; overflow-x: auto; margin: 0.8em 0; }
.md-body :deep(pre code) { background: none; padding: 0; }
.md-body :deep(blockquote) { border-left: 3px solid var(--mk-color-accent); padding-left: var(--mk-space-4); margin: 0.8em 0; color: var(--mk-color-text-secondary); }
.md-body :deep(a) { color: var(--mk-color-accent); text-decoration: none; }
.md-body :deep(a:hover) { text-decoration: underline; }
.md-body :deep(hr) { border: none; border-top: 1px solid var(--mk-color-border-default); margin: 1.5em 0; }
.md-body :deep(table) { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
.md-body :deep(th), .md-body :deep(td) { border: 1px solid var(--mk-color-border-default); padding: 6px 10px; text-align: left; }
.md-body :deep(th) { background: var(--mk-color-bg-subtle); font-weight: 500; }
.md-body :deep(img) { max-width: 100%; border-radius: 8px; }

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--mk-space-3);
}

.item {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-2);
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  box-shadow: var(--mk-shadow-card);
  transition: transform var(--mk-dur) var(--mk-ease-out),
    box-shadow var(--mk-dur) var(--mk-ease-out);
}

.item:hover {
  transform: translateY(-2px);
  box-shadow: var(--mk-shadow-card-hover);
}

.item-head {
  display: flex;
  align-items: flex-start;
  gap: var(--mk-space-2);
}

.item-text {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
  line-height: 1.35;
}

.item-url {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
}

.vpn {
  background: var(--mk-color-badge-vpn-bg);
  color: var(--mk-color-badge-vpn-text);
  flex-shrink: 0;
}

.item-desc {
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-secondary);
  min-height: calc(2 * 1.55em);
}

.foot-note {
  margin-top: var(--mk-space-6);
  text-align: center;
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-faint);
}
</style>
