import { Router } from 'express'
import { db, needsVpn } from './db.js'
import { AuthedRequest, requireAuth } from './auth.js'
import { scheduleCsvMirror } from './csv.js'
import { fetchPageMeta } from './fetch.js'
import { queueEnrich } from './enrich.js'

export const api = Router()

/* ---------------- 工具 ---------------- */

function uid(req: AuthedRequest): number {
  return req.authUser!.id
}

function touchBookmark(id: number) {
  db.prepare(`UPDATE bookmarks SET updated_at = datetime('now','localtime') WHERE id = ?`).run(id)
  scheduleCsvMirror()
}

/** 书签完整形状（含分组/标签） */
function bookmarkFull(b: {
  id: number; title: string; url: string; description: string; favicon: string | null
  favorite: number; pinned: number; need_vpn: number; visit_count: number
  sort_order: number | null; pin_order: number | null
  source?: string | null
  created_at: string; updated_at: string; deleted_at: string | null
}) {
  const folderIds = (
    db.prepare('SELECT folder_id FROM bookmark_folders WHERE bookmark_id = ? ORDER BY sort_order').all(b.id) as Array<{ folder_id: number }>
  ).map((r) => r.folder_id)
  const folderOrders: Record<number, number> = {}
  for (const r of db
    .prepare('SELECT folder_id, sort_order FROM bookmark_folders WHERE bookmark_id = ?').all(b.id) as Array<{ folder_id: number; sort_order: number | null }>) {
    folderOrders[r.folder_id] = r.sort_order ?? 0
  }
  const tagRows = db
    .prepare(
      `SELECT t.id, t.name FROM bookmark_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.bookmark_id = ?`,
    )
    .all(b.id) as Array<{ id: number; name: string }>
  return {
    id: b.id,
    title: b.title,
    url: b.url,
    description: b.description,
    favicon: b.favicon,
    folderIds,
    folderOrders,
    tagIds: tagRows.map((t) => t.id),
    tags: tagRows.map((t) => t.name),
    favorite: b.favorite === 1,
    pinned: b.pinned === 1,
    needVpn: b.need_vpn === 1,
    visitCount: b.visit_count,
    sortOrder: b.sort_order,
    pinOrder: b.pin_order,
    source: b.source ?? 'web',
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    deleted: b.deleted_at != null,
    deletedAt: b.deleted_at,
  }
}

function getBookmark(userId: number, id: number) {
  return db
    .prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?')
    .get(id, userId) as {
    id: number; title: string; url: string; description: string; favicon: string | null
    favorite: number; pinned: number; need_vpn: number; visit_count: number
    sort_order: number | null; pin_order: number | null
    source?: string | null
    created_at: string; updated_at: string; deleted_at: string | null
  } | undefined
}

