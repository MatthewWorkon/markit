import { Router, type Request, type Response, type NextFunction } from 'express'
import { randomBytes } from 'node:crypto'
import { db } from './db.js'
import { AuthedRequest, requireAuth } from './auth.js'

/**
 * 浏览器扩展支持（BK-108，v0.3）：
 * - API Token（Bearer，每用户多枚可撤销）——扩展配置一次免登录
 * - /api/ext/bookmarks：一键收藏（复用完整管道：去重/标题占位/enrich/VPN）
 * - /api/ext/check：徽标状态（当前页是否已收藏）
 */
/** Token 管理（挂 /api，会话鉴权） */
export const extTokens = Router()

/** 扩展接口（挂 /api/ext，Bearer 鉴权） */
export const extApi = Router()

type TokenRow = {
  id: number; user_id: number; name: string; token: string
  revoked: number; created_at: string; last_used_at: string | null
}

/** Bearer Token 鉴权中间件 */
export function requireApiToken(req: Request, res: Response, next: NextFunction) {
  const h = String(req.headers.authorization ?? '')
  if (!h.startsWith('Bearer mk_')) return res.status(401).json({ error: 'token_required' })
  const token = h.slice('Bearer '.length)
  const row = db
    .prepare('SELECT t.*, u.id AS uid, u.username, u.nickname, u.is_admin, u.must_change_password FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ? AND t.revoked = 0')
    .get(token) as (TokenRow & { uid: number; username: string; nickname: string; is_admin: number; must_change_password: number }) | undefined
  if (!row) return res.status(401).json({ error: 'bad_token' })
  db.prepare('UPDATE api_tokens SET last_used_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(row.id)
  ;(req as AuthedRequest).authUser = {
    id: row.uid,
    username: row.username,
    nickname: row.nickname,
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
  }
  next()
}

/* ---------------- Token 管理（网页端会话） ---------------- */

extTokens.post('/tokens', requireAuth, (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const name = String(req.body?.name ?? '').trim().slice(0, 50) || '浏览器扩展'
  const token = 'mk_' + randomBytes(32).toString('hex')
  const id = Number(
    db.prepare('INSERT INTO api_tokens (user_id, name, token) VALUES (?, ?, ?)').run(userId, name, token).lastInsertRowid,
  )
  res.json({ id, name, token }) // 明文仅此一次返回
})

extTokens.get('/tokens', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC')
    .all((req as AuthedRequest).authUser!.id) as Array<{ id: number; name: string; created_at: string; last_used_at: string | null }>
  res.json(rows)
})

extTokens.delete('/tokens/:id', requireAuth, (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const r = db.prepare('SELECT id FROM api_tokens WHERE id = ? AND user_id = ?').get(Number(req.params.id), userId)
  if (!r) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ?').run(Number(req.params.id))
  res.json({ ok: true })
})

/* ---------------- 扩展接口（Bearer Token） ---------------- */

/** 当前页是否已收藏（徽标用，轻量） */
extApi.get('/check', requireApiToken, (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const url = String(req.query.url ?? '')
  if (!url) return res.status(400).json({ error: 'url_required' })
  const norm = /^https?:\/\//i.test(url) ? url : `https://${url}`
  const hit = db
    .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL')
    .get(userId, norm.replace(/\/+$/, ''))
  res.json({ exists: Boolean(hit) })
})

/** 一键收藏：{url, title?, description?, updateIfExists?} */
extApi.post('/bookmarks', requireApiToken, async (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const { url, title, description, updateIfExists } = req.body ?? {}
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url_required' })
  const input = {
    url,
    title: title ? String(title).slice(0, 300) : '',
    description: description ? String(description).slice(0, 500) : '',
  }
  const result = await extCreateBookmark(userId, input, [], [], 'ext')
  if (result.error === 'url_duplicated') {
    if (updateIfExists) {
      // popup 编辑场景：存在则更新标题/简介
      const { updateBookmarkByExt } = await import('./ext-update.js')
      const bm = await updateBookmarkByExt(userId, input)
      return res.json({ ...bm, updated: true })
    }
    return res.status(409).json({ error: 'url_duplicated' })
  }
  if (result.error) return res.status(result.error === 'url_invalid' ? 400 : 400).json({ error: result.error })
  res.json(result.bookmark)
})

/** 由 index.ts 注入的创建实现（桥接 api.ts 内部逻辑，防循环 import） */
let createImpl: ((
  userId: number,
  input: { url: string; title: string; description: string },
  folderIds: number[],
  tagNames: string[],
  source: 'web' | 'ext',
) => Promise<{ error?: string; bookmark?: unknown }>) | null = null
export function registerExtCreate(impl: typeof createImpl) {
  createImpl = impl
}
async function extCreateBookmark(
  userId: number,
  input: { url: string; title: string; description: string },
  folderIds: number[] = [],
  tagNames: string[] = [],
  source: 'web' | 'ext' = 'web',
) {
  if (!createImpl) return { error: 'not_ready' }
  return createImpl(userId, input, folderIds, tagNames, source)
}
