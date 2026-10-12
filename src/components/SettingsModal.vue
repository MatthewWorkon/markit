<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PhDatabase,
  PhGearSix,
  PhShareNetwork,
  PhEye,
  PhEyeSlash,
  PhPassword,
  PhCopySimple,
  PhPuzzlePiece,
  PhInfo,
  PhLayout,
  PhLockSimple,
  PhPalette,
  PhSealCheck,
  PhSparkle,
  PhTrash,
  PhUploadSimple,
  PhUserCircle,
  PhUsersThree,
} from '@phosphor-icons/vue'
import { useDataStore } from '@/stores/data'
import { useUiStore } from '@/stores/ui'
import { api, ApiError } from '@/api'
import ModalBase from '@/components/ModalBase.vue'
import { setLocale } from '@/i18n'
import { useI18n } from 'vue-i18n'

const data = useDataStore()
const ui = useUiStore()
const { t, locale } = useI18n()

const open = computed(() => ui.settingsOpen)

type PaneId = 'account' | 'security' | 'appearance' | 'layout' | 'data' | 'shares' | 'extapi' | 'users' | 'ai' | 'site' | 'about'
const pane = ref<PaneId>('account')

const panes = computed(() => {
  const list: { id: PaneId; label: string; icon: unknown }[] = [
    { id: 'account', label: t('settings.account'), icon: PhUserCircle },
    { id: 'security', label: t('settings.security'), icon: PhLockSimple },
    { id: 'appearance', label: t('settings.appearance'), icon: PhPalette },
    { id: 'layout', label: t('settings.layout'), icon: PhLayout },
    { id: 'data', label: t('settings.data'), icon: PhDatabase },
    { id: 'shares', label: t('settings.shares'), icon: PhShareNetwork },
    { id: 'extapi', label: t('settings.extApi'), icon: PhPuzzlePiece },
  ]
  if (data.user.isAdmin) {
    list.push({ id: 'users', label: t('settings.users'), icon: PhUsersThree })
    list.push({ id: 'ai', label: t('settings.aiService'), icon: PhSparkle })
    list.push({ id: 'site', label: t('settings.site'), icon: PhGearSix })
  }
  list.push({ id: 'about', label: t('settings.about'), icon: PhInfo })
  return list
})

/* ---- 账号 ---- */
const nickname = ref(data.user.nickname)
async function saveAccount() {
  await api.patch('/api/auth/me', { nickname: nickname.value.trim() || data.user.username })
  data.user.nickname = nickname.value.trim() || data.user.username
  ui.toast(t('common.save'))
}

/* ---- 安全 ---- */
const pw = ref({ current: '', next: '', confirm: '' })
const pwError = ref('')
async function changePassword() {
  if (pw.value.next.length < 8) {
    pwError.value = t('settings.passwordTooShort')
    return
  }
  if (pw.value.next !== pw.value.confirm) {
    pwError.value = t('settings.passwordMismatch')
    return
  }
  pwError.value = ''
  try {
    await api.patch('/api/auth/me', { password: { current: pw.value.current, next: pw.value.next } })
    pw.value = { current: '', next: '', confirm: '' }
    ui.toast(t('settings.passwordChanged'))
  } catch (e) {
    pwError.value = e instanceof ApiError && e.code === 'current_wrong'
      ? t('settings.currentPasswordWrong')
      : t('settings.passwordTooShort')
  }
}

/* ---- 外观 ---- */
const lang = computed({
  get: () => locale.value as 'zh-CN' | 'en',
  set: (v: 'zh-CN' | 'en') => setLocale(v),
})

/* ---- 数据管理：导入 / 导出 ---- */
const importFile = ref<HTMLInputElement>()
const importResult = ref<{ added: number; skipped: number } | null>(null)

async function onImport(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const html = await file.text()
  try {
    importResult.value = await api.post('/api/import', { html })
    await data.bootstrap()
  } catch {
    ui.toast(t('settings.importFailed'))
  }
  ;(e.target as HTMLInputElement).value = ''
}

function exportData(format: 'json' | 'html') {
  const a = document.createElement('a')
  a.href = `/api/export?format=${format}`
  a.click()
}

/* ---- 关于：最近两版更新说明 ---- */
// 「最近更新」= 每个「已上传部署到 NAS」的版本一条汇总（本地改动不逐版刷新，
// 等明确告知部署了 vX 才整理该版至今的改动上去——2026-10-11 用户确认）。
// 「最近更新」= 每个「已上传部署到 NAS」的版本一条汇总（2026-10-11 用户确认）。
// 当前 NAS 基线 v0.4.7（2026-10-11 部署，含 0.3.12→0.4.7 全部内容）。
const recentChanges = [
  {
    version: 'v0.4.13',
    lines: [
      t('cl.v0413a'),
    ],
  },
  {
    version: 'v0.4.12',
    lines: [
      t('cl.v049a'),
      t('cl.v048a'),
      t('cl.v048b'),
      t('cl.v048c'),
      t('cl.v048d'),
      t('cl.v048e'),
      t('cl.v047deployed'),
    ],
  },
]

