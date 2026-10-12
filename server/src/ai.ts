import { Router } from 'express'
import { db } from './db.js'
import { AuthedRequest, requireAuth, requireAdmin } from './auth.js'

export const ai = Router()

/* ---------------- 设置（admin） ---------------- */

function getSettings() {
  return db
    .prepare('SELECT * FROM ai_settings WHERE id = 1')
    .get() as {
    enabled: number; provider: string; base_url: string; model: string; api_key: string
  }
}

ai.get('/settings/ai', requireAuth, requireAdmin, (_req, res) => {
  const s = getSettings()
  res.json({
    enabled: s.enabled === 1,
    provider: s.provider,
    baseUrl: s.base_url,
    model: s.model,
    hasKey: Boolean(s.api_key),
    keyMasked: s.api_key ? s.api_key.slice(-4) : null,
  })
})

ai.put('/settings/ai', requireAuth, requireAdmin, (req, res) => {
  const { enabled, provider, baseUrl, model, apiKey } = req.body ?? {}
  const s = getSettings()
  db.prepare(
    `UPDATE ai_settings SET enabled=?, provider=?, base_url=?, model=?, api_key=?, updated_at=datetime('now','localtime') WHERE id=1`,
  ).run(
    enabled === undefined ? s.enabled : enabled ? 1 : 0,
    provider ?? s.provider,
    baseUrl ?? s.base_url,
    model ?? s.model,
    apiKey ? String(apiKey).trim() : s.api_key, // 空 key 不覆盖已绑定
  )
  res.json({ ok: true })
})

/** 测试连接：调用 /models 轻量端点 */
ai.post('/settings/ai/test', requireAuth, requireAdmin, async (req, res) => {
  const body = req.body ?? {}
  const s = getSettings()
  const baseUrl = (body.baseUrl ?? s.base_url).replace(/\/+$/, '')
  const key = body.apiKey || s.api_key
  if (!baseUrl || !key) return res.status(400).json({ ok: false, error: 'missing_base_or_key' })
  const started = Date.now()
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (r.ok) return res.json({ ok: true, ms: Date.now() - started })
    const text = await r.text().catch(() => '')
    return res.json({ ok: false, error: `${r.status} ${text.slice(0, 120) || r.statusText}` })
  } catch (e) {
    return res.json({ ok: false, error: e instanceof Error ? e.message : 'network_error' })
  }
})

/* ---------------- 生成（简介 / 标签，BK-101） ---------------- */

/** 抓取页面公开文本：meta 描述优先，其次正文截断 */
async function fetchPageText(url: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8000)
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarkitBot/0.1; +self-hosted bookmark manager)' },
      redirect: 'follow',
    })
    const html = (await r.text()).slice(0, 400_000)
    const desc =
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
      ''
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? ''
    const bodyText = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1500)
    return `标题：${title}\n描述：${desc}\n正文摘录：${bodyText}`.slice(0, 2000)
  } finally {
    clearTimeout(t)
  }
}

async function chat(baseUrl: string, key: string, model: string, messages: Array<{ role: string; content: string }>): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  try {
    const r = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 300 }),
      signal: ctrl.signal,
    })
    if (!r.ok) throw new Error(`LLM ${r.status}`)
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  } finally {
    clearTimeout(t)
  }
}

ai.post('/ai/generate', requireAuth, async (req, res) => {
  const kind = req.body?.kind === 'tags' ? 'tags' : 'desc'
  const url = String(req.body?.url ?? '').trim()
  const title = String(req.body?.title ?? '').trim()
  if (!url) return res.status(400).json({ error: 'url_required' })

  const s = getSettings()
  if (!s.enabled || !s.api_key || !s.base_url || !s.model) {
    const missing = [
      !s.enabled && 'AI 总开关未开启',
      !s.api_key && 'API Key 未配置',
      !s.base_url && '接口地址未配置',
      !s.model && '模型名称未配置',
    ].filter(Boolean).join('、')
    return res.status(503).json({ error: 'ai_disabled', detail: missing })
  }

  let pageText = ''
  try {
    pageText = await fetchPageText(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  } catch {
    // 抓取失败不阻塞：仅凭标题/网址生成（BK-101）
  }

  try {
    if (kind === 'desc') {
      const out = await chat(s.base_url, s.api_key, s.model, [
        {
          role: 'system',
          content:
            '你是一个书签管理工具的助手。根据网页信息生成一句简体中文网站简介：30-50 个字，客观陈述这是什么网站、核心用途，不用营销语气，直接输出简介本身，不要引号和前后缀。',
        },
        { role: 'user', content: `网址：${url}\n标题：${title || '(未知)'}\n\n网页信息：\n${pageText || '(抓取失败，仅凭网址与标题判断)'}` },
      ])
      return res.json({ desc: out.replace(/^["「『]|["」』]$/g, '').slice(0, 120) })
    }

    // tags：优先复用用户已有标签（避免碎片化）
    const userId = (req as AuthedRequest).authUser!.id
    const myTags = (
      db.prepare('SELECT name FROM tags WHERE user_id = ? LIMIT 100').all(userId) as Array<{ name: string }>
    ).map((t) => t.name)
    const out = await chat(s.base_url, s.api_key, s.model, [
      {
        role: 'system',
        content:
          '你是一个书签管理工具的标签助手。根据网页信息输出 1-4 个简体中文标签，每个标签不超过 6 个字。优先从「用户已有标签」里复用语义匹配的，再补充新的具体概念。只输出标签本身，用逗号分隔，不要编号和引号。',
      },
      {
        role: 'user',
        content: `网址：${url}\n标题：${title || '(未知)'}\n用户已有标签：${myTags.join('、') || '(无)'}\n\n网页信息：\n${pageText || '(抓取失败，仅凭网址与标题判断)'}`,
      },
    ])
    const tags = out
      .split(/[,，、\n]/)
      .map((t) => t.trim().replace(/^["'「「#*\d.\s]+|["'」」\s]+$/g, ''))
      .filter(Boolean)
      .map((t) => (t.length > 6 ? t.slice(0, 6) : t))
      .filter((t, i, arr) => arr.indexOf(t) === i)
      .slice(0, 4)
    return res.json({ tags })
  } catch (e) {
    return res.status(502).json({ error: 'ai_failed', detail: e instanceof Error ? e.message : '' })
  }
})
