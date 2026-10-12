/** 目标页面抓取（标题/favicon）：短超时、失败返回 null，绝不阻塞收藏主流程 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './db.js'

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()

export interface PageMeta {
  title: string | null
  /** HTML 里声明的 icon 地址（相对地址已拼接） */
  iconHref: string | null
}

/** 拉一次 HTML，同时取标题与 icon 声明 */
export async function fetchPageMeta(url: string, timeoutMs = 3000): Promise<PageMeta> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!r.ok) return { title: null, iconHref: null }
    const html = (await r.text()).slice(0, 120_000)

    const rawTitle =
      /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1]
    const title = rawTitle ? decodeEntities(rawTitle.replace(/<[^>]+>/g, '')) || null : null

    let iconHref: string | null = null
    // 优先 svg → shortcut/任意 icon；按出现顺序取第一个命中的
    const linkRe = /<link[^>]+>/gi
    let m: RegExpExecArray | null
    const candidates: Array<{ rel: string; href: string }> = []
    while ((m = linkRe.exec(html))) {
      const tag = m[0]
      const rel = /rel=["']([^"']*)["']/i.exec(tag)?.[1] ?? ''
      const href = /href=["']([^"']*)["']/i.exec(tag)?.[1]
      if (rel && href && /icon/i.test(rel)) candidates.push({ rel: rel.toLowerCase(), href })
    }
    const pick =
      candidates.find((c) => c.href.endsWith('.svg')) ??
      candidates.find((c) => /apple-touch/.test(c.rel)) ??
      candidates[0]
    if (pick) {
      try {
        iconHref = new URL(pick.href, url).toString()
      } catch {
        iconHref = null
      }
    }
    return { title, iconHref }
  } catch {
    return { title: null, iconHref: null }
  }
}

/** 兼容旧调用 */
export async function fetchPageTitle(url: string, timeoutMs = 3000): Promise<string | null> {
  return (await fetchPageMeta(url, timeoutMs)).title
}

const EXT_BY_TYPE: Record<string, string> = {
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

/** 下载 favicon 到 destBase.{ext}，成功返回扩展名；非图片/超限/失败返回 null */
export async function downloadFavicon(iconUrl: string, destBase: string): Promise<string | null> {
  try {
    const r = await fetch(iconUrl, {
      headers: { 'User-Agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(2500),
    })
    if (!r.ok) return null
    const type = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    const ext = EXT_BY_TYPE[type]
    if (!ext) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length === 0 || buf.length > 300_000) return null
    const { writeFileSync } = await import('node:fs')
    writeFileSync(`${destBase}.${ext}`, buf)
    return ext
  } catch {
    return null
  }
}

/** 域名 → 本地 favicon 文件名安全段 */
const safeHost = (host: string) => host.replace(/[^a-zA-Z0-9.-]/g, '_')


export async function ensureFavicon(url: string, knownMeta?: PageMeta): Promise<string | null> {
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    return null
  }
  const safe = safeHost(host)
  const dir = join(DATA_DIR, 'favicons')
  const existing = ['svg', 'ico', 'png', 'jpg', 'webp', 'gif', 'avif'].find((ext) =>
    existsSync(join(dir, `${safe}.${ext}`)),
  )
  if (existing) return `/favicons/${safe}.${existing}`

  const meta = knownMeta ?? (await fetchPageMeta(url))
  const candidates: string[] = []
  if (meta.iconHref) candidates.push(meta.iconHref)
  try {
    candidates.push(new URL('/favicon.ico', url).toString())
  } catch { /* ignore */ }
  for (const iconUrl of candidates) {
    const ext = await downloadFavicon(iconUrl, join(dir, safe))
    if (ext) return `/favicons/${safe}.${ext}`
  }
  return null
}