/* ---- 我的分享（BK-105） ---- */
interface ShareRow {
  id: number; token: string; kind: string; title: string; count: number
  needPassword: boolean; expiresAt: string | null; createdAt: string
}
const myShares = ref<ShareRow[]>([])

async function loadShares() {
  try {
    myShares.value = await api.get('/api/shares')
  } catch { /* 静默 */ }
}

function copyShareLink(token: string) {
  navigator.clipboard?.writeText(`${location.origin}/#/s/${token}`)
  ui.toast(t('share.copied'))
}

function revokeShare(row: ShareRow) {
  ui.confirm({
    title: t('share.revokeTitle'),
    message: t('share.revokeMsg', { name: row.title }),
    onConfirm: async () => {
      await api.delete(`/api/shares/${row.token}`)
      myShares.value = myShares.value.filter((x) => x.token !== row.token)
    },
  })
}

/* ---- 扩展与 API Token（BK-108） ---- */
interface TokenRow { id: number; name: string; created_at: string; last_used_at: string | null }
const apiTokens = ref<TokenRow[]>([])
const newTokenName = ref('')
const showGuide = ref(false)
const creatingToken = ref(false)

async function loadTokens() {
  try {
    apiTokens.value = await api.get('/api/tokens')
  } catch { /* 静默 */ }
}

async function createToken() {
  if (creatingToken.value) return
  creatingToken.value = true
  try {
    const r = await api.post<{ id: number; name: string; token: string }>('/api/tokens', {
      name: newTokenName.value.trim() || undefined,
    })
    navigator.clipboard?.writeText(r.token)
    ui.confirm({
      title: t('ext.tokenCreated'),
      message: t('ext.tokenOnce', { token: r.token }),
      onConfirm: () => navigator.clipboard?.writeText(r.token),
    })
    newTokenName.value = ''
    await loadTokens()
  } finally {
    creatingToken.value = false
  }
}

function revokeToken(row: TokenRow) {
  ui.confirm({
    title: t('ext.revokeTitle'),
    message: t('ext.revokeMsg', { name: row.name }),
    onConfirm: async () => {
      await api.delete(`/api/tokens/${row.id}`)
      apiTokens.value = apiTokens.value.filter((x) => x.id !== row.id)
    },
  })
}

/* ---- 站点设置（admin） ---- */
const siteAllowRegister = ref(true)
const siteVpnCheck = ref(true)

async function loadSite() {
  if (!data.user.isAdmin) return
  try {
    const r = await api.get<{ allowRegister: boolean; vpnCheck: boolean }>('/api/settings/site')
    siteAllowRegister.value = r.allowRegister
    siteVpnCheck.value = r.vpnCheck
  } catch { /* 静默 */ }
}

async function saveSite() {
  await api.put('/api/settings/site', {
    allowRegister: siteAllowRegister.value,
    vpnCheck: siteVpnCheck.value,
  })
  ui.toast(t('common.save'))
}

/* ---- admin 重置用户密码 ---- */
async function resetUserPassword(u: { username: string }) {
  try {
    const r = await api.post<{ tempPassword: string }>(`/api/admin/users/${u.username}/reset-password`)
    ui.confirm({
      title: t('settings.resetPwTitle'),
      message: t('settings.resetPwMsg', { name: u.username, pw: r.tempPassword }),
      onConfirm: () => navigator.clipboard?.writeText(r.tempPassword),
    })
  } catch { /* 静默 */ }
}

/* ---- 用户管理（admin，真实 API，BK-018） ---- */
const mockUsers = ref<Array<{ username: string; nickname: string; count: number; role: 'admin' | 'user'; created: string }>>([])

async function loadUsers() {
  if (!data.user.isAdmin) return
  mockUsers.value = await api.get('/api/admin/users')
}

function deleteUser(u: (typeof mockUsers.value)[number]) {
  ui.confirm({
    title: t('confirm.deleteUserTitle'),
    message: t('confirm.deleteUser', { name: u.username }),
    onConfirm: async () => {
      await api.delete(`/api/admin/users/${u.username}`)
      mockUsers.value = mockUsers.value.filter((x) => x.username !== u.username)
      ui.toast(`${t('settings.deleteUser')}: @${u.username}`)
    },
  })
}

