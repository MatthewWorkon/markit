import { db } from './db.js'
import { ensureFavicon, fetchPageMeta } from './fetch.js'

/**
 * 保存后后台补全真标题 + 图标（点击即保存，BK-002 体验优化）。
 * 内存队列防重；进程重启丢失的任务量极小（仅保存后几秒内的），可接受。
 */
const enriching = new Set<number>()

export function queueEnrich(
  id: number,
  url: string,
  fallbackTitle: string,
  faviconOnly = false,
) {
  if (enriching.has(id)) return
  enriching.add(id)
  void fallbackTitle // 占位标题已在库中；后台只负责升级为真标题/图标
  // 让响应先走完
  setTimeout(() => {
    void (async () => {
      try {
        const meta = faviconOnly ? { title: null as string | null, iconHref: null } : await fetchPageMeta(url)
        let fav: string | null = null
        try {
          fav = await ensureFavicon(url, meta)
        } catch { /* 字母块兜底 */ }

        const sets: string[] = []
        const vals: Array<string | number | null> = []
        if (!faviconOnly && meta.title) {
          sets.push('title = ?')
          vals.push(meta.title.slice(0, 300))
        }
        if (fav) {
          sets.push('favicon = ?')
          vals.push(fav)
        }
        if (sets.length) {
          sets.push("updated_at = datetime('now','localtime')")
          db.prepare(`UPDATE bookmarks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id)
        }
      } catch {
        // 静默失败：保留占位标题，用户可手动编辑触发重抓
      } finally {
        enriching.delete(id)
      }
    })()
  }, 50)
}
