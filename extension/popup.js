/* Markit 扩展 · Popup：配置 / 即点即收藏 / 编辑 */

const $app = document.getElementById('app')
const $scroll = document.getElementById('app-scroll')
const $open = document.getElementById('openSite')

function el(html) {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstChild
}

async function cfg() {
  const { nasUrl, token } = await chrome.storage.local.get(['nasUrl', 'token'])
  return { nasUrl: (nasUrl || '').replace(/\/+$/, ''), token: token || '' }
}

/** 配置草稿：popup 会被 Chrome 随时关闭（点击外部即关），输入实时落盘防丢 */
async function draft() {
  const { dUrl, dToken } = await chrome.storage.local.get(['dUrl', 'dToken'])
  return { dUrl: dUrl || '', dToken: dToken || '' }
}
function watchDraft(urlIn, tokIn) {
  urlIn.addEventListener('input', () => chrome.storage.local.set({ dUrl: urlIn.value }))
  tokIn.addEventListener('input', () => chrome.storage.local.set({ dToken: tokIn.value }))
}

/** 带超时与错误分类的请求；永不悬挂 */
async function api(path, init = {}) {
  const { nasUrl, token } = await cfg()
  if (!nasUrl) throw { kind: 'no_url' }
  try {
    const r = await fetch(nasUrl + path, {
      ...init,
      signal: AbortSignal.timeout(8000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
        ...init.headers,
      },
    })
    const data = await r.json().catch(() => ({}))
    return { status: r.status, data }
  } catch (e) {
    throw { kind: 'network', detail: e?.message || '' }
  }
}

/* ---------- 配置视图 ---------- */
async function renderSetup(prefill = '') {
  $app.innerHTML = ''
  $open.style.display = 'none'
  const saved = await cfg()
  const draftState = await draft()

  $app.append(
    el(
      `<p class="hint">站点地址 = 你平时访问 Markit 的网址（每个自托管实例不同）。API Token 与你的账号绑定，决定扩展以哪个用户身份收藏。两者都可在 Markit 网页端「设置 → 扩展与 API」管理。</p>`,
    ),
  )

  // 当前绑定状态（已配置过时显示，让用户知道现在绑的是什么）
  const boundRow = el(`<div class="bound"></div>`)
  if (saved.nasUrl && saved.token) {
    boundRow.append(
      el(
        `<div class="bound-line">当前绑定：<b>${escapeHtml(saved.nasUrl)}</b>（Token 尾4位 ${escapeHtml(saved.token.slice(-4))}）</div>`,
      ),
    )
  }

  const urlIn = el(`<input placeholder="https://your-markit.example.com" spellcheck="false" />`)
  urlIn.value = prefill || draftState.dUrl || saved.nasUrl || ''
  const tokIn = el(`<input placeholder="mk_…" spellcheck="false" autocomplete="off" />`)
  if (!saved.token && draftState.dToken) tokIn.value = draftState.dToken
  const autoBtn = el(`<button class="mini" type="button">从当前标签页填充</button>`)
  const urlLabelRow = el(`<div class="label-row"><label>站点地址</label></div>`)
  urlLabelRow.append(autoBtn)
  const tokLabel = el(`<div><label>API Token${saved.token ? '（留空 = 不修改）' : ''}</label></div>`)

  const btn = el(`<button class="btn primary" style="width:100%">保存并测试连接</button>`)
  const status = el(`<p class="status loading" style="display:none"></p>`)
  const err = el(`<p class="status err" style="display:none"></p>`)
  const clearBtn = el(`<button class="btn ghost" style="width:100%">清除本机全部配置（回到未绑定状态）</button>`)
  clearBtn.onclick = async () => {
    await chrome.storage.local.remove(['nasUrl', 'token', 'dUrl', 'dToken'])
    renderSetup()
  }

  autoBtn.onclick = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.url && /^https?:\/\//i.test(tab.url)) {
        urlIn.value = new URL(tab.url).origin
        autoBtn.textContent = '已填充 ✓'
        setTimeout(() => (autoBtn.textContent = '从当前标签页填充'), 1500)
      }
    } catch {
      /* ignore */
    }
  }

  btn.onclick = async () => {
    const url = urlIn.value.trim()
    const tok = tokIn.value.trim()
    err.style.display = 'none'
    if (!/^https?:\/\//i.test(url)) {
      err.textContent = '地址需以 http(s):// 开头'
      err.style.display = 'block'
      return
    }
    if (!tok && !saved.token) {
      err.textContent = '请填入 API Token（Markit 网页端「设置 → 扩展与 API」生成）'
      err.style.display = 'block'
      return
    }
    btn.disabled = true
    status.className = 'status loading'
    status.style.display = 'block'
    status.innerHTML = '<span class="spin">◌</span> 正在测试连接…'
    try {
      await chrome.storage.local.set({ nasUrl: url, token: tok })
      const { status: code } = await api('/api/ext/check?url=https://example.com')
      if (code === 200) {
        chrome.storage.local.remove(['dUrl', 'dToken'])
        status.style.display = 'none'
        setTimeout(renderMain, 250)
        return
      }
      err.textContent =
        code === 401
          ? '连接成功，但 Token 无效——请到 Markit「设置 → 扩展与 API」重新生成后填入'
          : `服务返回错误（${code}），请确认地址正确`
      err.style.display = 'block'
    } catch (e) {
      err.textContent = '无法连接：请确认地址正确、NAS 已开机且公网通道正常'
      err.style.display = 'block'
    } finally {
      btn.disabled = false
    }
  }

  $app.append(
    boundRow,
    el(`<div class="divider"></div>`),
    urlLabelRow,
    urlIn,
    el(`<div style="height:8px"></div>`),
    tokLabel,
    tokIn,
    el(`<div class="divider"></div>`),
    btn,
    status,
    err,
    el(`<div class="divider" style="margin-top:10px"></div>`),
    clearBtn,
  )
}

