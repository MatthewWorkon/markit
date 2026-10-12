<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { PhArrowRight, PhLockSimple } from '@phosphor-icons/vue'
import BrandMark from '@/components/BrandMark.vue'
import { setLocale } from '@/i18n'
import { api, ApiError } from '@/api'
import { useI18n } from 'vue-i18n'

const { t, locale } = useI18n()

const mode = ref<'login' | 'register'>('login')
const form = reactive({ username: '', password: '' })
const error = ref('')
const submitting = ref(false)

/** admin 首登强制改密（BK-018 决策） */
const mustChange = ref(false)
const pwForm = reactive({ next: '', confirm: '' })
const pwError = ref('')

/** 登录：用户名 ≥3 位即可提交（内置 admin 初始密码为 4 位）；注册：密码 ≥8 位 */
const canSubmit = computed(() =>
  form.username.trim().length >= 3 &&
  (isLogin.value || form.password.length >= 8),
)

const errMsg = (code: string) => {
  const map: Record<string, string> = {
    bad_credentials: t('login.badCredentials'),
    username_taken: t('login.usernameTaken'),
    username_rule: t('login.usernameRule'),
    password_rule: t('login.passwordRule'),
    locked: t('login.locked'),
  }
  return map[code] ?? t('login.failed')
}

async function submit() {
  if (!canSubmit.value || submitting.value) return
  error.value = ''
  submitting.value = true
  try {
    const path = mode.value === 'login' ? '/api/auth/login' : '/api/auth/register'
    const { user } = await api.post<{ user: { username: string; nickname: string; isAdmin: boolean; mustChangePassword: boolean } }>(path, form)
    if (user.mustChangePassword) {
      mustChange.value = true
      return
    }
    sessionStorage.setItem('markit.auth', '1')
    location.hash = '#/'
  } catch (e) {
    error.value = e instanceof ApiError ? errMsg(e.code) : t('login.failed')
  } finally {
    submitting.value = false
  }
}

async function changePassword() {
  if (pwForm.next.length < 8) {
    pwError.value = t('settings.passwordTooShort')
    return
  }
  if (pwForm.next !== pwForm.confirm) {
    pwError.value = t('settings.passwordMismatch')
    return
  }
  pwError.value = ''
  submitting.value = true
  try {
    await api.patch('/api/auth/me', { password: { current: form.password, next: pwForm.next } })
    sessionStorage.setItem('markit.auth', '1')
    location.hash = '#/'
  } catch (e) {
    pwError.value = e instanceof ApiError ? errMsg(e.code) : t('login.failed')
  } finally {
    submitting.value = false
  }
}

const isLogin = computed(() => mode.value === 'login')

/** 注册是否开放（站点设置控制） */
const registerOpen = ref(true)
onMounted(async () => {
  try {
    const r = await fetch('/api/auth/register-status')
    const d = await r.json()
    registerOpen.value = d.open !== false
  } catch { /* 默认开放 */ }
})

function switchLang() {
  setLocale(locale.value === 'zh-CN' ? 'en' : 'zh-CN')
}
</script>