/* ---- AI 服务（admin，/api/settings/ai） ---- */
const AI_PROVIDERS = [
  { key: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { key: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { key: 'doubao', name: '豆包 · 火山方舟', base: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { key: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'custom', name: '', base: '', model: '' }, // 名称取 i18n
]

const aiEnabled = ref(true)
const aiProvider = ref('zhipu')
const aiBase = ref('')
const aiModel = ref('')
const aiKey = ref('')
const aiKeyMask = ref('') // 已绑定时显示末 4 位
const aiShowKey = ref(false)
const aiTesting = ref(false)
const aiTestResult = ref<{ ok: boolean; msg: string } | null>(null)

/** 打开设置时从服务端读取；服务端缺省字段用选中提供方的预设回填 */
async function loadAiSettings() {
  if (!data.user.isAdmin) return
  try {
    const s = await api.get<{ enabled: boolean; provider: string; baseUrl: string; model: string; hasKey: boolean; keyMasked: string | null }>(
      '/api/settings/ai',
    )
    aiEnabled.value = s.enabled
    aiProvider.value = s.provider || 'zhipu'
    const preset = AI_PROVIDERS.find((x) => x.key === aiProvider.value)
    aiBase.value = s.baseUrl || preset?.base || ''
    aiModel.value = s.model || preset?.model || ''
    aiKeyMask.value = s.keyMasked ?? ''
    aiKey.value = ''
    aiTestResult.value = null
  } catch { /* 静默 */ }
}

function pickProvider(key: string) {
  aiProvider.value = key
  const p = AI_PROVIDERS.find((x) => x.key === key)
  if (p && key !== 'custom') {
    aiBase.value = p.base
    aiModel.value = p.model
  }
  aiTestResult.value = null
}

async function testAi() {
  if (aiTesting.value) return
  aiTesting.value = true
  aiTestResult.value = null
  try {
    const r = await api.post<{ ok: boolean; ms?: number; error?: string }>('/api/settings/ai/test', {
      baseUrl: aiBase.value,
      apiKey: aiKey.value || undefined,
    })
    aiTestResult.value = r.ok
      ? { ok: true, msg: t('settings.aiTestOk', { ms: r.ms ?? 0 }) }
      : { ok: false, msg: t('settings.aiTestFail', { msg: r.error ?? 'unknown' }) }
  } catch (e) {
    aiTestResult.value = { ok: false, msg: t('settings.aiTestFail', { msg: e instanceof Error ? e.message : '' }) }
  } finally {
    aiTesting.value = false
  }
}

async function saveAi() {
  // 兜底：地址/模型留空时用选中提供方的预设补齐，避免存入空值导致生成不可用
  const preset = AI_PROVIDERS.find((x) => x.key === aiProvider.value)
  const base = aiBase.value.trim() || (aiProvider.value !== 'custom' ? preset?.base || '' : '')
  const model = aiModel.value.trim() || (aiProvider.value !== 'custom' ? preset?.model || '' : '')
  await api.put('/api/settings/ai', {
    enabled: aiEnabled.value,
    provider: aiProvider.value,
    baseUrl: base,
    model,
    apiKey: aiKey.value.trim() || undefined,
  })
  aiBase.value = base
  aiModel.value = model
  if (aiKey.value.trim()) aiKeyMask.value = aiKey.value.trim().slice(-4)
  aiKey.value = ''
  ui.toast(t('settings.aiSaved'))
}

function clearAiKey() {
  aiKeyMask.value = ''
  aiKey.value = ''
  api.put('/api/settings/ai', { apiKey: '' }).catch(() => {})
  aiTestResult.value = null
}

/** 打开设置弹窗时加载 */
watch(open, (v) => {
  if (v) {
    loadUsers()
    loadAiSettings()
    loadShares()
    loadSite()
    loadTokens()
  }
})
</script>

<template>
  <ModalBase :open="open" :title="t('settings.title')" :width="720" @close="ui.settingsOpen = false">
    <div class="settings">
      <!-- 左导航 -->
      <nav class="snav">
        <button
          v-for="p in panes"
          :key="p.id"
          class="snav-item"
          :class="{ active: pane === p.id }"
          @click="pane = p.id"
        >
          <component :is="p.icon" :size="16" />
          <span class="snav-label">{{ p.label }}</span>
          <span v-if="p.id === 'users'" class="snav-badge mk-mono">admin</span>
        </button>
      </nav>

      <!-- 右内容 -->
      <div class="spane">
        <!-- 账号 -->
        <section v-if="pane === 'account'" class="pane-body mk-anim-fade-up">
          <div class="avatar-row">
            <span class="avatar-xl">{{ data.user.nickname[0] }}</span>
            <div class="avatar-meta">
              <strong>{{ data.user.nickname }}</strong>
              <span class="mk-mono">@{{ data.user.username }}</span>
            </div>
          </div>
          <div class="field">
            <label class="mk-label" for="set-nickname">{{ t('settings.nickname') }}</label>
            <input id="set-nickname" v-model="nickname" class="mk-input" type="text" />
          </div>
          <div class="field">
            <label class="mk-label">{{ t('settings.username') }}</label>
            <input class="mk-input" type="text" :value="data.user.username" disabled />
          </div>
          <button class="mk-btn-primary self-start" @click="saveAccount">{{ t('common.save') }}</button>
        </section>

        <!-- 安全 -->
        <section v-else-if="pane === 'security'" class="pane-body mk-anim-fade-up">
          <h3 class="pane-title">{{ t('settings.changePassword') }}</h3>
          <div class="field">
            <label class="mk-label" for="pw-cur">{{ t('settings.currentPassword') }}</label>
            <input id="pw-cur" v-model="pw.current" class="mk-input" type="password" autocomplete="current-password" />
          </div>
          <div class="field">
            <label class="mk-label" for="pw-new">{{ t('settings.newPassword') }}</label>
            <input id="pw-new" v-model="pw.next" class="mk-input" type="password" autocomplete="new-password" />
          </div>
          <div class="field">
            <label class="mk-label" for="pw-confirm">{{ t('settings.confirmPassword') }}</label>
            <input id="pw-confirm" v-model="pw.confirm" class="mk-input" type="password" autocomplete="new-password" />
            <p v-if="pwError" class="mk-field-error">{{ pwError }}</p>
          </div>
          <button class="mk-btn-primary self-start" @click="changePassword">
            {{ t('settings.changePassword') }}
          </button>
        </section>

        <!-- 外观 -->
        <section v-else-if="pane === 'appearance'" class="pane-body mk-anim-fade-up">
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.language') }}</strong>
            </div>
            <div class="seg">
              <button class="seg-btn" :class="{ on: lang === 'zh-CN' }" @click="lang = 'zh-CN'">简体中文</button>
              <button class="seg-btn" :class="{ on: lang === 'en' }" @click="lang = 'en'">English</button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.theme') }}</strong>
            </div>
            <div class="seg">
              <button class="seg-btn" :class="{ on: ui.theme === 'light' }" @click="ui.setTheme('light')">
                {{ t('settings.themeLight') }}
              </button>
              <button class="seg-btn" :class="{ on: ui.theme === 'dark' }" @click="ui.setTheme('dark')">
                {{ t('settings.themeDark') }}
              </button>
              <button class="seg-btn" :class="{ on: ui.theme === 'system' }" @click="ui.setTheme('system')">
                {{ t('settings.themeSystem') }}
              </button>
            </div>
          </div>
        </section>

        <!-- 布局 -->
        <section v-else-if="pane === 'layout'" class="pane-body mk-anim-fade-up">
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.gridDensity') }}</strong>
            </div>
            <div class="seg">
              <button class="seg-btn" :class="{ on: ui.density === 'comfortable' }" @click="ui.density = 'comfortable'">
                {{ t('settings.densityComfortable') }}
              </button>
              <button class="seg-btn" :class="{ on: ui.density === 'compact' }" @click="ui.density = 'compact'">
                {{ t('settings.densityCompact') }}
              </button>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.defaultSort') }}</strong>
            </div>
            <div class="seg">
              <button class="seg-btn" :class="{ on: data.sortMode === 'newest' }" @click="data.setSortMode('newest')">
                {{ t('settings.sortNewest') }}
              </button>
              <button class="seg-btn" :class="{ on: data.sortMode === 'oldest' }" @click="data.setSortMode('oldest')">
                {{ t('settings.sortOldest') }}
              </button>
              <button class="seg-btn" :class="{ on: data.sortMode === 'visits' }" @click="data.setSortMode('visits')">
                {{ t('settings.sortVisits') }}
              </button>
              <button class="seg-btn" :class="{ on: data.sortMode === 'manual' }" @click="data.setSortMode('manual')">
                {{ t('settings.sortManual') }}
              </button>
            </div>
          </div>
        </section>

        <!-- 数据管理 -->
        <section v-else-if="pane === 'data'" class="pane-body mk-anim-fade-up">
          <div class="data-block">
            <div class="data-meta">
              <strong>{{ t('settings.importTitle') }}</strong>
              <span>{{ t('settings.importHint') }}</span>
            </div>
            <button class="mk-btn-secondary" @click="importFile?.click()">
              <PhUploadSimple :size="15" />
              {{ t('settings.importBtn') }}
            </button>
            <input
              ref="importFile"
              type="file"
              accept=".html,.htm"
              class="hidden-file"
              @change="onImport"
            />
          </div>
          <p v-if="importResult" class="test-result ok">
            {{ t('settings.importDone', { added: importResult.added, skipped: importResult.skipped }) }}
          </p>
          <div class="data-block">
            <div class="data-meta">
              <strong>{{ t('settings.exportTitle') }}</strong>
            </div>
            <div class="row-gap">
              <button class="mk-btn-secondary" @click="exportData('json')">{{ t('settings.exportJson') }}</button>
              <button class="mk-btn-secondary" @click="exportData('html')">{{ t('settings.exportHtml') }}</button>
            </div>
          </div>
          <div class="csv-note">
            <PhDatabase :size="16" class="csv-icon" />
            <div>
              <strong>{{ t('settings.csvTitle') }}</strong>
              <p>{{ t('settings.csvHint') }}</p>
              <code class="mk-mono">/data/bookmarks-mirror.csv</code>
            </div>
          </div>
        </section>

        <!-- 用户管理（admin） -->
        <section v-else-if="pane === 'users'" class="pane-body mk-anim-fade-up">
          <p class="users-hint">{{ t('settings.usersHint') }}</p>
          <table class="users">
            <thead>
              <tr>
                <th>{{ t('settings.userHeaderName') }}</th>
                <th>{{ t('settings.userHeaderNickname') }}</th>
                <th class="num">{{ t('settings.userHeaderCount') }}</th>
                <th>{{ t('settings.userHeaderRole') }}</th>
                <th>{{ t('settings.userHeaderCreated') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in mockUsers" :key="u.username" :class="{ self: u.username === data.user.username }">
                <td class="mk-mono">{{ u.username }}</td>
                <td>{{ u.nickname }}</td>
                <td class="num mk-mono">{{ u.count }}</td>
                <td>
                  <span class="role mk-badge" :class="{ admin: u.role === 'admin' }">
                    <PhSealCheck v-if="u.role === 'admin'" :size="11" weight="fill" />
                    {{ u.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleUser') }}
                  </span>
                </td>
                <td class="mk-mono muted">{{ u.created }}</td>
                <td class="num acts">
                  <button
                    v-if="u.role !== 'admin' && u.username !== data.user.username"
                    class="act-icon"
                    :title="t('settings.resetPw')"
                    @click="resetUserPassword(u)"
                  >
                    <PhPassword :size="14" />
                  </button>
                  <button
                    v-if="u.role !== 'admin' && u.username !== data.user.username"
                    class="act-icon danger"
                    :title="t('settings.deleteUserConfirm')"
                    @click="deleteUser(u)"
                  >
                    <PhTrash :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 我的分享 -->
        <section v-else-if="pane === 'shares'" class="pane-body mk-anim-fade-up">
          <p v-if="!myShares.length" class="users-hint">{{ t('share.none') }}</p>
          <table v-else class="users">
            <thead>
              <tr>
                <th>{{ t('share.colContent') }}</th>
                <th class="num">{{ t('share.colCount') }}</th>
                <th>{{ t('share.colMode') }}</th>
                <th>{{ t('share.colCreated') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in myShares" :key="row.token">
                <td class="share-title">
                  {{ row.title }}
                  <span class="kind-tag">{{ row.kind === 'skill' ? t('share.kindSkill') : row.kind === 'folder' ? t('share.kindFolder') : t('share.kindBookmark') }}</span>
                </td>
                <td class="num mk-mono">{{ row.count }}</td>
                <td>{{ row.needPassword ? '🔒' : t('share.modePublic') }}</td>
                <td class="mk-mono muted">{{ row.createdAt.slice(0, 10) }}</td>
                <td class="num acts">
                  <button class="act-icon" :title="t('share.copy')" @click="copyShareLink(row.token)">
                    <PhCopySimple :size="14" />
                  </button>
                  <button class="act-icon danger" :title="t('share.revoke')" @click="revokeShare(row)">
                    <PhTrash :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 扩展与 API -->
        <section v-else-if="pane === 'extapi'" class="pane-body mk-anim-fade-up">
          <!-- 扩展下载渠道 -->
          <div class="ext-download">
            <PhDownloadSimple :size="18" class="dl-icon" />
            <div class="dl-meta">
              <strong>{{ t('ext.downloadTitle') }}</strong>
              <span>{{ t('ext.downloadHint') }}</span>
            </div>
            <div class="dl-actions">
              <a class="mk-btn-secondary dl-btn" href="/downloads/markit-extension.zip" download>
                <PhDownloadSimple :size="14" />
                {{ t('ext.downloadZip') }}
              </a>
              <button class="mk-btn-ghost dl-btn-ghost" @click="showGuide = !showGuide">
                {{ showGuide ? t('ext.guideHide') : t('ext.guideShow') }}
              </button>
            </div>
          </div>
          <div v-if="showGuide" class="guide-box">
            <ol>
              <li>{{ t('ext.g1') }}</li>
              <li>{{ t('ext.g2') }}</li>
              <li>{{ t('ext.g3') }}</li>
              <li>{{ t('ext.g4') }}</li>
            </ol>
            <p class="guide-tip">{{ t('ext.gTip') }}</p>
          </div>

          <p class="users-hint">{{ t('ext.hint') }}</p>
          <div class="data-block">
            <div class="data-meta">
              <strong>{{ t('ext.newToken') }}</strong>
              <span>{{ t('ext.newTokenHint') }}</span>
            </div>
            <div class="row-gap">
              <input v-model="newTokenName" class="mk-input token-name" type="text" :placeholder="t('ext.namePlaceholder')" />
              <button class="mk-btn-primary" :disabled="creatingToken" @click="createToken">
                {{ creatingToken ? t('ext.creating') : t('ext.create') }}
              </button>
            </div>
          </div>
          <table v-if="apiTokens.length" class="users">
            <thead>
              <tr>
                <th>{{ t('ext.colName') }}</th>
                <th>{{ t('ext.colCreated') }}</th>
                <th>{{ t('ext.colLastUsed') }}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in apiTokens" :key="row.id">
                <td>{{ row.name }}</td>
                <td class="mk-mono muted">{{ row.created_at.slice(0, 10) }}</td>
                <td class="mk-mono muted">{{ row.last_used_at ? row.last_used_at.slice(5, 16) : t('ext.never') }}</td>
                <td class="num">
                  <button class="act-icon danger" :title="t('ext.revoke')" @click="revokeToken(row)">
                    <PhTrash :size="14" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="users-hint">{{ t('ext.none') }}</p>
        </section>

        <!-- 站点设置（admin） -->
        <section v-else-if="pane === 'site'" class="pane-body mk-anim-fade-up">
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.allowRegister') }}</strong>
              <span class="meta-hint">{{ t('settings.allowRegisterHint') }}</span>
            </div>
            <button class="mk-switch" :data-on="siteAllowRegister" @click="siteAllowRegister = !siteAllowRegister" />
          </div>
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.vpnCheck') }}</strong>
              <span class="meta-hint">{{ t('settings.vpnCheckHint') }}</span>
            </div>
            <button class="mk-switch" :data-on="siteVpnCheck" @click="siteVpnCheck = !siteVpnCheck" />
          </div>
          <button class="mk-btn-primary self-start" @click="saveSite">{{ t('common.save') }}</button>
        </section>

        <!-- AI 服务（admin） -->
        <section v-else-if="pane === 'ai'" class="pane-body mk-anim-fade-up">
          <div class="setting-row">
            <div class="setting-meta">
              <strong>{{ t('settings.aiEnable') }}</strong>
              <span class="meta-hint">{{ t('settings.aiEnableHint') }}</span>
            </div>
            <button class="mk-switch" :data-on="aiEnabled" @click="aiEnabled = !aiEnabled" />
          </div>

          <div class="field">
            <label class="mk-label">{{ t('settings.aiProvider') }}</label>
            <div class="provider-row">
              <button
                v-for="p in AI_PROVIDERS"
                :key="p.key"
                type="button"
                class="provider-pill"
                :class="{ on: aiProvider === p.key }"
                @click="pickProvider(p.key)"
              >
                {{ p.key === 'custom' ? t('settings.aiCustom') : p.name }}
              </button>
            </div>
          </div>

          <div class="field">
            <label class="mk-label" for="ai-base">{{ t('settings.aiBase') }}</label>
            <input id="ai-base" v-model="aiBase" class="mk-input mk-mono-input" type="text" spellcheck="false" autocomplete="off" />
          </div>

          <div class="field">
            <label class="mk-label" for="ai-key">{{ t('settings.aiKey') }}</label>
            <div class="key-row">
              <input
                id="ai-key"
                v-model="aiKey"
                class="mk-input mk-mono-input"
                :type="aiShowKey ? 'text' : 'password'"
                :placeholder="aiKeyMask ? t('settings.aiKeyMasked', { mask: aiKeyMask }) : t('settings.aiKeyPlaceholder')"
                spellcheck="false"
                autocomplete="off"
              />
              <button class="key-eye" type="button" :title="aiShowKey ? t('common.hide') : t('common.show')" @click="aiShowKey = !aiShowKey">
                <PhEyeSlash v-if="aiShowKey" :size="16" />
                <PhEye v-else :size="16" />
              </button>
            </div>
            <div v-if="aiKeyMask" class="key-saved">
              <span class="mk-mono">••••{{ aiKeyMask }}</span>
              <button type="button" class="key-clear" @click="clearAiKey">{{ t('settings.aiKeyClear') }}</button>
            </div>
          </div>

          <div class="field">
            <label class="mk-label" for="ai-model">{{ t('settings.aiModel') }}</label>
            <input id="ai-model" v-model="aiModel" class="mk-input mk-mono-input" type="text" :placeholder="t('settings.aiModelPlaceholder')" spellcheck="false" autocomplete="off" />
          </div>

          <div class="row-gap">
            <button class="mk-btn-secondary" :disabled="aiTesting" @click="testAi">
              {{ aiTesting ? t('settings.aiTesting') : t('settings.aiTest') }}
            </button>
            <button class="mk-btn-primary" @click="saveAi">{{ t('common.save') }}</button>
          </div>

          <p v-if="aiTestResult" class="test-result" :class="aiTestResult.ok ? 'ok' : 'fail'">
            {{ aiTestResult.msg }}
          </p>

          <div class="privacy-note">
            <PhInfo :size="15" class="privacy-icon" />
            <p>{{ t('settings.aiPrivacy') }}</p>
          </div>
        </section>

        <!-- 关于 -->
        <section v-else class="pane-body mk-anim-fade-up">
          <div class="about">
            <span class="about-mark">M</span>
            <p>{{ t('settings.aboutText') }}</p>
            <code class="mk-mono">v0.4.13</code>
          </div>
          <div class="changelog-block">
            <strong class="cl-title">{{ t('settings.recentUpdates') }}</strong>
            <div v-for="c in recentChanges" :key="c.version" class="cl-item">
              <span class="cl-ver mk-mono">{{ c.version }}</span>
              <ul class="cl-list">
                <li v-for="(line, li) in c.lines" :key="li">{{ line }}</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
.settings {
  display: flex;
  margin: calc(-1 * var(--mk-space-6));
  min-height: 420px;
}

/* 左导航 */
.snav {
  width: 184px;
  flex-shrink: 0;
  padding: var(--mk-space-4) var(--mk-space-3);
  border-right: 1px solid var(--mk-color-border-default);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.snav-item {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  padding: 8px var(--mk-space-3);
  border-radius: var(--mk-radius-sm);
  font-size: var(--mk-font-size-md);
  color: var(--mk-color-text-secondary);
  text-align: left;
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.snav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snav-item:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.snav-item.active {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
  font-weight: 500;
}

.snav-item.active svg {
  color: var(--mk-color-accent);
}

.snav-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  padding: 1px 6px;
  border-radius: var(--mk-radius-full);
}

/* AI 服务面板 */
.meta-hint {
  display: block;
  margin-top: 2px;
  font-size: var(--mk-font-size-sm);
  font-weight: 400;
  color: var(--mk-color-text-muted);
}

.provider-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--mk-space-2);
}

.provider-pill {
  height: 30px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-sm);
  font-weight: 500;
  color: var(--mk-color-text-secondary);
  background: var(--mk-color-bg-card);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-full);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.provider-pill:hover {
  border-color: var(--mk-color-border-strong);
  color: var(--mk-color-text-primary);
}

.provider-pill.on {
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  border-color: var(--mk-color-accent);
}

.mk-mono-input {
  font-family: var(--mk-font-family-mono);
  font-size: var(--mk-font-size-md);
}

.key-row {
  position: relative;
}

.key-row .mk-input {
  padding-right: 40px;
}

.key-eye {
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
  transition: background var(--mk-dur-fast) var(--mk-ease-out),
    color var(--mk-dur-fast) var(--mk-ease-out);
}

.key-eye:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.key-saved {
  display: flex;
  align-items: center;
  gap: var(--mk-space-2);
  margin-top: var(--mk-space-1);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-status-success-text);
}

.key-clear {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  text-decoration: underline;
  transition: color var(--mk-dur-fast) var(--mk-ease-out);
}

.key-clear:hover {
  color: var(--mk-color-status-danger-text);
}

.test-result {
  font-size: var(--mk-font-size-sm);
  line-height: 1.5;
}

.test-result.ok {
  color: var(--mk-color-status-success-text);
}

.test-result.fail {
  color: var(--mk-color-status-danger-text);
}

.privacy-note {
  display: flex;
  gap: var(--mk-space-2);
  padding: var(--mk-space-3) var(--mk-space-4);
  border: 1px dashed var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
}

.privacy-note p {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  line-height: 1.6;
}

.privacy-icon {
  color: var(--mk-color-text-faint);
  margin-top: 2px;
  flex-shrink: 0;
}

/* 右面板 */
.spane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: var(--mk-space-5) var(--mk-space-6);
}

.pane-body {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-4);
  max-width: 480px;
}

.pane-title {
  font-size: var(--mk-font-size-lg);
  font-weight: 600;
}

.self-start {
  align-self: flex-start;
}

/* 账号 */
.avatar-row {
  display: flex;
  align-items: center;
  gap: var(--mk-space-4);
  padding-bottom: var(--mk-space-2);
}

.avatar-xl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: var(--mk-radius-full);
  background: var(--mk-tag-1-bg);
  color: var(--mk-tag-1-text);
  font-size: 22px;
  font-weight: 600;
}

.avatar-meta {
  display: flex;
  flex-direction: column;
  line-height: 1.4;
}

.avatar-meta strong {
  font-size: var(--mk-font-size-xl);
  font-weight: 600;
}

.avatar-meta span {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
}

/* 通用设置行 */
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-4);
  padding: var(--mk-space-2) 0;
}

.setting-meta strong {
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
}

/* 分段控件 */
.seg {
  display: inline-flex;
  padding: 2px;
  background: var(--mk-color-bg-subtle);
  border-radius: var(--mk-radius-full);
}

.seg-btn {
  height: 28px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-sm);
  font-weight: 500;
  color: var(--mk-color-text-muted);
  border-radius: var(--mk-radius-full);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.seg-btn.on {
  background: var(--mk-color-bg-card);
  color: var(--mk-color-text-primary);
  box-shadow: 0 1px 3px rgba(26, 26, 23, 0.1);
}

.seg-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 数据管理 */
.data-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--mk-space-4);
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-base);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
}

