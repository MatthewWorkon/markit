import { Router } from 'express'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { db, DATA_DIR } from './db.js'
import { AuthedRequest, requireAuth } from './auth.js'
import { scheduleSkillsCsv } from './csv.js'

/**
 * Skills 管理模块（v0.4.0）：
 * - 每用户独立库，一级分组，全局/项目级双范围
 * - 正文存文件系统 data/skills/{user_id}/{hash}.md
 * - 来源：manual / github / upload
 * - 公开广场：is_public=1 跨用户可见，可复制到我的库
 * - CSV 镜像：skills-mirror.csv 防抖全量重写
 */
export const skillsApi = Router()

const SKILLS_DIR = join(DATA_DIR, 'skills')

/* ---------------- 工具 ---------------- */

function uid(req: AuthedRequest): number {
  return req.authUser!.id
}

/** 正文写文件系统，返回路径（相对 data/） */
function saveContent(userId: number, content: string): string {
  const userDir = join(SKILLS_DIR, String(userId))
  mkdirSync(userDir, { recursive: true })
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16)
  const rel = `skills/${userId}/${hash}.md`
  writeFileSync(join(DATA_DIR, rel), content, 'utf-8')
  return rel
}

function readContent(rel: string | null): string {
  if (!rel) return ''
  const p = join(DATA_DIR, rel)
  return existsSync(p) ? readFileSync(p, 'utf-8') : ''
}

/** 解析 frontmatter（--- name: xxx / description: xxx ---） */
function parseFrontmatter(raw: string): { title: string; description: string; body: string } {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!fm) return { title: '', description: '', body: raw }
  const meta = fm[1]
  const body = fm[2]
  const title = /name:\s*(.+)/.exec(meta)?.[1]?.trim() ?? ''
  const description = /description:\s*(.+)/.exec(meta)?.[1]?.trim() ?? ''
  return { title, description, body }
}

type SkillRow = {
  id: number; user_id: number; title: string; description: string
  content_path: string | null; scope: string; project_name: string
  source: string; github_url: string; github_author: string
  folder_id: number | null; is_public: number; file_size: number
  favorite: number
  github_path: string
  download_count: number
  created_at: string; updated_at: string; deleted_at: string | null
}

function skillFull(r: SkillRow) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    scope: r.scope,
    projectName: r.project_name,
    source: r.source,
    githubUrl: r.github_url,
    githubAuthor: r.github_author,
    folderId: r.folder_id,
    isPublic: r.is_public === 1,
    favorite: r.favorite === 1,
    githubPath: r.github_path ?? '',
    downloadCount: r.download_count ?? 0,
    fileSize: r.file_size,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deleted: r.deleted_at != null,
  }
}

function getSkill(userId: number, id: number): SkillRow | undefined {
  return db.prepare('SELECT * FROM skills WHERE id = ? AND user_id = ?').get(id, userId) as SkillRow | undefined
}

/* ---------------- Bootstrap ---------------- */

skillsApi.get('/skills/bootstrap', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const skills = (
    db.prepare('SELECT * FROM skills WHERE user_id = ?').all(userId) as SkillRow[]
  ).map(skillFull)
  const folders = db
    .prepare('SELECT id, name, icon, icon_color AS iconColor, sort_order AS sortOrder FROM skill_folders WHERE user_id = ? ORDER BY sort_order')
    .all(userId)
  res.json({ skills, folders })
})

/* ---------------- CRUD ---------------- */