const normalizeUrl = (raw: string) => {
  const s = raw.trim()
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

/** 旧数据判定：标题是否为「纯域名/URL 回退形态」（视为未设置过，可自动重抓） */
function isFallbackTitle(title: string, url: string): boolean {
  try {
    const u = new URL(url)
    if (title === u.hostname.replace(/^www\./, '') || title === u.hostname) return true
    return title === url.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  } catch {
    return false
  }
}

/**
 * 确保域名有本地 favicon：命中本地缓存直接返回；否则按
 * HTML link 声明 → {origin}/favicon.ico 顺序下载（≤300KB，仅图片类型）。
 */
function setBookmarkFolders(id: number, folderIds: number[]) {
  db.prepare('DELETE FROM bookmark_folders WHERE bookmark_id = ?').run(id)
  const ins = db.prepare('INSERT OR IGNORE INTO bookmark_folders (bookmark_id, folder_id) VALUES (?, ?)')
  for (const fid of folderIds) ins.run(id, fid)
}

function resolveTagIds(userId: number, names: string[]): number[] {
  const out: number[] = []
  const find = db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?')
  const ins = db.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)')
  for (const raw of names) {
    const n = raw.trim().replace(/^#/, '')
    if (!n) continue
    const hit = find.get(userId, n) as { id: number } | undefined
    out.push(hit ? hit.id : Number(ins.run(userId, n).lastInsertRowid))
  }
  return [...new Set(out)]
}

function setBookmarkTags(id: number, tagIds: number[]) {
  db.prepare('DELETE FROM bookmark_tags WHERE bookmark_id = ?').run(id)
  const ins = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')
  for (const tid of tagIds) ins.run(id, tid)
}

/* ---------------- 启动数据 ---------------- */

api.get('/bootstrap', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bookmarks = (
    db.prepare('SELECT * FROM bookmarks WHERE user_id = ?').all(userId) as Array<never>
  ).map((b) => bookmarkFull(b as never))
  const folders = db.prepare(
    'SELECT id, name, parent_id AS parentId, icon, icon_color AS iconColor, description, sort_order AS sortOrder FROM folders WHERE user_id = ? ORDER BY sort_order',
  ).all(userId)
  const tags = db
    .prepare('SELECT id, name FROM tags WHERE user_id = ? ORDER BY name')
    .all(userId)
  // 「网页转存」栏目展示条件：配置过扩展 Token，或已有扩展来源书签
  const hasToken = (
    db.prepare('SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND revoked = 0').get(userId) as { n: number }
  ).n
  const hasExtBookmarks = bookmarks.some((b) => (b as { source?: string }).source === 'ext')
  res.json({ user: (req as AuthedRequest).authUser, bookmarks, folders, tags, extActive: hasToken > 0 || hasExtBookmarks })
})

/* ---------------- 书签 ---------------- */

/** 创建书签内部实现（主接口与扩展共用完整管道：去重/占位/enrich/VPN） */
export async function createBookmarkInternal(
  userId: number,
  input: { url: string; title: string; description: string },
  folderIds: number[] = [],
  tagNames: string[] = [],
  source: 'web' | 'ext' = 'web',
): Promise<{ error?: string; bookmark?: ReturnType<typeof bookmarkFull> }> {
  let normalized: string
  try {
    normalized = normalizeUrl(input.url)
    new URL(normalized)
  } catch {
    return { error: 'url_invalid' }
  }
  const dup = db
    .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL')
    .get(userId, normalized) as { id: number } | undefined
  if (dup) return { error: 'url_duplicated' }

  let finalTitle = input.title.trim() || normalized.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  const minOrder = (
    db.prepare('SELECT MIN(sort_order) AS m FROM bookmarks WHERE user_id = ?').get(userId) as { m: number | null }
  ).m
  const newOrder = minOrder == null ? 1 : minOrder - 1
  const id = Number(
    db
      .prepare(`INSERT INTO bookmarks (user_id, title, url, description, favicon, sort_order, source) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, finalTitle.slice(0, 300), normalized, input.description, null, newOrder, source).lastInsertRowid,
  )
  setBookmarkFolders(id, folderIds)
  setBookmarkTags(id, resolveTagIds(userId, tagNames))
  const vpnCheck = (db.prepare('SELECT vpn_check FROM site_settings WHERE id = 1').get() as { vpn_check: number }).vpn_check === 1
  if (vpnCheck && needsVpn(normalized)) {
    db.prepare('UPDATE bookmarks SET need_vpn = 1 WHERE id = ?').run(id)
  }
  touchBookmark(id)
  queueEnrich(id, normalized, finalTitle)
  return { bookmark: bookmarkFull(getBookmark(userId, id)!) }
}

api.post('/bookmarks', requireAuth, async (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { title, url, description = '', folderIds = [], tagNames = [], favicon: faviconFromReq = null } = req.body ?? {}
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url_required' })
  let normalized: string
  try {
    normalized = normalizeUrl(url)
    new URL(normalized)
  } catch {
    return res.status(400).json({ error: 'url_invalid' })
  }
  const dup = db
    .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL')
    .get(userId, normalized) as { id: number } | undefined
  if (dup) return res.status(409).json({ error: 'url_duplicated' })

  // 标题留空 → 域名占位立即入库；真标题/图标由后台补全（点击即保存，BK-002）
  let finalTitle = String(title ?? '').trim()
  if (!finalTitle) {
    finalTitle = normalized.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  }

  // 手动排序模式下新书签插到最前；无参照时放最前（NULL 排最后兜底）
  const minOrder = (
    db.prepare('SELECT MIN(sort_order) AS m FROM bookmarks WHERE user_id = ?').get(userId) as { m: number | null }
  ).m
  const newOrder = minOrder == null ? 1 : minOrder - 1

  const id = Number(
    db
      .prepare(
        `INSERT INTO bookmarks (user_id, title, url, description, favicon, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, finalTitle.slice(0, 300), normalized, description, faviconFromReq, newOrder)
      .lastInsertRowid,
  )
  setBookmarkFolders(id, folderIds)
  setBookmarkTags(id, resolveTagIds(userId, tagNames))
  // VPN 黑名单比对（BK-104，开关在站点设置）
  const vpnCheck = (db.prepare('SELECT vpn_check FROM site_settings WHERE id = 1').get() as { vpn_check: number }).vpn_check === 1
  if (vpnCheck && needsVpn(normalized)) {
    db.prepare('UPDATE bookmarks SET need_vpn = 1 WHERE id = ?').run(id)
  }
  touchBookmark(id)

  // 后台补全真标题 + 图标，不阻塞响应
  queueEnrich(id, normalized, finalTitle)

  res.json(bookmarkFull(getBookmark(userId, id)!))
})