.data-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.data-meta strong {
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
}

.data-meta span {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
}

.row-gap {
  display: flex;
  gap: var(--mk-space-2);
  flex-shrink: 0;
}

.csv-note {
  display: flex;
  gap: var(--mk-space-3);
  padding: var(--mk-space-4);
  border: 1px dashed var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  line-height: 1.5;
}

.csv-note strong {
  font-size: var(--mk-font-size-md);
  font-weight: 500;
}

.csv-note p {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
  margin: 2px 0 6px;
}

.csv-note code {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  padding: 2px 8px;
  border-radius: var(--mk-radius-full);
}

.csv-icon {
  color: var(--mk-color-text-faint);
  margin-top: 3px;
  flex-shrink: 0;
}

/* 用户管理 */
.users-hint {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
}

.users {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--mk-font-size-md);
}

.users th {
  padding: var(--mk-space-2) var(--mk-space-2);
  font-size: var(--mk-font-size-xs);
  font-weight: 500;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--mk-color-text-faint);
  text-align: left;
  border-bottom: 1px solid var(--mk-color-border-default);
  white-space: nowrap;
}

.users td {
  padding: var(--mk-space-3) var(--mk-space-2);
  border-bottom: 1px solid var(--mk-color-border-default);
}

.users tr.self td {
  background: var(--mk-color-bg-base);
}

