/** 通用工具 */

/** 提取主机名（去 www），用于卡片 URL 展示 */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 相对时间：3 天内精确到时分，更早显示日期（跟随界面语言） */
export function timeAgo(iso: string, locale = 'zh-CN', now = new Date()): string {
  const en = locale.startsWith('en')
  const d = new Date(iso)
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return en ? 'just now' : '刚刚'
  if (diffMin < 60) return en ? `${diffMin}m ago` : `${diffMin} 分钟前`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return en ? `${diffH}h ago` : `${diffH} 小时前`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return en ? `${diffD}d ago` : `${diffD} 天前`
  const y = d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}/`
  return `${y}${d.getMonth() + 1}/${d.getDate()}`
}

/** favicon 地址：品牌 slug 走本地打包图标（离线可用），否则由组件渲染字母块兜底 */
export function faviconUrl(slug?: string): string | null {
  if (!slug) return null
  return `/icons/${slug}.svg`
}

/** 字符串 → 稳定哈希（标签色板分配） */
export function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/** 标签色板（1–5，对应 tokens 中 --mk-tag-*） */
export function tagPalette(name: string): 1 | 2 | 3 | 4 | 5 {
  return ((hashStr(name) % 5) + 1) as 1 | 2 | 3 | 4 | 5
}

/** 字母块配色（favicon 兜底）：浅色=淡底深字，暗色=深底浅字 */
const TILE_LIGHT: Array<[string, string]> = [
  ['#e9f0fb', '#35569c'],
  ['#e9f5ec', '#2c7a42'],
  ['#faf0e3', '#96690b'],
  ['#f9e9f2', '#9c4473'],
  ['#efecf9', '#55489c'],
]

const TILE_DARK: Array<[string, string]> = [
  ['#1c2740', '#8fa8dc'],
  ['#16291c', '#7fc796'],
  ['#2c2312', '#d3a94f'],
  ['#331e2a', '#d093b8'],
  ['#241f3b', '#a79bdf'],
]

export function letterTileHue(ch: string, dark = false): string {
  const palettes = dark ? TILE_DARK : TILE_LIGHT
  const i = hashStr(ch) % 5
  return palettes[i]!.join('|')
}
