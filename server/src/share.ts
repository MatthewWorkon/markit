import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import bcrypt from 'bcryptjs'
import { db, DATA_DIR } from './db.js'
import { AuthedRequest, requireAuth } from './auth.js'

/**
 * 分享（BK-105，v0.2）：书签/分组只读链接，公开或密码。
 * 语义：动态实时（分组内容随本库更新，访客刷新可见——2026-10-09 确认按推荐）。
 * v0.4.1：新增 Skill 分享（访客页渲染 Markdown）。
 */
export const share = Router()

type ShareRow = {
  id: number; user_id: number; token: string
  bookmark_id: number | null; folder_id: number | null; skill_id: number | null
  need_password: number; password_hash: string
  expires_at: string | null; revoked: number; created_at: string
}

function getValidShare(token: string): ShareRow | undefined {
  const row = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token) as ShareRow | undefined
  if (!row || row.revoked) return undefined
  if (row.expires_at && row.expires_at < new Date().toISOString().slice(0, 19).replace('T', ' ')) return undefined
  return row
}

/** 分享内容载荷 */
function sharePayload(row: ShareRow) {
  if (row.bookmark_id != null) {
    const b = db
      .prepare('SELECT * FROM bookmarks WHERE id = ? AND deleted_at IS NULL')
      .get(row.bookmark_id) as
      | { id: number; title: string; url: string; description: string; favicon: string | null; need_vpn: number; created_at: string }
      | undefined
    if (!b) return { kind: 'bookmark', title: '', items: [] }
    return {
      kind: 'bookmark',
      title: b.title,
      items: [
        { id: b.id, title: b.title, url: b.url, description: b.description, favicon: b.favicon, needVpn: b.need_vpn === 1, createdAt: b.created_at },
      ],
    }
  }
  // Skill：访客页渲染 Markdown（动态读取当前正文）
  if (row.skill_id != null) {
    const s = db
      .prepare('SELECT id, title, description, content_path FROM skills WHERE id = ? AND deleted_at IS NULL')
      .get(row.skill_id) as
      | { id: number; title: string; description: string; content_path: string | null }
      | undefined
    if (!s) return { kind: 'skill', title: '', items: [] }
    let content = ''
    if (s.content_path) {
      const f = join(DATA_DIR, s.content_path)
      if (existsSync(f)) content = readFileSync(f, 'utf-8')
    }
    return {
      kind: 'skill',
      title: s.title,
      items: [{ id: s.id, title: s.title, description: s.description, content }],
    }
  }
  // 分组：动态实时内容（含子孙目录）
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(row.folder_id!) as
    | { id: number; name: string; user_id: number }
    | undefined
  if (!folder) return { kind: 'folder', title: '', items: [] }
  const doomed = new Set<number>([folder.id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of db.prepare('SELECT id, parent_id FROM folders WHERE user_id = ?').all(folder.user_id) as Array<{ id: number; parent_id: number | null }>) {
      if (f.parent_id != null && doomed.has(f.parent_id) && !doomed.has(f.id)) {
        doomed.add(f.id)
        grew = true
      }
    }
  }
  const ph = `(${[...doomed].join(',')})`
  const items = (
    db
      .prepare(
        `SELECT b.id, b.title, b.url, b.description, b.favicon, b.need_vpn, b.created_at
         FROM bookmarks b JOIN bookmark_folders bf ON bf.bookmark_id = b.id
         WHERE bf.folder_id IN ${ph} AND b.deleted_at IS NULL
         ORDER BY b.created_at DESC LIMIT 500`,
      )
      .all() as Array<{ id: number; title: string; url: string; description: string; favicon: string | null; need_vpn: number; created_at: string }>
  ).map((b) => ({ ...b, needVpn: b.need_vpn === 1 }))
  return { kind: 'folder', title: folder.name, items }
}

/* ---------------- 拥有者接口（需登录） ---------------- */