.num {
  text-align: right;
}

.muted {
  color: var(--mk-color-text-muted);
  font-size: var(--mk-font-size-sm);
}

.role {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-secondary);
}

.role.admin {
  background: var(--mk-color-accent-soft-bg);
  color: var(--mk-color-accent-soft-text);
}

.acts {
  white-space: nowrap;
}

.act-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-left: 4px;
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.act-icon:hover {
  background: var(--mk-color-bg-subtle);
  color: var(--mk-color-text-primary);
}

.act-icon.danger:hover {
  background: var(--mk-color-status-danger-bg);
  color: var(--mk-color-status-danger-text);
}

.kind-tag {
  margin-left: 6px;
  font-size: 10px;
  color: var(--mk-color-text-muted);
  background: var(--mk-color-bg-subtle);
  padding: 1px 6px;
  border-radius: var(--mk-radius-full);
}

.share-title {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--mk-radius-sm);
  color: var(--mk-color-text-muted);
  transition: all var(--mk-dur-fast) var(--mk-ease-out);
}

.del:hover {
  background: var(--mk-color-status-danger-bg);
  color: var(--mk-color-status-danger-text);
}

/* 关于 */
.about {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--mk-space-3);
  padding: var(--mk-space-2) 0;
}

.changelog-block {
  margin-top: var(--mk-space-2);
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-base);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
}

