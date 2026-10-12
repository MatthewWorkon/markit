import { db } from './db.js'

type Full = Record<string, unknown>

let patchImpl: ((userId: number, id: number, patch: { title?: string; description?: string }) => Promise<Full>) | null = null

/** index.ts 注入 api.ts 的更新实现（防循环 import） */
export function registerExtPatch(impl: typeof patchImpl) {
  patchImpl = impl
}

/** 扩展编辑：按 URL 定位并更新标题/简介（不触发重抓） */
export async function updateBookmarkByExt(
  userId: number,
  input: { url: string; title: string; description: string },
): Promise<Full> {
  const norm = input.url.replace(/\/+$/, '')
  const row = db
    .prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND deleted_at IS NULL')
    .get(userId, norm) as { id: number } | undefined
  if (!row || !patchImpl) throw new Error('not_found')
  const t = input.title.trim()
  const patch: { title?: string; description?: string } = {}
  if (t) patch.title = t
  if (input.description) patch.description = input.description
  return patchImpl(userId, row.id, patch)
}