/** 扩展编辑用：按 id 更新标题/简介（不走 URL 重抓） */
export async function patchBookmarkByExt(userId: number, id: number, patch: { title?: string; description?: string }) {
  const bm = getBookmark(userId, id)
  if (!bm) throw new Error('not_found')
  if (patch.title !== undefined) {
    db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(patch.title.slice(0, 300), id)
  }
  if (patch.description !== undefined) {
    db.prepare('UPDATE bookmarks SET description = ? WHERE id = ?').run(patch.description, id)
  }
  touchBookmark(id)
  return bookmarkFull(getBookmark(userId, id)!) as unknown as Record<string, unknown>
}

api.patch('/bookmarks/:id', requireAuth, async (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bm = getBookmark(userId, Number(req.params.id))
  if (!bm) return res.status(404).json({ error: 'not_found' })
  const { title, url, description, folderIds, tagNames } = req.body ?? {}

  let urlChanged = false
  if (url !== undefined) {
    let normalized: string
    try {
      normalized = normalizeUrl(url)
      new URL(normalized)
    } catch {
      return res.status(400).json({ error: 'url_invalid' })
    }
    const dup = db
      .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL AND id != ?')
      .get(userId, normalized, bm.id) as { id: number } | undefined
    if (dup) return res.status(409).json({ error: 'url_duplicated' })
    db.prepare('UPDATE bookmarks SET url = ? WHERE id = ?').run(normalized, bm.id)
    urlChanged = normalized !== bm.url
  }
  if (title !== undefined) {
    let t = String(title).trim()
    // 清空标题，或标题仍是「域名/URL 回退形态」（旧数据）→ 占位入库 + 后台补全真标题
    if (!t || isFallbackTitle(t, urlChanged ? String(url) : bm.url)) {
      t = (urlChanged ? String(url) : bm.url).replace(/^https?:\/\//, '').replace(/\/+$/, '')
      db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(t.slice(0, 300), bm.id)
      queueEnrich(bm.id, urlChanged ? String(url) : bm.url, t)
    } else {
      db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(t.slice(0, 300), bm.id)
    }
  }
  // URL 域名变化 → 补抓新域名 favicon（后台执行，不阻塞响应）
  if (urlChanged || !bm.favicon) {
    queueEnrich(bm.id, urlChanged ? String(url) : bm.url, bm.title, true)
  }
  if (description !== undefined) db.prepare('UPDATE bookmarks SET description = ? WHERE id = ?').run(String(description), bm.id)
  if (req.body?.needVpn !== undefined) db.prepare('UPDATE bookmarks SET need_vpn = ? WHERE id = ?').run(req.body.needVpn ? 1 : 0, bm.id)
  if (folderIds !== undefined) setBookmarkFolders(bm.id, folderIds)
  if (tagNames !== undefined) setBookmarkTags(bm.id, resolveTagIds(userId, tagNames))
  touchBookmark(bm.id)
  res.json(bookmarkFull(getBookmark(userId, bm.id)!))
})

/** 访问计数（BK-109，fire-and-forget） */
api.post('/bookmarks/:id/visit', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bm = getBookmark(userId, Number(req.params.id))
  if (bm) {
    db.prepare(`UPDATE bookmarks SET visit_count = visit_count + 1, last_visited_at = datetime('now','localtime') WHERE id = ?`).run(bm.id)
  }
  res.json({ ok: true })
})