.cl-title {
  display: block;
  font-size: var(--mk-font-size-md);
  font-weight: 500;
  margin-bottom: var(--mk-space-3);
}

.cl-item {
  display: flex;
  align-items: baseline;
  gap: var(--mk-space-2);
  padding: var(--mk-space-1) 0;
}

.cl-ver {
  font-size: var(--mk-font-size-sm);
  font-weight: 600;
  color: var(--mk-color-accent-soft-text);
  background: var(--mk-color-accent-soft-bg);
  padding: 1px 8px;
  border-radius: var(--mk-radius-full);
  flex-shrink: 0;
}

.cl-list {
  list-style: none;
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-secondary);
  flex: 1;
}

.about-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--mk-color-accent);
  color: var(--mk-color-text-inverse);
  font-size: 22px;
  font-weight: 600;
}

.about p {
  color: var(--mk-color-text-secondary);
  line-height: 1.7;
}

.about code {
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-faint);
}

.ext-download {
  display: flex;
  align-items: center;
  gap: var(--mk-space-3);
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-base);
  border: 1px solid var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
}

.dl-icon {
  color: var(--mk-color-accent);
  flex-shrink: 0;
}

.dl-meta {
  flex: 1;
  min-width: 0;
}

.dl-meta strong {
  display: block;
  font-size: var(--mk-font-size-lg);
  font-weight: 500;
}

