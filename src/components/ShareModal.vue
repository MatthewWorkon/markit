<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { PhCopy, PhEye, PhLockSimple } from '@phosphor-icons/vue'
import { useUiStore } from '@/stores/ui'
import { api } from '@/api'
import ModalBase from '@/components/ModalBase.vue'
import { useI18n } from 'vue-i18n'

const ui = useUiStore()
const { t } = useI18n()

const open = computed(() => ui.shareTarget !== null)

const form = reactive({ withPassword: false, password: '', expiresInDays: 30 })
const creating = ref(false)
const link = ref('')
const err = ref('')

watch(open, (v) => {
  if (v) {
    form.withPassword = false
    form.password = ''
    form.expiresInDays = 30
    link.value = ''
    err.value = ''
  }
})

async function create() {
  if (creating.value || !ui.shareTarget) return
  if (form.withPassword && form.password.length < 4) {
    err.value = t('share.pwTooShort')
    return
  }
  err.value = ''
  creating.value = true
  try {
    const r = await api.post<{ token: string }>('/api/shares', {
      bookmarkId: ui.shareTarget.bookmarkId ?? undefined,
      folderId: ui.shareTarget.folderId ?? undefined,
      skillId: ui.shareTarget.skillId ?? undefined,
      password: form.withPassword ? form.password : undefined,
      expiresInDays: form.expiresInDays || undefined,
    })
    link.value = `${location.origin}/#/s/${r.token}`
    navigator.clipboard?.writeText(link.value)
    ui.toast(t('share.copied'))
  } catch {
    err.value = t('share.createFailed')
  } finally {
    creating.value = false
  }
}

function preview() {
  if (link.value) window.open(link.value, '_blank')
}

function copy() {
  navigator.clipboard?.writeText(link.value)
  ui.toast(t('share.copied'))
}
</script>

<template>
  <ModalBase :open="open" :title="t('share.title')" :width="440" @close="ui.shareTarget = null">
    <div class="body">
      <p class="target">
        {{ ui.shareTarget?.title }}
        <span class="kind">{{ ui.shareTarget?.skillId != null ? t('share.kindSkill') : ui.shareTarget?.bookmarkId != null ? t('share.kindBookmark') : t('share.kindFolder') }}</span>
      </p>

      <template v-if="!link">
        <div class="row">
          <div class="row-meta">
            <strong>{{ t('share.withPassword') }}</strong>
            <span class="hint">{{ t('share.withPasswordHint') }}</span>
          </div>
          <button class="mk-switch" :data-on="form.withPassword" @click="form.withPassword = !form.withPassword" />
        </div>
        <div v-if="form.withPassword" class="field">
          <input
            v-model="form.password"
            type="password"
            class="mk-input"
            :placeholder="t('share.pwPlaceholder')"
            autocomplete="new-password"
          />
        </div>
        <div class="row">
          <div class="row-meta">
            <strong>{{ t('share.expires') }}</strong>
          </div>
          <select v-model="form.expiresInDays" class="mk-input sel">
            <option :value="7">{{ t('share.days7') }}</option>
            <option :value="30">{{ t('share.days30') }}</option>
            <option :value="0">{{ t('share.never') }}</option>
          </select>
        </div>
        <p v-if="err" class="mk-field-error">{{ err }}</p>
        <p class="privacy">{{ t('share.dynamicHint') }}</p>
      </template>

      <template v-else>
        <div class="link-box">
          <input class="mk-input link-input" readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
          <button class="copy-btn" :title="t('share.copy')" @click="copy"><PhCopy :size="15" /></button>
        </div>
        <p class="privacy">{{ t('share.linkReady') }}</p>
      </template>
    </div>

    <template #foot>
      <template v-if="!link">
        <button class="mk-btn-ghost" @click="ui.shareTarget = null">{{ t('common.cancel') }}</button>
        <button class="mk-btn-primary" :disabled="creating" @click="create">
          <PhLockSimple v-if="form.withPassword" :size="14" />
          {{ creating ? t('share.creating') : t('share.create') }}
        </button>
      </template>
      <template v-else>
        <button class="mk-btn-secondary" @click="preview">
          <PhEye :size="14" />
          {{ t('share.preview') }}
        </button>
        <button class="mk-btn-primary" @click="ui.shareTarget = null">{{ t('common.close') }}</button>
      </template>
    </template>
  </ModalBase>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-4);
}

.target {
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
  padding: var(--mk-space-3) var(--mk-space-4);
  background: var(--mk-color-bg-base);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
}

.kind {
  margin-left: var(--mk-space-2);
  font-size: var(--mk-font-size-xs);
  font-weight: 400;
  color: var(--mk-color-text-muted);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-4);
}

.row-meta strong {
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
}

.hint {
  display: block;
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  margin-top: 2px;
}

.sel {
  width: auto;
  min-width: 120px;
  height: 36px;
}

.link-box {
  position: relative;
}

.link-input {
  padding-right: 42px;
  font-family: var(--mk-font-family-mono);
  font-size: var(--mk-font-size-sm);
}

.copy-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-muted);
}

.copy-btn:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.privacy {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  line-height: 1.6;
}
</style>