skillsApi.post('/skills', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { title, description = '', content = '', scope = 'global', projectName = '', source = 'manual', githubUrl = '', githubAuthor = '', folderId = null, isPublic = false } = req.body ?? {}
  if (!title?.trim()) return res.status(400).json({ error: 'title_required' })
  if (!content.trim()) return res.status(400).json({ error: 'content_required' })

  const contentPath = saveContent(userId, content)
  const id = Number(
    db.prepare(
      `INSERT INTO skills (user_id, title, description, content_path, scope, project_name, source, github_url, github_author, folder_id, is_public, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      title.trim().slice(0, 200),
      String(description).slice(0, 500),
      contentPath,
      scope === 'project' ? 'project' : 'global',
      projectName.trim().slice(0, 100),
      source,
      githubUrl,
      githubAuthor,
      folderId,
      isPublic ? 1 : 0,
      Buffer.byteLength(content),
    ).lastInsertRowid,
  )
  scheduleSkillsCsv()
  res.json(skillFull(getSkill(userId, id)!))
})

/* ---------------- 公开广场 ---------------- */

skillsApi.get('/skills/plaza', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const rows = db
    .prepare(
      `SELECT s.*, u.nickname AS author_nickname, u.username AS author_username
       FROM skills s JOIN users u ON u.id = s.user_id
       WHERE s.is_public = 1 AND s.deleted_at IS NULL
       ORDER BY s.updated_at DESC LIMIT 200`,
    )
    .all() as Array<SkillRow & { author_nickname: string; author_username: string }>
  const favSet = new Set(
    (db.prepare('SELECT skill_id FROM skill_favorites WHERE user_id = ?').all(userId) as Array<{ skill_id: number }>).map((r) => r.skill_id),
  )
  res.json(
    rows.map((r) => ({
      ...skillFull(r),
      favorite: favSet.has(r.id), // 广场语境下 favorite = 当前用户是否收藏（覆盖作者的值）
      authorNickname: r.author_nickname,
      authorUsername: r.author_username,
    })),
  )
})

/** 当前用户收藏的广场条目列表（星标收藏视图与库内星标合并展示） */
skillsApi.get('/skills/favorited-plaza', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const rows = db
    .prepare(
      `SELECT s.*, u.nickname AS author_nickname, u.username AS author_username
       FROM skill_favorites f
       JOIN skills s ON s.id = f.skill_id AND s.deleted_at IS NULL AND s.is_public = 1
       JOIN users u ON u.id = s.user_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
    )
    .all(userId) as Array<SkillRow & { author_nickname: string; author_username: string }>
  res.json(
    rows.map((r) => ({
      ...skillFull(r),
      favorite: true, // 该列表内必为已收藏
      authorNickname: r.author_nickname,
      authorUsername: r.author_username,
    })),
  )
})

/** 广场条目收藏/取消收藏（跨用户关联表；自己的条目仍走 PATCH favorite） */
skillsApi.post('/skills/:id/favorite', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = db.prepare('SELECT id, user_id, deleted_at FROM skills WHERE id = ?').get(Number(req.params.id)) as { id: number; user_id: number; deleted_at: string | null } | undefined
  if (!r || r.deleted_at) return res.status(404).json({ error: 'not_found' })
  if (r.user_id === userId) return res.status(400).json({ error: 'own_skill' }) // 自己的用 PATCH favorite
  const existing = db.prepare('SELECT 1 AS x FROM skill_favorites WHERE user_id = ? AND skill_id = ?').get(userId, r.id)
  if (existing) {
    db.prepare('DELETE FROM skill_favorites WHERE user_id = ? AND skill_id = ?').run(userId, r.id)
    return res.json({ favorited: false })
  }
  db.prepare('INSERT INTO skill_favorites (user_id, skill_id) VALUES (?, ?)').run(userId, r.id)
  res.json({ favorited: true })
})

/* ---------------- 搜索 ---------------- */