/** 星标 / 固定 / 恢复软删除 */
api.post('/bookmarks/:id/toggle', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bm = getBookmark(userId, Number(req.params.id))
  if (!bm) return res.status(404).json({ error: 'not_found' })
  const field = req.body?.field
  if (!['favorite', 'pinned'].includes(field)) return res.status(400).json({ error: 'bad_field' })
  const col = field === 'favorite' ? 'favorite' : 'pinned'
  db.prepare(`UPDATE bookmarks SET ${col} = 1 - ${col} WHERE id = ?`).run(bm.id)
  // 固定时分配到宫格末尾
  if (field === 'pinned') {
    const nowPinned = getBookmark(userId, bm.id)!.pinned
    if (nowPinned) {
      const max = (
        db.prepare('SELECT MAX(pin_order) AS m FROM bookmarks WHERE user_id = ? AND pinned = 1').get(userId) as { m: number | null }
      ).m
      db.prepare('UPDATE bookmarks SET pin_order = ? WHERE id = ?').run((max ?? 0) + 1, bm.id)
    }
  }
  touchBookmark(bm.id)
  res.json(bookmarkFull(getBookmark(userId, bm.id)!))
})

/** 软删除（进回收站） */
api.get('/bookmarks/:id', requireAuth, (req: AuthedRequest, res) => {
  const bm = getBookmark(req.authUser!.id, Number(req.params.id))
  if (!bm) return res.status(404).json({ error: 'not_found' })
  res.json(bookmarkFull(bm))
})

api.delete('/bookmarks/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bm = getBookmark(userId, Number(req.params.id))
  if (!bm) return res.status(404).json({ error: 'not_found' })
  db.prepare(`UPDATE bookmarks SET deleted_at = datetime('now','localtime') WHERE id = ?`).run(bm.id)
  touchBookmark(bm.id)
  res.json({ ok: true })
})

/** 恢复 */
api.post('/bookmarks/:id/restore', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bm = getBookmark(userId, Number(req.params.id))
  if (!bm) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE bookmarks SET deleted_at = NULL WHERE id = ?').run(bm.id)
  touchBookmark(bm.id)
  res.json(bookmarkFull(getBookmark(userId, bm.id)!))
})

/** 彻底删除 */
api.post('/bookmarks/:id/purge', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const bm = getBookmark(userId, Number(req.params.id))
  if (!bm) return res.status(404).json({ error: 'not_found' })
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bm.id)
  scheduleCsvMirror()
  res.json({ ok: true })
})

/* ---------------- 批量操作（BK-107） ---------------- */

type BatchAction = 'move' | 'tag' | 'star' | 'unstar' | 'delete' | 'restore' | 'purge'

/**
 * 单事务批量操作；不属于当前用户的 id 计入失败明细（PRD：部分失败给出明细）。
 * move = 添加分组归属（多分组模型，不解除已有绑定）；tag = 追加标签。
 */
