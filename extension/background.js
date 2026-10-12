/* Markit 扩展 · Service Worker：右键菜单 / 快捷键 / 徽标状态 */

const DEFAULT_TITLE = 'Markit 收藏夹'

async function cfg() {
  const { nasUrl, token } = await chrome.storage.local.get(['nasUrl', 'token'])
  return { nasUrl: (nasUrl || '').replace(/\/+$/, ''), token: token || '' }
}

async function api(path, init = {}) {
  const { nasUrl, token } = await cfg()
  const r = await fetch(nasUrl + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
      ...init.headers,
    },
  })
  return { status: r.status, data: await r.json().catch(() => ({})) }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-page',
    title: '收藏此页到 Markit',
    contexts: ['page'],
  })
  chrome.contextMenus.create({
    id: 'save-selection',
    title: '收藏此页（选中文本作为简介）',
    contexts: ['selection'],
  })
})

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

async function saveTab(tab, description = '') {
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    return { ok: false, reason: 'invalid_url' }
  }
  const { status, data } = await api('/api/ext/bookmarks', {
    method: 'POST',
    body: JSON.stringify({ url: tab.url, title: tab.title || '', description }),
  })
  if (status === 200) return { ok: true, bookmark: data }
  if (status === 409) return { ok: true, existed: true }
  return { ok: false, reason: data.error || `http_${status}` }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-page') {
    const r = await saveTab(tab)
    notify(r, tab.title)
  } else if (info.menuItemId === 'save-selection') {
    const r = await saveTab(tab, String(info.selectionText || '').slice(0, 500))
    notify(r, tab.title)
  }
})

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'save-current') return
  const tab = await activeTab()
  const r = await saveTab(tab)
  notify(r, tab.title)
})

function notify(r, title) {
  const ok = r.ok
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: ok ? '已收藏 ✓' : '收藏失败',
    message: ok ? (r.existed ? '已在书签库中' : (title || '').slice(0, 60)) : (r.reason === 'token_required' || r.reason === 'bad_token' ? '请先配置 Token（点扩展图标）' : '网络错误或服务不可达'),
  })
}

/* 徽标：当前页是否已收藏（切页/加载时节流查询） */
let badgeTimer = null
async function refreshBadge() {
  clearTimeout(badgeTimer)
  badgeTimer = setTimeout(async () => {
    try {
      const { nasUrl, token } = await cfg()
      if (!nasUrl || !token) return chrome.action.setBadgeText({ text: '' })
      const tab = await activeTab()
      if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
        chrome.action.setBadgeText({ text: '' })
        return
      }
      const r = await fetch(`${nasUrl}/api/ext/check?url=${encodeURIComponent(tab.url)}`, {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!r.ok) return chrome.action.setBadgeText({ text: '' })
      const d = await r.json()
      chrome.action.setBadgeBackgroundColor({ color: '#2E5BE6' })
      chrome.action.setBadgeText({ text: d.exists ? '✓' : '' })
    } catch {
      chrome.action.setBadgeText({ text: '' })
    }
  }, 400)
}

chrome.tabs.onActivated.addListener(refreshBadge)
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.status === 'complete') refreshBadge()
})