skillsApi.get('/skills/search', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const q = String(req.query.q ?? '').trim().toLowerCase()
  if (!q) return res.json([])
  const rows = db
    .prepare(
      `SELECT * FROM skills WHERE user_id = ? AND deleted_at IS NULL AND
       (LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(COALESCE(content_path, '')) LIKE ? OR LOWER(project_name) LIKE ?)
       ORDER BY updated_at DESC LIMIT 50`,
    )
    .all(userId, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`) as SkillRow[]
  // 正文搜索（文件系统层，小规模可接受）
  const results = rows.filter((r) => {
    if (r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.project_name.toLowerCase().includes(q)) return true
    return readContent(r.content_path).toLowerCase().includes(q)
  })
  res.json(results.map(skillFull))
})
skillsApi.get('/skills/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const id = Number(req.params.id)
  // 自己的条目 → 全量；他人条目 → 仅公开且未删除的可只读预览（v0.4.12）
  let r = getSkill(userId, id)
  let own = true
  if (!r) {
    r = db.prepare('SELECT * FROM skills WHERE id = ? AND is_public = 1 AND deleted_at IS NULL').get(id) as SkillRow | undefined
    own = false
  }
  if (!r) return res.status(404).json({ error: 'not_found' })
  const out: Record<string, unknown> = { ...skillFull(r), content: readContent(r.content_path), own }
  if (!own) {
    const author = db.prepare('SELECT nickname, username FROM users WHERE id = ?').get(r.user_id) as { nickname: string; username: string } | undefined
    out.authorNickname = author?.nickname ?? ''
    out.authorUsername = author?.username ?? ''
    out.readonly = true
  }
  res.json(out)
})

skillsApi.patch('/skills/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  const { title, description, content, scope, projectName, folderId, isPublic, favorite } = req.body ?? {}

  if (title !== undefined) {
    if (!String(title).trim()) return res.status(400).json({ error: 'title_required' })
    db.prepare('UPDATE skills SET title = ? WHERE id = ?').run(String(title).trim().slice(0, 200), r.id)
  }
  if (description !== undefined) db.prepare('UPDATE skills SET description = ? WHERE id = ?').run(String(description).slice(0, 500), r.id)
  if (content !== undefined && String(content).trim()) {
    const newPath = saveContent(userId, String(content))
    if (r.content_path) pushVersion(r, r.content_path, r.file_size, 'edit')
    db.prepare('UPDATE skills SET content_path = ?, file_size = ? WHERE id = ?').run(newPath, Buffer.byteLength(String(content)), r.id)
  }
  if (scope !== undefined) db.prepare("UPDATE skills SET scope = ? WHERE id = ?").run(scope === 'project' ? 'project' : 'global', r.id)
  if (projectName !== undefined) db.prepare('UPDATE skills SET project_name = ? WHERE id = ?').run(String(projectName).slice(0, 100), r.id)
  if (folderId !== undefined) db.prepare('UPDATE skills SET folder_id = ? WHERE id = ?').run(folderId, r.id)
  if (isPublic !== undefined) db.prepare('UPDATE skills SET is_public = ? WHERE id = ?').run(isPublic ? 1 : 0, r.id)
  if (favorite !== undefined) db.prepare('UPDATE skills SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, r.id)
  // 仅星标切换不动 updated_at（避免时间排序视图跳动）
  const touch = [title, description, content, scope, projectName, folderId, isPublic].some((v) => v !== undefined)
  if (touch) db.prepare("UPDATE skills SET updated_at = datetime('now','localtime') WHERE id = ?").run(r.id)
  scheduleSkillsCsv()
  res.json(skillFull(getSkill(userId, r.id)!))
})

/* 删除：未删除 → 入回收站（软删）；已在回收站 → 彻底删除 */
skillsApi.delete('/skills/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.deleted_at) {
    db.prepare('DELETE FROM skills WHERE id = ?').run(r.id)
    // 正文文件按内容哈希共享：仅当再无其他条目引用时才删文件
    if (r.content_path) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM skills WHERE content_path = ?').get(r.content_path) as { n: number }
      if (!n) {
        const f = join(DATA_DIR, r.content_path)
        if (existsSync(f)) {
          try { rmSync(f) } catch { /* 单文件清理失败不影响主流程 */ }
        }
      }
    }
  } else {
    db.prepare("UPDATE skills SET deleted_at = datetime('now','localtime') WHERE id = ?").run(r.id)
  }
  scheduleSkillsCsv()
  res.json({ ok: true })
})

/** 下载计数（前端导出 .md 时上报，fire-and-forget） */
skillsApi.post('/skills/:id/download', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE skills SET download_count = download_count + 1 WHERE id = ?').run(r.id)
  res.json({ ok: true, downloadCount: (getSkill(userId, r.id)!.download_count) })
})

/** GitHub 来源检查更新：拉线上文件，内容有变则覆盖正文（标题/描述保留本地） */
skillsApi.post('/skills/:id/sync', requireAuth, async (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  if (r.source !== 'github' || !r.github_url) {
    return res.status(400).json({ error: 'not_github_source' })
  }
  // github_url 存的是 repo 页面链接；解析 owner/repo
  const m = r.github_url.match(/github\.com\/([\w.-]+)\/([\w.-]+)/)
  if (!m) return res.status(400).json({ error: 'invalid_github_url' })
  // 来源路径：优先导入时记录的 github_path；旧数据为空时尝试从 blob 单文件 URL 解析
  let filePath = r.github_path
  if (!filePath) {
    const blob = r.github_url.match(/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[^/]+\/(.+)\.md$/)
    if (blob) filePath = `${blob[1]}.md`
  }
  if (!filePath) return res.status(400).json({ error: 'no_source_path' })
  try {
    const fr = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/contents/${filePath}`, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Markit' },
      signal: AbortSignal.timeout(10000),
    })
    if (!fr.ok) return res.status(502).json({ error: 'github_fetch_failed', detail: `HTTP ${fr.status}` })
    const fd = (await fr.json()) as { content: string }
    const content = Buffer.from(fd.content, 'base64').toString('utf-8')
    const cur = r.content_path ? readContent(r.content_path) : ''
    if (content === cur) {
      return res.json({ updated: false })
    }
    // 探测模式（?check=1）：只告知有新版，不落库（用户点「立即更新」时才真正拉取）
    if (req.query.check === '1') {
      return res.json({ updated: true })
    }
    const newPath = saveContent(userId, content)
    if (r.content_path) pushVersion(r, r.content_path, r.file_size, 'sync')
    db.prepare("UPDATE skills SET content_path = ?, file_size = ?, updated_at = datetime('now','localtime') WHERE id = ?")
      .run(newPath, Buffer.byteLength(content), r.id)
    scheduleSkillsCsv()
    res.json({ updated: true, skill: skillFull(getSkill(userId, r.id)!) })
  } catch {
    res.status(502).json({ error: 'github_parse_failed' })
  }
})