api.post('/bookmarks/batch', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { ids, action, payload } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids_required' })
  const acts: BatchAction[] = ['move', 'tag', 'star', 'unstar', 'delete', 'restore', 'purge']
  if (!acts.includes(action)) return res.status(400).json({ error: 'bad_action' })

  const failed: Array<{ id: number; error: string }> = []
  let ok = 0

  const tx = db.transaction(() => {
    const insBf = db.prepare('INSERT OR IGNORE INTO bookmark_folders (bookmark_id, folder_id) VALUES (?, ?)')
    const insBt = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')
    const get = db.prepare('SELECT id, deleted_at FROM bookmarks WHERE id = ? AND user_id = ?')

    for (const rawId of ids) {
      const id = Number(rawId)
      const bm = get.get(id, userId) as { id: number; deleted_at: string | null } | undefined
      if (!bm) {
        failed.push({ id, error: 'not_found' })
        continue
      }
      try {
        switch (action) {
          case 'move': {
            const folderIds: number[] = Array.isArray(payload?.folderIds) ? payload.folderIds : []
            if (!folderIds.length) throw new Error('folderIds_required')
            for (const fid of folderIds) insBf.run(bm.id, fid)
            break
          }
          case 'tag': {
            const names: string[] = Array.isArray(payload?.tagNames) ? payload.tagNames : []
            if (!names.length) throw new Error('tagNames_required')
            for (const tid of resolveTagIds(userId, names)) insBt.run(bm.id, tid)
            break
          }
          case 'star':
          case 'unstar':
            db.prepare('UPDATE bookmarks SET favorite = ? WHERE id = ?').run(action === 'star' ? 1 : 0, bm.id)
            break
          case 'delete':
            db.prepare(`UPDATE bookmarks SET deleted_at = datetime('now','localtime') WHERE id = ? AND deleted_at IS NULL`).run(bm.id)
            break
          case 'restore':
            db.prepare('UPDATE bookmarks SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL').run(bm.id)
            break
          case 'purge':
            db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bm.id)
            break
        }
        ok++
      } catch (e) {
        failed.push({ id, error: e instanceof Error ? e.message : 'failed' })
      }
    }
  })
  tx()
  if (ok > 0) {
    if (action !== 'move' && action !== 'tag') {
      db.prepare(`UPDATE bookmarks SET updated_at = datetime('now','localtime') WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids.map(Number))
    }
    scheduleCsvMirror()
  }
  res.json({ ok, failed })
})

/* ---------------- 表单辅助：手动抓取标题（标题框旁「获取」按钮） ---------------- */

api.get('/fetch-title', requireAuth, async (req, res) => {
  const url = String(req.query.url ?? '').trim()
  if (!url) return res.status(400).json({ error: 'url_required' })
  let normalized: string
  try {
    normalized = normalizeUrl(url)
    new URL(normalized)
  } catch {
    return res.status(400).json({ error: 'url_invalid' })
  }
  const meta = await fetchPageMeta(normalized)
  res.json({ title: meta.title })
})

/* ---------------- 手动排序（BK-109） ---------------- */

/** 校验并返回属于当前用户的 id 子集（保持传入顺序） */
function ownedIds(userId: number, rawIds: unknown): number[] {
  if (!Array.isArray(rawIds)) return []
  const owned = new Set(
    (db.prepare('SELECT id FROM bookmarks WHERE user_id = ?').all(userId) as Array<{ id: number }>).map((r) => r.id),
  )
  return (rawIds as unknown[]).map(Number).filter((n) => owned.has(n))
}

/** 书签排序：scope global=全局顺序；folder=该分组内顺序（bookmark_folders.sort_order） */
api.post('/bookmarks/reorder', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { ids, scope, folderId } = req.body ?? {}
  const ordered = ownedIds(userId, ids)
  if (!ordered.length) return res.status(400).json({ error: 'ids_required' })
  if (scope !== 'global' && scope !== 'folder') return res.status(400).json({ error: 'bad_scope' })

  const tx = db.transaction(() => {
    if (scope === 'global') {
      const upd = db.prepare('UPDATE bookmarks SET sort_order = ? WHERE id = ? AND user_id = ?')
      ordered.forEach((id, i) => upd.run(i + 1, id, userId))
    } else {
      const fid = Number(folderId)
      const folder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(fid, userId)
      if (!folder) throw new Error('folder_not_found')
      const upd = db.prepare('UPDATE bookmark_folders SET sort_order = ? WHERE bookmark_id = ? AND folder_id = ?')
      ordered.forEach((id, i) => upd.run(i + 1, id, fid))
    }
  })
  try {
    tx()
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed'
    if (msg.includes('folder_not_found')) return res.status(404).json({ error: 'folder_not_found' })
    return res.status(500).json({ error: 'failed' })
  }
  res.json({ ok: true, count: ordered.length })
})

/** Pin 宫格排序 */
api.post('/pins/reorder', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const ordered = ownedIds(userId, req.body?.ids)
  if (!ordered.length) return res.status(400).json({ error: 'ids_required' })
  const tx = db.transaction(() => {
    const upd = db.prepare('UPDATE bookmarks SET pin_order = ? WHERE id = ? AND user_id = ? AND pinned = 1')
    ordered.forEach((id, i) => upd.run(i + 1, id, userId))
  })
  tx()
  res.json({ ok: true, count: ordered.length })
})

/** 分组排序：{ parentId, orderedIds } 同层级全量顺序；跨层级混传一律 400 */
api.post('/folders/reorder', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { parentId, orderedIds } = req.body ?? {}
  if (!Array.isArray(orderedIds) || !orderedIds.length) return res.status(400).json({ error: 'ids_required' })
  const pid = parentId === null ? null : Number(parentId)
  const ids = orderedIds.map(Number).filter((n) => Number.isInteger(n))
  const get = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ? AND parent_id IS ?')
  for (const id of ids) {
    if (!get.get(id, userId, pid)) return res.status(400).json({ error: 'parent_mismatch' })
  }
  const upd = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?')
  const tx = db.transaction(() => {
    ids.forEach((id, i) => upd.run(i + 1, id))
  })
  tx()
  res.json({ ok: true })
})

/* ---------------- 分组 ---------------- */

api.post('/folders', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { name, parentId = null, icon = 'folder', iconColor = null, description = '' } = req.body ?? {}
  if (!name?.trim()) return res.status(400).json({ error: 'name_required' })
  const dup = db
    .prepare('SELECT id FROM folders WHERE user_id = ? AND parent_id IS ? AND name = ?')
    .get(userId, parentId, name.trim())
  if (dup) return res.status(409).json({ error: 'name_duplicated' })
  const order = (
    db.prepare('SELECT COUNT(*) AS n FROM folders WHERE user_id = ? AND parent_id IS ?').get(userId, parentId) as { n: number }
  ).n
  const id = Number(
    db
      .prepare(
        `INSERT INTO folders (user_id, name, parent_id, icon, icon_color, description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, name.trim(), parentId, icon, iconColor, description ?? '', order + 1)
      .lastInsertRowid,
  )
  scheduleCsvMirror()
  res.json({ id })
})

