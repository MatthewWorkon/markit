import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { db, DATA_DIR } from './db.js'

/**
 * CSV 实时镜像（BK-017，2026-10-08 决策：1.5s 防抖全量重写）。
 * 定位 = 信息留底；完整结构恢复以 JSON 导出为准。
 * UTF-8 带 BOM，Excel/WPS 直接打开不乱码。
 */

const COLUMNS = [
  '用户',
  '标题',
  '网址',
  '简介',
  '所属分组',
  '标签',
  '星标',
  '固定',
  '状态',
  '创建时间',
  '更新时间',
  '删除时间',
]

function csvCell(v: string | null | undefined): string {
  const s = v ?? ''
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

let timer: ReturnType<typeof setTimeout> | null = null
let writing = false

export function scheduleCsvMirror() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(rewriteCsv, 1500)
}

export function rewriteCsvNow() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  rewriteCsv()
}

function rewriteCsv() {
  if (writing) return scheduleCsvMirror()
  writing = true
  try {
    const rows = db
      .prepare(
        `SELECT u.username, b.title, b.url, b.description, b.favorite, b.pinned,
                b.created_at, b.updated_at, b.deleted_at
         FROM bookmarks b JOIN users u ON u.id = b.user_id
         ORDER BY u.username, b.created_at DESC`,
      )
      .all() as Array<{
      username: string; title: string; url: string; description: string
      favorite: number; pinned: number; created_at: string; updated_at: string
      deleted_at: string | null
    }>

    const folderNames = new Map<number, string>()
    for (const f of db.prepare('SELECT id, name FROM folders').all() as Array<{ id: number; name: string }>) {
      folderNames.set(f.id, f.name)
    }
    const tagNames = new Map<number, string>()
    for (const t of db.prepare('SELECT id, name FROM tags').all() as Array<{ id: number; name: string }>) {
      tagNames.set(t.id, t.name)
    }
    const bf = db
      .prepare('SELECT bookmark_id, folder_id FROM bookmark_folders')
      .all() as Array<{ bookmark_id: number; folder_id: number }>
    const bt = db
      .prepare('SELECT bookmark_id, tag_id FROM bookmark_tags')
      .all() as Array<{ bookmark_id: number; tag_id: number }>
    const bmFolders = new Map<number, string[]>()
    for (const r of bf) {
      const list = bmFolders.get(r.bookmark_id) ?? []
      list.push(folderNames.get(r.folder_id) ?? '')
      bmFolders.set(r.bookmark_id, list)
    }
    const bmTags = new Map<number, string[]>()
    for (const r of bt) {
      const list = bmTags.get(r.bookmark_id) ?? []
      list.push(tagNames.get(r.tag_id) ?? '')
      bmTags.set(r.bookmark_id, list)
    }

    const lines = ['\uFEFF' + COLUMNS.join(',')]
    const full = db
      .prepare(
        `SELECT b.id, u.username, b.title, b.url, b.description, b.favorite, b.pinned,
                b.created_at, b.updated_at, b.deleted_at
         FROM bookmarks b JOIN users u ON u.id = b.user_id
         ORDER BY u.username, b.created_at DESC`,
      )
      .all() as Array<typeof rows[number] & { id: number }>

    for (const r of full) {
      lines.push(
        [
          r.username,
          r.title,
          r.url,
          r.description,
          (bmFolders.get(r.id) ?? []).join('、') || '未分类',
          (bmTags.get(r.id) ?? []).join('、'),
          r.favorite ? '是' : '否',
          r.pinned ? '是' : '否',
          r.deleted_at ? '回收站' : '正常',
          r.created_at,
          r.updated_at,
          r.deleted_at ?? '',
        ]
          .map(csvCell)
          .join(','),
      )
    }

    writeFileSync(join(DATA_DIR, 'bookmarks-mirror.csv'), lines.join('\r\n'), 'utf-8')
  } catch (e) {
    // 磁盘满/权限等：不阻塞业务，记录日志，下次写操作重试（BK-017）
    console.error('[csv-mirror] 写入失败：', e)
  } finally {
    writing = false
  }
}

/* ---------------- Skills 镜像（v0.4.0） ---------------- */

let skillsTimer: ReturnType<typeof setTimeout> | null = null
export function scheduleSkillsCsv() {
  if (skillsTimer) clearTimeout(skillsTimer)
  skillsTimer = setTimeout(rewriteSkillsCsv, 1500)
}

function rewriteSkillsCsv() {
  try {
    const rows = db
      .prepare(
        `SELECT u.username, s.title, s.description, s.scope, s.project_name,
                s.source, s.github_url, s.is_public, s.file_size,
                s.created_at, s.updated_at, s.deleted_at
         FROM skills s JOIN users u ON u.id = s.user_id
         ORDER BY u.username, s.created_at DESC`,
      )
      .all() as Array<{
      username: string; title: string; description: string; scope: string
      project_name: string; source: string; github_url: string
      is_public: number; file_size: number; created_at: string
      updated_at: string; deleted_at: string | null
    }>
    const lines = ['\uFEFF用户,标题,描述,范围,项目,来源,GitHub链接,公开,大小B,状态,创建时间,更新时间,删除时间']
    for (const r of rows) {
      lines.push(
        [
          r.username,
          r.title,
          r.description,
          r.scope === 'project' ? `项目:${r.project_name}` : '全局',
          r.source,
          r.github_url,
          r.is_public ? '公开' : '私有',
          r.file_size,
          r.deleted_at ? '回收站' : '正常',
          r.created_at,
          r.updated_at,
          r.deleted_at ?? '',
        ]
          .map((v) => {
            const s = String(v ?? '')
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          })
          .join(','),
      )
    }
    writeFileSync(join(DATA_DIR, 'skills-mirror.csv'), lines.join('\r\n'), 'utf-8')
  } catch (e) {
    console.error('[skills-csv] 写入失败：', e)
  }
}