skillsApi.post('/skills/:id/restore', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE skills SET deleted_at = NULL WHERE id = ?').run(r.id)
  scheduleSkillsCsv()
  res.json(skillFull(getSkill(userId, r.id)!))
})

/* ---------------- GitHub 解析（预览，不入库） ---------------- */

skillsApi.post('/skills/import/github', requireAuth, async (req, res) => {
  const { repoUrl } = req.body ?? {}
  if (!repoUrl || typeof repoUrl !== 'string') return res.status(400).json({ error: 'url_required' })

  // 解析 GitHub URL：支持 repo根 / 子目录 / 单文件
  const m = repoUrl.match(/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/[^/]+(?:\/(.+))?)?/)
  if (!m) return res.status(400).json({ error: 'invalid_github_url' })
  const [, owner, repo, subPath] = m

  // 单文件（blob 链接且以 .md 结尾）
  const isSingleFile = repoUrl.includes('/blob/') && repoUrl.endsWith('.md')

  try {
    const items: Array<{ title: string; description: string; path: string; size: number; content: string }> = []

    if (isSingleFile) {
      const filePath = subPath ?? ''
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Markit' },
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) return res.status(400).json({ error: 'github_fetch_failed', detail: `HTTP ${r.status}` })
      const data = (await r.json()) as { content: string; size: number; name: string }
      const content = Buffer.from(data.content, 'base64').toString('utf-8')
      const fm = parseFrontmatter(content)
      items.push({ title: fm.title || data.name.replace('.md', ''), description: fm.description, path: filePath, size: data.size, content })
    } else {
      // 递归获取 repo 文件树
      const branchR = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Markit' },
        signal: AbortSignal.timeout(8000),
      })
      if (!branchR.ok) return res.status(400).json({ error: 'repo_not_found' })
      const repoData = (await branchR.json()) as { default_branch: string }
      const branch = repoData.default_branch || 'main'

      const treeR = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Markit' },
        signal: AbortSignal.timeout(10000),
      })
      if (!treeR.ok) return res.status(400).json({ error: 'tree_fetch_failed' })
      const tree = (await treeR.json()) as { tree: Array<{ path: string; type: string; size?: number }> }

      // 全量 .md；readme/skill 命名的排最前（用户核心目标，不被数量截断丢掉）
      const isCore = (p: string) => /(^|\/)(readme|skill)\.md$/i.test(p)
      const mdFiles = tree.tree
        .filter(
          (t) => t.type === 'blob' && t.path.endsWith('.md') && (!subPath || t.path.startsWith(subPath)),
        )
        .sort((a, b) => Number(isCore(b.path)) - Number(isCore(a.path)))

      // 限制最多拉 50 个文件（避免超时）
      for (const f of mdFiles.slice(0, 50)) {
        try {
          const fr = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${f.path}`, {
            headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'Markit' },
            signal: AbortSignal.timeout(5000),
          })
          if (!fr.ok) continue
          const fd = (await fr.json()) as { content: string; size: number; name: string }
          const content = Buffer.from(fd.content, 'base64').toString('utf-8')
          const fm = parseFrontmatter(content)
          items.push({ title: fm.title || fd.name.replace('.md', ''), description: fm.description, path: f.path, size: fd.size, content })
        } catch { /* 跳过单个失败文件 */ }
      }
    }

    // 自动提取项目名
    const projectName = repo
    res.json({ items, projectName, author: owner, repoUrl: `https://github.com/${owner}/${repo}` })
  } catch {
    res.status(500).json({ error: 'github_parse_failed' })
  }
})