<template>
  <div class="page">
    <div class="lang">
      <button class="lang-btn" @click="switchLang">
        {{ locale === 'zh-CN' ? 'English' : '简体中文' }}
      </button>
    </div>

    <!-- 首登强制改密 -->
    <main v-if="mustChange" class="card mk-anim-fade-up">
      <div class="brand-row">
        <BrandMark :size="44" />
      </div>
      <h1 class="title">{{ t('login.mustChangeTitle') }}</h1>
      <p class="subtitle">{{ t('login.mustChangeSub', { name: form.username }) }}</p>

      <form class="form" @submit.prevent="changePassword">
        <div class="field">
          <label class="mk-label" for="pw-new">{{ t('settings.newPassword') }}</label>
          <input id="pw-new" v-model="pwForm.next" class="mk-input" type="password" autocomplete="new-password" />
        </div>
        <div class="field">
          <label class="mk-label" for="pw-confirm">{{ t('settings.confirmPassword') }}</label>
          <input id="pw-confirm" v-model="pwForm.confirm" class="mk-input" type="password" autocomplete="new-password" />
          <p v-if="pwError" class="mk-field-error">{{ pwError }}</p>
        </div>
        <button class="submit mk-btn-primary" type="submit" :disabled="submitting">
          <PhLockSimple :size="15" weight="bold" />
          {{ t('login.setPassword') }}
        </button>
      </form>
    </main>

    <!-- 登录 / 注册 -->
    <main v-else class="card mk-anim-fade-up">
      <div class="brand-row">
        <BrandMark :size="44" />
      </div>
      <h1 class="title">{{ isLogin ? t('login.welcome') : t('login.createTitle') }}</h1>
      <p class="subtitle">{{ isLogin ? t('login.welcomeSub') : t('login.createSub') }}</p>

      <form class="form" @submit.prevent="submit">
        <div class="field">
          <label class="mk-label" for="login-username">{{ t('login.username') }}</label>
          <input
            id="login-username"
            v-model="form.username"
            class="mk-input"
            type="text"
            autocomplete="username"
            spellcheck="false"
          />
        </div>
        <div class="field">
          <label class="mk-label" for="login-password">{{ t('login.password') }}</label>
          <input
            id="login-password"
            v-model="form.password"
            class="mk-input"
            type="password"
            :autocomplete="isLogin ? 'current-password' : 'new-password'"
          />
          <p v-if="!isLogin" class="mk-field-error">{{ t('login.passwordRule') }}</p>
        </div>

        <p v-if="error" class="mk-field-error">{{ error }}</p>

        <button
          class="submit mk-btn-primary"
          type="submit"
          :disabled="!canSubmit || submitting"
          :class="{ pending: submitting }"
        >
          {{ isLogin ? t('login.submitLogin') : t('login.submitRegister') }}
          <PhArrowRight :size="15" weight="bold" />
        </button>
      </form>

      <button v-if="registerOpen || !isLogin" class="switch" @click="mode = isLogin ? 'register' : 'login'; error = ''">
        {{ isLogin ? t('login.toRegister') : t('login.toLogin') }}
      </button>
      <p v-else class="mk-field-error">{{ t('login.registerClosed') }}</p>

      <p v-if="isLogin" class="demo-hint mk-mono">{{ t('login.demoHint') }}</p>
    </main>

    <footer class="foot">Markit · self-hosted on your NAS</footer>
  </div>
</template>

<style scoped>
.page {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--mk-space-6);
  position: relative;
}

.lang {
  position: absolute;
  top: var(--mk-space-5);
  right: var(--mk-space-6);
}

.lang-btn {
  height: 32px;
  padding: 0 var(--mk-space-4);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  background: var(--mk-color-bg-card);
  transition: color var(--mk-dur-fast) var(--mk-ease-out),
    border-color var(--mk-dur-fast) var(--mk-ease-out);
}

.lang-btn:hover {
  color: var(--mk-color-text-primary);
  border-color: var(--mk-color-border-strong);
}

.card {
  width: 100%;
  max-width: 384px;
  padding: var(--mk-space-7) var(--mk-space-7) var(--mk-space-6);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-lg);
  box-shadow: var(--mk-shadow-card);
}

.brand-row {
  display: flex;
  margin-bottom: var(--mk-space-5);
}

.title {
  font-size: var(--mk-font-size-2xl);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.subtitle {
  margin-top: var(--mk-space-2);
  margin-bottom: var(--mk-space-6);
  font-size: var(--mk-font-size-md);
  line-height: 1.6;
  color: var(--mk-color-text-muted);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-4);
}

.submit {
  margin-top: var(--mk-space-2);
  height: 42px;
  font-size: 15px;
}

.submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.submit.pending {
  opacity: 0.7;
  pointer-events: none;
}

.switch {
  margin-top: var(--mk-space-5);
  width: 100%;
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-muted);
  transition: color var(--mk-dur-fast) var(--mk-ease-out);
}

.switch:hover {
  color: var(--mk-color-accent);
}

.demo-hint {
  margin-top: var(--mk-space-4);
  padding-top: var(--mk-space-4);
  border-top: 1px dashed var(--mk-color-border-default);
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
  text-align: center;
}

.foot {
  margin-top: var(--mk-space-6);
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
  letter-spacing: 0.02em;
}
</style>