api.patch('/folders/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const f = db
    .prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), userId) as { id: number } | undefined
  if (!f) return res.status(404).json({ error: 'not_found' })
  const { name, icon, iconColor, description } = req.body ?? {}
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: 'name_required' })
    db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name.trim(), f.id)
  }
  if (icon !== undefined) db.prepare('UPDATE folders SET icon = ? WHERE id = ?').run(icon, f.id)
  if (iconColor !== undefined) db.prepare('UPDATE folders SET icon_color = ? WHERE id = ?').run(iconColor, f.id)
  if (description !== undefined) db.prepare('UPDATE folders SET description = ? WHERE id = ?').run(description, f.id)
  scheduleCsvMirror()
  res.json({ ok: true })
})

/** 删除分组：整树删除 + 书签并入被删分组的父分类（2026-10-08 方案 B） */
api.delete('/folders/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const target = db
    .prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?')
    .get(Number(req.params.id), userId) as { id: number; parent_id: number | null } | undefined
  if (!target) return res.status(404).json({ error: 'not_found' })

  // 收集整棵子树
  const doomed = new Set<number>([target.id])
  let grew = true
  while (grew) {
    grew = false
    for (const f of db.prepare('SELECT id, parent_id FROM folders WHERE user_id = ?').all(userId) as Array<{
      id: number; parent_id: number | null
    }>) {
      if (f.parent_id != null && doomed.has(f.parent_id) && !doomed.has(f.id)) {
        doomed.add(f.id)
        grew = true
      }
    }
  }

  const parentId = target.parent_id
  const tx = db.transaction(() => {
    const affected = db
      .prepare(
        `SELECT DISTINCT bf.bookmark_id AS id FROM bookmark_folders bf WHERE bf.folder_id IN (${[...doomed].join(',')})`,
      )
      .all() as Array<{ id: number }>
    const delBf = db.prepare('DELETE FROM bookmark_folders WHERE bookmark_id = ? AND folder_id = ?')
    const insBf = db.prepare('INSERT OR IGNORE INTO bookmark_folders (bookmark_id, folder_id) VALUES (?, ?)')
    for (const { id } of affected) {
      for (const fid of doomed) delBf.run(id, fid)
      if (parentId != null) insBf.run(id, parentId)
    }
    // 删子树（FK 级联清 bookmark_folders）
    const delFolder = db.prepare('DELETE FROM folders WHERE id = ?')
    for (const fid of doomed) delFolder.run(fid)
  })
  tx()
  scheduleCsvMirror()
  res.json({ ok: true, mergedInto: parentId })
})