share.post('/shares', requireAuth, (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const { bookmarkId, folderId, skillId, password, expiresInDays } = req.body ?? {}
  if (bookmarkId == null && folderId == null && skillId == null) return res.status(400).json({ error: 'target_required' })

  // 越权校验
  if (bookmarkId != null) {
    const b = db.prepare('SELECT id FROM bookmarks WHERE id = ? AND user_id = ?').get(Number(bookmarkId), userId)
    if (!b) return res.status(404).json({ error: 'not_found' })
  }
  if (folderId != null) {
    const f = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(Number(folderId), userId)
    if (!f) return res.status(404).json({ error: 'not_found' })
  }
  if (skillId != null) {
    const s = db.prepare('SELECT id FROM skills WHERE id = ? AND user_id = ?').get(Number(skillId), userId)
    if (!s) return res.status(404).json({ error: 'not_found' })
  }

  // 同目标旧链接直接复用（避免链接膨胀）
  const existing = db
    .prepare(
      'SELECT * FROM share_links WHERE user_id = ? AND bookmark_id IS ? AND folder_id IS ? AND skill_id IS ? AND revoked = 0',
    )
    .get(
      userId,
      bookmarkId != null ? Number(bookmarkId) : null,
      folderId != null ? Number(folderId) : null,
      skillId != null ? Number(skillId) : null,
    ) as ShareRow | undefined
  if (existing) return res.json({ token: existing.token, reused: true })

  const token = randomBytes(32).toString('hex') // 256bit
  const expires =
    expiresInDays && Number(expiresInDays) > 0
      ? new Date(Date.now() + Number(expiresInDays) * 86400_000)
          .toISOString()
          .slice(0, 19)
          .replace('T', ' ')
      : null
  db.prepare(
    `INSERT INTO share_links (user_id, token, bookmark_id, folder_id, skill_id, need_password, password_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    token,
    bookmarkId != null ? Number(bookmarkId) : null,
    folderId != null ? Number(folderId) : null,
    skillId != null ? Number(skillId) : null,
    password ? 1 : 0,
    password ? bcrypt.hashSync(String(password), 10) : '',
    expires,
  )
  res.json({ token })
})

share.get('/shares', requireAuth, (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const rows = db
    .prepare('SELECT * FROM share_links WHERE user_id = ? AND revoked = 0 ORDER BY created_at DESC')
    .all(userId) as ShareRow[]
  res.json(
    rows.map((r) => {
      const payload = sharePayload(r)
      return {
        id: r.id,
        token: r.token,
        kind: r.skill_id != null ? 'skill' : r.bookmark_id != null ? 'bookmark' : 'folder',
        title: payload.title,
        count: payload.items.length,
        needPassword: r.need_password === 1,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      }
    }),
  )
})

share.delete('/shares/:token', requireAuth, (req, res) => {
  const userId = (req as AuthedRequest).authUser!.id
  const r = db.prepare('SELECT id FROM share_links WHERE token = ? AND user_id = ?').get(req.params.token, userId)
  if (!r) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE share_links SET revoked = 1 WHERE id = ?').run((r as { id: number }).id)
  res.json({ ok: true })
})

/* ---------------- 访客接口（免登录） ---------------- */

/** 元数据（是否需密码/标题），供访客页展示 */
share.get('/share/:token/meta', (req, res) => {
  const row = getValidShare(req.params.token)
  if (!row) return res.status(404).json({ error: 'not_found' })
  const payload = sharePayload(row)
  res.json({ needPassword: row.need_password === 1, kind: payload.kind, title: payload.title, count: payload.items.length })
})

/** 内容：公开直接返回；密码链接校验后返回 */
share.post('/share/:token/view', (req, res) => {
  const row = getValidShare(req.params.token)
  if (!row) return res.status(404).json({ error: 'not_found' })
  if (row.need_password) {
    const pw = String(req.body?.password ?? '')
    if (!pw || !bcrypt.compareSync(pw, row.password_hash)) {
      return res.status(401).json({ error: 'bad_password' })
    }
  }
  res.json(sharePayload(row))
})