.dl-meta span {
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-muted);
}

.dl-actions {
  display: flex;
  flex-direction: column;
  gap: var(--mk-space-1);
  flex-shrink: 0;
}

.dl-btn {
  text-decoration: none;
  height: 32px;
  padding: 0 var(--mk-space-3);
  font-size: var(--mk-font-size-sm);
}

.dl-btn-ghost {
  height: 26px;
  font-size: var(--mk-font-size-sm);
}

.guide-box {
  padding: var(--mk-space-4);
  background: var(--mk-color-bg-base);
  border: 1px dashed var(--mk-color-border-default);
  border-radius: var(--mk-radius-md);
  font-size: var(--mk-font-size-sm);
  color: var(--mk-color-text-secondary);
}

.guide-box ol {
  padding-left: 18px;
  line-height: 2;
}

.guide-tip {
  margin-top: var(--mk-space-2);
  font-size: var(--mk-font-size-xs);
  color: var(--mk-color-text-muted);
}

.token-name {
  width: 160px;
}

.hidden-file {
  display: none;
}

/* 移动端：导航变横向滚动 */
@media (max-width: 640px) {
  .settings {
    flex-direction: column;
    min-height: 0;
  }

  .snav {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid var(--mk-color-border-default);
    padding: var(--mk-space-2) var(--mk-space-3);
  }

  .snav-item {
    white-space: nowrap;
  }
}
</style>