/* ---------------- 标签 ---------------- */

api.get('/tags', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT t.id, t.name, COUNT(bt.bookmark_id) AS count
       FROM tags t LEFT JOIN bookmark_tags bt ON bt.tag_id = t.id
       LEFT JOIN bookmarks b ON b.id = bt.bookmark_id AND b.deleted_at IS NULL
       WHERE t.user_id = ? GROUP BY t.id ORDER BY count DESC, t.name`,
    )
    .all(uid(req as AuthedRequest))
  res.json(rows)
})

/* ---------------- 导入 / 导出 ---------------- */

/** Netscape 书签 HTML 解析（Chrome/Edge/Firefox/Safari 通用） */
export function parseNetscapeHtml(html: string): Array<{ title: string; url: string; addDate?: string; path: string[] }> {
  const out: Array<{ title: string; url: string; addDate?: string; path: string[] }> = []
  const stack: string[] = []
  const re = /<DT><H3[^>]*>(.*?)<\/H3>|<DT><A\s+HREF="([^"]*)"[^>]*>(.*?)<\/A>|<\/DL>|<DL>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      stack.push(m[1].replace(/<[^>]+>/g, '').trim())
    } else if (m[2] !== undefined) {
      const addMatch = /ADD_DATE="(\d+)"/i.exec(m[0])
      out.push({
        title: (m[3] ?? '').replace(/<[^>]+>/g, '').trim() || m[2],
        url: m[2],
        addDate: addMatch ? new Date(Number(addMatch[1]) * 1000).toISOString() : undefined,
        path: [...stack],
      })
    } else if (m[0].toUpperCase() === '</DL>') {
      stack.pop()
    }
  }
  return out
}

api.post('/import', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const html = String(req.body?.html ?? '')
  if (!html.includes('<A')) return res.status(400).json({ error: 'bad_format' })
  const items = parseNetscapeHtml(html)

  // 文件夹路径 → id（层级保留，BK-012/B9）
  const folderCache = new Map<string, number>()
  const ensureFolder = (path: string[]): number | null => {
    if (!path.length) return null
    const key = path.join('/')
    const hit = folderCache.get(key)
    if (hit) return hit
    const parentId = path.length > 1 ? ensureFolder(path.slice(0, -1)) : null
    const name = path[path.length - 1]
    const existing = db
      .prepare('SELECT id FROM folders WHERE user_id = ? AND parent_id IS ? AND name = ?')
      .get(userId, parentId, name) as { id: number } | undefined
    const id = existing
      ? existing.id
      : Number(
          db
            .prepare(
              `INSERT INTO folders (user_id, name, parent_id, icon, sort_order)
               VALUES (?, ?, ?, 'folder', (SELECT COUNT(*)+1 FROM folders WHERE user_id = ? AND parent_id IS ?))`,
            )
            .run(userId, name, parentId, userId, parentId).lastInsertRowid,
        )
    folderCache.set(key, id)
    return id
  }

  let added = 0
  let skipped = 0
  /** ISO → SQLite 本地格式（与库内其余时间戳一致，保证字符串排序正确） */
  const toLocal = (iso?: string) => {
    if (!iso) return null
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
  const insBm = db.prepare(
    `INSERT INTO bookmarks (user_id, title, url, description, created_at, updated_at)
     VALUES (?, ?, ?, '', COALESCE(?, datetime('now','localtime')), COALESCE(?, datetime('now','localtime')))`,
  )
  const insBf = db.prepare('INSERT OR IGNORE INTO bookmark_folders (bookmark_id, folder_id) VALUES (?, ?)')
  const txImport = db.transaction(() => {
    for (const it of items) {
      const dup = db
        .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL')
        .get(userId, it.url)
      if (dup) {
        skipped++
        continue
      }
      const fid = ensureFolder(it.path)
      const ts = toLocal(it.addDate)
      const id = Number(insBm.run(userId, it.title.slice(0, 300), it.url, ts, ts).lastInsertRowid)
      if (fid) insBf.run(id, fid)
      added++
    }
  })
  txImport()
  scheduleCsvMirror()
  res.json({ added, skipped })
})

api.get('/export', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const format = req.query.format === 'html' ? 'html' : 'json'
  // 批量导出：?ids=1,2,3（可选，过滤导出范围）
  const idFilter = typeof req.query.ids === 'string' && req.query.ids
    ? req.query.ids.split(',').map(Number).filter((n) => Number.isInteger(n))
    : null

  let bookmarks = (
    db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND deleted_at IS NULL').all(userId) as Array<never>
  ).map((b) => bookmarkFull(b as never))
  if (idFilter) bookmarks = bookmarks.filter((b) => idFilter.includes(b.id))
  const folders = db
    .prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order')
    .all(userId) as Array<{ id: number; name: string; parent_id: number | null; icon: string; icon_color: string | null; description: string; sort_order: number }>

  if (format === 'json') {
    res.setHeader('Content-Disposition', 'attachment; filename="markit-backup.json"')
    return res.json({ exportedAt: new Date().toISOString(), folders, bookmarks })
  }

  // Netscape HTML
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
  const lines = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>']
  const childrenOf = (pid: number | null) => folders.filter((f) => f.parent_id === pid)
  const emitted = new Set<number>() // 多分组书签只输出一次（首次遇到的分组）
  const bmChildrenOf = (fid: number | null) =>
    bookmarks.filter((b) =>
      fid == null ? b.folderIds.length === 0 : b.folderIds.includes(fid),
    )
  const walk = (pid: number | null, depth: number) => {
    const pad = '    '.repeat(depth + 1)
    for (const f of childrenOf(pid)) {
      lines.push(`${pad}<DT><H3>${esc(f.name)}</H3>`)
      lines.push(`${pad}<DL><p>`)
      walk(f.id, depth + 1)
      lines.push(`${pad}</DL><p>`)
    }
    for (const b of bmChildrenOf(pid)) {
      if (emitted.has(b.id)) continue
      emitted.add(b.id)
      lines.push(`${pad}<DT><A HREF="${esc(b.url)}">${esc(b.title)}</A>`)
    }
  }
  walk(null, 0)
  lines.push('</DL><p>')
  res.setHeader('Content-Disposition', 'attachment; filename="bookmarks.html"')
  res.type('text/html').send(lines.join('\n'))
})
