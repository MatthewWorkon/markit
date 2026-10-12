/** 数据模型 · 对齐 PRD §6.3（视觉阶段为本地 mock，后端落地时同构替换） */

export interface Folder {
  id: number
  name: string
  parentId: number | null
  icon: string // Phosphor 图标 key（见 utils/folder-icons.ts）
  iconColor?: string | null // 图标底色 key（null = 中性白底）
  description?: string // hover 目录名时以 tooltip 显示（B13）
  sortOrder: number
}

export interface Tag {
  id: number
  name: string
}

export interface Bookmark {
  id: number
  title: string
  url: string
  description: string
  favicon: string | null // 服务端图标地址（内置 /icons/*.svg 或 /api/fav/*）
  folderIds: number[] // 多分组绑定（BK-006），数组序 = 分组内手动顺序
  folderOrders: Record<number, number> // 分组ID → 组内手动顺序（manual 排序用）
  tagIds: number[]
  tags: string[] // 冗余的标签名（服务端随行返回）
  favorite: boolean
  pinned: boolean
  needVpn: boolean // 黑名单制：仅已知被墙站点为 true
  visitCount: number
  source: 'web' | 'ext' // 来源：web=网页端 ext=浏览器扩展（网页转存栏）
  sortOrder: number | null // 全局手动顺序（manual 排序模式用）
  pinOrder: number | null // Pin 宫格顺序（仅已固定时有值）
  createdAt: string // ISO
  updatedAt: string
  deleted: boolean
  deletedAt: string | null
}

export interface UserInfo {
  username: string
  nickname: string
  isAdmin: boolean
}

/** 当前视图（首页主区内容来源） */
export type ViewId =
  | { kind: 'all' }
  | { kind: 'recent' }
  | { kind: 'favorite' }
  | { kind: 'uncategorized' }
  | { kind: 'ext' }
  | { kind: 'folder'; folderId: number }
  | { kind: 'tag'; tagId: number }
  | { kind: 'trash' }
  | { kind: 'vpn' }