/* ---------------- 批量确认入库 ---------------- */

skillsApi.post('/skills/import/confirm', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { items, scope = 'global', projectName = '', folderId = null, source = 'github', githubUrl = '', githubAuthor = '' } = req.body ?? {}
  // items[].path：GitHub 导入时的来源文件路径（用于后续「检查更新」）
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items_required' })

  const ins = db.prepare(
    `INSERT INTO skills (user_id, title, description, content_path, scope, project_name, source, github_url, github_author, github_path, folder_id, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  let added = 0
  for (const item of items) {
    const content = String(item.content ?? '')
    if (!content.trim()) continue
    const path = saveContent(userId, content)
    ins.run(
      userId,
      String(item.title ?? 'Untitled').slice(0, 200),
      String(item.description ?? '').slice(0, 500),
      path,
      scope === 'project' ? 'project' : 'global',
      projectName.slice(0, 100),
      source,
      githubUrl,
      githubAuthor,
      String(item.path ?? ''),
      folderId,
      Buffer.byteLength(content),
    )
    added++
  }
  scheduleSkillsCsv()
  res.json({ ok: true, added })
})

/** 从广场复制到我的库 */
skillsApi.post('/skills/:id/copy', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const src = db
    .prepare('SELECT * FROM skills WHERE id = ? AND is_public = 1 AND deleted_at IS NULL')
    .get(Number(req.params.id)) as SkillRow | undefined
  if (!src) return res.status(404).json({ error: 'not_found' })

  const content = readContent(src.content_path)
  const newPath = saveContent(userId, content)
  const id = Number(
    db.prepare(
      `INSERT INTO skills (user_id, title, description, content_path, scope, project_name, source, github_url, github_author, github_path, file_size)
       VALUES (?, ?, ?, ?, 'global', '', 'copy', ?, ?, ?, ?)`,
    ).run(userId, src.title, src.description, newPath, src.github_url, src.github_author, src.github_path ?? '', src.file_size).lastInsertRowid,
  )
  scheduleSkillsCsv()
  res.json(skillFull(getSkill(userId, id)!))
})

/* ---------------- 版本历史（保留最近 3 条，v0.4.5） ---------------- */

const VERSION_KEEP = 5

function pushVersion(skill: SkillRow, replacedPath: string, replacedSize: number, reason: 'edit' | 'sync' | 'rollback') {
  db.prepare(
    `INSERT INTO skill_versions (skill_id, content_path, file_size, reason, created_at)
     VALUES (?, ?, ?, ?, datetime('now','localtime'))`,
  ).run(skill.id, replacedPath, replacedSize, reason)
  // 只保留最近 VERSION_KEEP 条（多余的连带删除孤儿文件）
  const olds = db
    .prepare('SELECT id, content_path FROM skill_versions WHERE skill_id = ? ORDER BY id DESC LIMIT -1 OFFSET ?')
    .all(skill.id, VERSION_KEEP) as Array<{ id: number; content_path: string }>
  for (const o of olds) {
    db.prepare('DELETE FROM skill_versions WHERE id = ?').run(o.id)
    if (o.content_path) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM skills WHERE content_path = ?').get(o.content_path) as { n: number }
      const { m } = db.prepare('SELECT COUNT(*) AS m FROM skill_versions WHERE content_path = ?').get(o.content_path) as { m: number }
      if (!n && !m) {
        const f = join(DATA_DIR, o.content_path)
        if (existsSync(f)) { try { rmSync(f) } catch { /* 忽略 */ } }
      }
    }
  }
}

/** 某条 Skill 的历史版本列表（新→旧） */
skillsApi.get('/skills/:id/versions', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  const rows = db
    .prepare('SELECT id, content_path, file_size, reason, created_at FROM skill_versions WHERE skill_id = ? ORDER BY id DESC')
    .all(r.id) as Array<{ id: number; content_path: string; file_size: number; reason: string; created_at: string }>
  res.json(rows.map((v) => ({
    id: v.id,
    size: v.file_size,
    reason: v.reason,
    createdAt: v.created_at,
    preview: readContent(v.content_path).slice(0, 120),
  })))
})

/** 回退到指定历史版本：当前版先入历史（reason=rollback），历史版成为正文 */
skillsApi.post('/skills/:id/versions/:vid/restore', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const r = getSkill(userId, Number(req.params.id))
  if (!r) return res.status(404).json({ error: 'not_found' })
  const v = db
    .prepare('SELECT * FROM skill_versions WHERE id = ? AND skill_id = ?')
    .get(Number(req.params.vid), r.id) as { id: number; content_path: string; file_size: number } | undefined
  if (!v) return res.status(404).json({ error: 'not_found' })

  // 当前版入历史
  if (r.content_path) pushVersion(r, r.content_path, r.file_size, 'rollback')
  // 历史版成为正文（从历史列表移除，避免双引用）
  db.prepare('DELETE FROM skill_versions WHERE id = ?').run(v.id)
  db.prepare("UPDATE skills SET content_path = ?, file_size = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(v.content_path, v.file_size, r.id)
  scheduleSkillsCsv()
  res.json(skillFull(getSkill(userId, r.id)!))
})

/* ---------------- 批量管理（v0.4.8） ---------------- */

/** POST /api/skills/batch {ids, action: move|star|unstar|delete, folderId?}
 *  单事务；越权 id 计入失败明细；delete=软删入回收站 */
skillsApi.post('/skills/batch', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { ids, action, folderId } = req.body ?? {}
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_required' })
  if (!['move', 'star', 'unstar', 'delete'].includes(action)) return res.status(400).json({ error: 'bad_action' })
  if (action === 'move' && folderId !== null && folderId !== undefined) {
    const folder = db.prepare('SELECT id FROM skill_folders WHERE id = ? AND user_id = ?').get(Number(folderId), userId)
    if (!folder) return res.status(400).json({ error: 'folder_not_found' })
  }

  const failed: number[] = []
  const updFolder = db.prepare('UPDATE skills SET folder_id = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ? AND user_id = ?')
  const updFav = db.prepare('UPDATE skills SET favorite = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ? AND user_id = ?')
  const del = db.prepare("UPDATE skills SET deleted_at = datetime('now','localtime') WHERE id = ? AND user_id = ? AND deleted_at IS NULL")
  db.transaction(() => {
    for (const raw of ids) {
      const id = Number(raw)
      if (action === 'move') {
        const r = updFolder.run(folderId ?? null, id, userId)
        if (!r.changes) failed.push(id)
      } else if (action === 'star' || action === 'unstar') {
        const r = updFav.run(action === 'star' ? 1 : 0, id, userId)
        if (!r.changes) failed.push(id)
      } else {
        const r = del.run(id, userId)
        if (!r.changes) failed.push(id)
      }
    }
  })()
  scheduleSkillsCsv()
  res.json({ ok: true, affected: ids.length - failed.length, failed })
})

/* ---------------- 分组 ---------------- */

skillsApi.post('/skill-folders', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const { name, icon = 'folder', iconColor = null } = req.body ?? {}
  if (!name?.trim()) return res.status(400).json({ error: 'name_required' })
  const dup = db.prepare('SELECT id FROM skill_folders WHERE user_id = ? AND name = ?').get(userId, name.trim())
  if (dup) return res.status(409).json({ error: 'name_duplicated' })
  const order = (db.prepare('SELECT COUNT(*) AS n FROM skill_folders WHERE user_id = ?').get(userId) as { n: number }).n
  const id = Number(
    db.prepare('INSERT INTO skill_folders (user_id, name, icon, icon_color, sort_order) VALUES (?, ?, ?, ?, ?)')
      .run(userId, name.trim(), icon, iconColor, order + 1).lastInsertRowid,
  )
  res.json({ id })
})

skillsApi.delete('/skill-folders/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const f = db.prepare('SELECT id FROM skill_folders WHERE id = ? AND user_id = ?').get(Number(req.params.id), userId)
  if (!f) return res.status(404).json({ error: 'not_found' })
  db.prepare('UPDATE skills SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(Number(req.params.id), userId)
  db.prepare('DELETE FROM skill_folders WHERE id = ?').run(Number(req.params.id))
  scheduleSkillsCsv()
  res.json({ ok: true })
})

/** 重命名 / 换图标（v0.4.1：对齐书签分组能力，仅一级） */
skillsApi.patch('/skill-folders/:id', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const f = db.prepare('SELECT id FROM skill_folders WHERE id = ? AND user_id = ?').get(Number(req.params.id), userId)
  if (!f) return res.status(404).json({ error: 'not_found' })
  const { name, icon, iconColor } = req.body ?? {}
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ error: 'name_required' })
    const dup = db
      .prepare('SELECT id FROM skill_folders WHERE user_id = ? AND name = ? AND id != ?')
      .get(userId, String(name).trim(), Number(req.params.id))
    if (dup) return res.status(409).json({ error: 'name_duplicated' })
    db.prepare('UPDATE skill_folders SET name = ? WHERE id = ?').run(String(name).trim().slice(0, 50), Number(req.params.id))
  }
  if (icon !== undefined) db.prepare('UPDATE skill_folders SET icon = ? WHERE id = ?').run(String(icon), Number(req.params.id))
  if (iconColor !== undefined) db.prepare('UPDATE skill_folders SET icon_color = ? WHERE id = ?').run(iconColor, Number(req.params.id))
  scheduleSkillsCsv()
  res.json({ ok: true })
})

/** 一级分组拖拽排序（v0.4.1） */
skillsApi.post('/skill-folders/reorder', requireAuth, (req, res) => {
  const userId = uid(req as AuthedRequest)
  const ids: number[] = Array.isArray(req.body?.orderedIds) ? req.body.orderedIds.map(Number) : []
  if (!ids.length) return res.status(400).json({ error: 'ids_required' })
  const owned = new Set(
    (db.prepare('SELECT id FROM skill_folders WHERE user_id = ?').all(userId) as Array<{ id: number }>).map((r) => r.id),
  )
  if (ids.some((id) => !owned.has(id))) return res.status(400).json({ error: 'foreign_id' })
  const upd = db.prepare('UPDATE skill_folders SET sort_order = ? WHERE id = ?')
  db.transaction(() => ids.forEach((id, i) => upd.run(i + 1, id)))()
  res.json({ ok: true })
})