/* ---------- 主视图 ---------- */
/** 失败提示旁的「重新配置」入口 */
function addReconfig() {
  const re = el(`<button class="btn ghost">重新配置 →</button>`)
  re.onclick = renderSetup
  $app.append(re)
}

/** 头部齿轮：任何视图都能进入配置（改绑/解绑） */
function addGearToHead() {
  const head = document.querySelector('.head')
  if (!head || head.querySelector('.gear')) return
  const gear = el(`<button class="gear" title="扩展配置（修改地址 / Token）">⚙</button>`)
  gear.onclick = renderSetup
  head.appendChild(gear)
}

async function renderMain() {
  addGearToHead()
  const { nasUrl } = await cfg()
  $open.style.display = ''
  $open.href = nasUrl

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    $app.innerHTML = ''
    $app.append(el(`<div class="status err">此页面类型不支持收藏（仅 http/https）</div>`))
    return
  }

  $app.innerHTML = ''
  const status = el(`<div class="status loading"><span class="spin">◌</span> 正在收藏…</div>`)
  const titleIn = el(`<input />`)
  titleIn.value = tab.title || ''
  const descIn = el(`<textarea placeholder="简介（可选）"></textarea>`)
  const urlRow = el(`<div class="url-row"></div>`)
  urlRow.textContent = tab.url
  const saveBtn = el(`<button class="btn primary" style="display:none">保存修改</button>`)
  $app.append(
    status,
    el(`<label>标题</label>`),
    titleIn,
    el(`<label>简介</label>`),
    descIn,
    urlRow,
  )

  // 打开即收藏（无感），随后允许编辑
  let code = 0
  let data = {}
  try {
    ;({ status: code, data } = await api('/api/ext/bookmarks', {
      method: 'POST',
      body: JSON.stringify({ url: tab.url, title: tab.title || '' }),
    }))
  } catch (e) {
    code = -1
  }

  if (code === 200) {
    status.className = 'status ok'
    status.textContent = '✓ 已收藏'
    api(`/api/bookmarks/${data.id}/visit`, { method: 'POST' }).catch(() => {})
    if (data?.title && data.title !== tab.title) titleIn.value = data.title
    saveBtn.style.display = ''
  } else if (code === 409) {
    status.className = 'status ok'
    status.textContent = '✓ 已在书签库中（修改后点保存可更新）'
    saveBtn.style.display = ''
  } else if (code === 401) {
    status.className = 'status err'
    status.textContent = 'Token 已失效，请重新配置'
    const re = el(`<button class="btn ghost">重新配置 →</button>`)
    re.onclick = renderSetup
    $app.append(re)
    return
  } else if (code === -1) {
    status.className = 'status err'
    status.textContent = '网络错误：NAS 不可达或公网通道中断'
    addReconfig()
  } else if (code === 404) {
    status.className = 'status err'
    status.textContent = '服务端无此接口（404）——NAS 需更新到 v0.3.0 及以上，见 /api/health 版本'
  } else if (code === 500) {
    status.className = 'status err'
    status.textContent = '服务端内部错误（500），请到 NAS 查看容器日志'
    addReconfig()
  } else {
    status.className = 'status err'
    status.textContent = `收藏失败（HTTP ${code}），请截图反馈`
    addReconfig()
  }

  $app.append(
    el(`<div style="height:4px"></div>`),
    saveBtn,
    el(`<div style="height:6px"></div>`),
    urlRow,
  )

  saveBtn.onclick = async () => {
    saveBtn.disabled = true
    status.className = 'status loading'
    status.innerHTML = '<span class="spin">◌</span> 保存中…'
    try {
      const { status: c2 } = await api('/api/ext/bookmarks', {
        method: 'POST',
        body: JSON.stringify({
          url: tab.url,
          title: titleIn.value.trim(),
          description: descIn.value.trim(),
          updateIfExists: true,
        }),
      })
      if (c2 === 200) {
        status.className = 'status ok'
        status.textContent = '✓ 已保存'
      } else if (c2 === 404) {
        status.className = 'status err'
        status.textContent = '服务端无此接口（404）——NAS 需更新到 v0.3.0 及以上'
      } else {
        status.className = 'status err'
        status.textContent = `保存失败（HTTP ${c2}）`
      }
    } catch {
      status.className = 'status err'
      status.textContent = '网络错误，请重试'
    }
    saveBtn.disabled = false
  }
}

/* ---------- 入口 ---------- */
;(async () => {
  const { nasUrl, token } = await cfg()
  if (!nasUrl || !token) renderSetup()
  else renderMain()
})()
