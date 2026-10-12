import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** 数据目录（容器内 /app/data，本地开发 ./data） */
export const DATA_DIR = process.env.MARKIT_DATA_DIR || join(process.cwd(), 'data')
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(join(DATA_DIR, 'favicons'), { recursive: true })

export const db = new Database(join(DATA_DIR, 'app.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  icon TEXT NOT NULL DEFAULT 'folder',
  icon_color TEXT,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(user_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  favicon TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  need_vpn INTEGER NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS bookmark_folders (
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, folder_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS bookmark_tags (
  bookmark_id INTEGER NOT NULL REFERENCES bookmarks(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (bookmark_id, tag_id)
);

CREATE TABLE IF NOT EXISTS ai_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL DEFAULT 'zhipu',
  base_url TEXT NOT NULL DEFAULT 'https://open.bigmodel.cn/api/paas/v4',
  model TEXT NOT NULL DEFAULT 'glm-4-flash',
  api_key TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
INSERT OR IGNORE INTO ai_settings (id) VALUES (1);
`);

/* ---------------- v0.4：Skills 管理 ---------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content_path TEXT,
  scope TEXT NOT NULL DEFAULT 'global',
  project_name TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  github_url TEXT NOT NULL DEFAULT '',
  github_author TEXT NOT NULL DEFAULT '',
  folder_id INTEGER REFERENCES skill_folders(id) ON DELETE SET NULL,
  is_public INTEGER NOT NULL DEFAULT 0,
  file_size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_skills_user ON skills(user_id);
CREATE INDEX IF NOT EXISTS idx_skills_public ON skills(is_public);

CREATE TABLE IF NOT EXISTS skill_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder',
  icon_color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, name)
);
`)

/* ---------------- v0.2：分享 / 站点设置 ---------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  bookmark_id INTEGER REFERENCES bookmarks(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  need_password INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT '',
  expires_at TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_share_token ON share_links(token);

CREATE TABLE IF NOT EXISTS skill_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  content_path TEXT,
  file_size INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'edit',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_skill_versions ON skill_versions(skill_id);

-- 广场条目收藏（跨用户：user_id 收藏了他人公开的 skill_id）
CREATE TABLE IF NOT EXISTS skill_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '浏览器扩展',
  token TEXT NOT NULL UNIQUE,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens(token);

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  allow_register INTEGER NOT NULL DEFAULT 1,
  vpn_check INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO site_settings (id) VALUES (1);
`)

/* ---------------- VPN 黑名单（BK-104，黑名单制：仅已知被墙站点） ---------------- */

export const VPN_BLOCKLIST: string[] = [
  'google.com', 'youtube.com', 'youtu.be', 'gmail.com', 'googleapis.com',
  'facebook.com', 'instagram.com', 'whatsapp.com', 'messenger.com',
  'twitter.com', 'x.com', 'tiktok.com',
  'openai.com', 'chatgpt.com', 'sora.com',
  'anthropic.com', 'claude.ai',
  'wikipedia.org', 'wikimedia.org',
  'telegram.org', 't.me', 'discord.com', 'discordapp.com',
  'reddit.com', 'medium.com', 'quora.com', 'stackexchange.com',
  'pinterest.com', 'tumblr.com', 'snapchat.com', 'linkedin.com',
  'twitch.tv', 'vimeo.com', 'soundcloud.com', 'spotify.com',
  'netflix.com', 'hulu.com', 'disneyplus.com', 'primevideo.com',
  'dropbox.com', 'box.com', 'mediafire.com',
  'archive.org', 'imgur.com', 'gfycat.com', 'streamable.com',
  'notion.so', 'figma.com', 'slack.com', 'zoom.us', 'vercel.com',
  'docker.com', 'docker.io', 'npmjs.com', 'stackoverflow.com', 'github.io',
  'huggingface.co', 'colab.researchstan.com', 'kaggle.com', 'paperswithcode.com',
  'cloudflare.com', 'fastly.net', 'amazonaws.com', 'azure.com',
  'bloomberg.com', 'nytimes.com', 'bbc.com', 'cnn.com', 'reuters.com',
  'github.com/gist', 'chrome.google.com', 'addons.mozilla.org',
  'perplexity.ai', 'midjourney.com', 'runwayml.com', 'elevenlabs.io',
  'dribbble.com', 'behance.net', 'unsplash.com', 'pexels.com',
  'producthunt.com', 'news.ycombinator.com', 'hn.algolia.com',
]

/** 域名后缀匹配黑名单（含子域） */
export function needsVpn(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return false
  }
  return VPN_BLOCKLIST.some((d) => host === d || host.endsWith('.' + d))
}

/** 存量迁移：对未标记书签跑一遍黑名单（仅补 true，不动已标记/已取消的） */
function backfillVpn() {
  const rows = db
    .prepare('SELECT id, url FROM bookmarks WHERE need_vpn = 0')
    .all() as Array<{ id: number; url: string }>
  const upd = db.prepare('UPDATE bookmarks SET need_vpn = 1 WHERE id = ?')
  for (const r of rows) if (needsVpn(r.url)) upd.run(r.id)
}

/* ---------------- 种子（BK-018 + 演示数据） ---------------- */

const ADMIN_PASSWORD = process.env.MARKIT_ADMIN_PASSWORD || '0000'

function seed() {
  const userCount = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
  if (userCount > 0) return

  const hash = (pw: string) => bcrypt.hashSync(pw, 10)
  const insertUser = db.prepare(
    `INSERT INTO users (username, password_hash, nickname, is_admin, must_change_password)
     VALUES (?, ?, ?, ?, ?)`,
  )

  // 最高权限管理员：首登强制改密（2026-10-08 决策）
  insertUser.run('admin', hash(ADMIN_PASSWORD), '管理员', 1, 1)
  console.log('[seed] 已创建账号 admin（管理员，首次登录需修改默认密码）')

  // 测试账号 + 演示书签库（仅当 MARKIT_SEED_DEMO=1，默认开启便于体验）
  if (process.env.MARKIT_SEED_DEMO !== '0') {
    const demoId = (
      insertUser.run('markit_demo', hash('password123'), '演示用户', 0, 0).lastInsertRowid as number
    )
    console.log('[seed] 已创建账号 markit_demo（演示用户）')
    seedDemoLibrary(demoId)
  }
}

/** 品牌 favicon → 打包内置图标（离线可用） */
const BRAND_ICONS: Record<string, string> = {
  'github.com': '/icons/github.svg',
  'developer.mozilla.org': '/icons/mdnwebdocs.svg',
  'cn.vuejs.org': '/icons/vuedotjs.svg',
  'vite.dev': '/icons/vite.svg',
  'tailwindcss.com': '/icons/tailwindcss.svg',
  'huggingface.co': '/icons/huggingface.svg',
  'news.ycombinator.com': '/icons/ycombinator.svg',
  'hub.docker.com': '/icons/docker.svg',
  'tailscale.com': '/icons/tailscale.svg',
  'figma.com': '/icons/figma.svg',
  'dribbble.com': '/icons/dribbble.svg',
  'excalidraw.com': '/icons/excalidraw.svg',
  'producthunt.com': '/icons/producthunt.svg',
  'bilibili.com': '/icons/bilibili.svg',
}

function seedDemoLibrary(uid: number) {
  const insFolder = db.prepare(
    `INSERT INTO folders (user_id, name, parent_id, icon, icon_color, description, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const folders: Record<string, number> = {}
  const mk = (name: string, parentId: number | null, icon: string, color: string | null, desc: string, order: number) => {
    folders[name] = Number(
      insFolder.run(uid, name, parentId, icon, color, desc, order).lastInsertRowid,
    )
  }
  mk('前端开发', null, 'code', 'blue', '日常开发高频站点与文档', 1)
  mk('设计资源', null, 'palette', 'pink', '灵感、素材与设计工具', 2)
  mk('灵感采集', folders['设计资源'], 'lightbulb', 'amber', 'Dribbble / Behance 灵感流', 1)
  mk('AI 工具', null, 'sparkle', 'purple', '大模型与生产力工具', 3)
  mk('NAS 与自托管', null, 'hardDrives', 'green', '飞牛 fnOS、Docker 与自建服务', 4)
  mk('阅读资讯', null, 'newspaper', null, '技术周刊、社区与新闻', 5)

  const insTag = db.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)')
  const tags: Record<string, number> = {}
  for (const n of ['文档', 'AI', '设计', '前端', '自托管', '效率', '周刊']) {
    tags[n] = Number(insTag.run(uid, n).lastInsertRowid)
  }

  type Demo = [string, string, string, string[], string[], 0 | 1, 0 | 1, string]
  const rows: Demo[] = [
    ['GitHub', 'https://github.com', '全球最大代码托管平台，开源项目与协作开发的核心阵地。', ['前端开发'], ['前端'], 1, 1, '2026-04-12 09:20:00'],
    ['MDN Web Docs', 'https://developer.mozilla.org/zh-CN/', 'Mozilla 官方 Web 技术文档，HTML / CSS / JavaScript 权威参考。', ['前端开发'], ['文档'], 1, 0, '2026-09-28 21:04:00'],
    ['Vue.js 官方文档', 'https://cn.vuejs.org', '渐进式 JavaScript 框架，中文文档完整覆盖 API 与生态指南。', ['前端开发'], ['文档', '前端'], 0, 0, '2026-09-15 10:42:00'],
    ['Vite', 'https://vite.dev', '下一代前端构建工具，冷启动与热更新速度的标杆。', ['前端开发'], ['前端', '文档'], 0, 0, '2026-07-30 15:40:00'],
    ['Tailwind CSS', 'https://tailwindcss.com', '原子化 CSS 框架，实用优先的样式书写方式。', ['前端开发'], ['前端', '文档'], 0, 0, '2026-08-27 14:02:00'],
    ['ChatGPT', 'https://chatgpt.com', 'OpenAI 对话式助手，日常问答、写作与代码生成的主力工具。', ['AI 工具'], ['AI', '效率'], 1, 1, '2026-10-02 08:30:00'],
    ['Hugging Face', 'https://huggingface.co', '开源模型社区，数据集、模型权重与在线 Demo 一站获取。', ['AI 工具'], ['AI'], 0, 0, '2026-08-19 14:11:00'],
    ['智谱 AI 开放平台', 'https://open.bigmodel.cn', 'GLM 系列模型 API，AI 简介生成候选绑定服务。', ['AI 工具'], ['AI', '自托管'], 0, 0, '2026-09-25 11:07:00'],
    ['少数派', 'https://sspai.com', '高质量数字工具评测与效率方法论，更新勤、干货密度高。', ['阅读资讯'], ['效率'], 1, 1, '2026-10-06 22:47:00'],
    ['Hacker News', 'https://news.ycombinator.com', 'Y Combinator 技术社区，每天扫一遍的技术动态源头。', ['阅读资讯'], ['周刊'], 0, 0, '2026-09-30 09:03:00'],
    ['V2EX', 'https://v2ex.com', '创意工作者社区，程序员话题浓度最高的中文论坛之一。', ['阅读资讯'], ['周刊'], 0, 0, '2026-09-21 23:12:00'],
    ['科技爱好者周刊', 'https://www.ruanyifeng.com/blog/', '阮一峰每周技术综述，工具、文章与资源筛选质量稳定。', ['阅读资讯'], ['周刊', '文档'], 1, 0, '2026-10-03 08:45:00'],
    ['Product Hunt', 'https://producthunt.com', '新产品发布社区，发现有趣工具的每日来源。', ['阅读资讯'], ['周刊'], 0, 0, '2026-09-12 12:19:00'],
    ['Bilibili 科技区', 'https://www.bilibili.com/v/tech/', '技术视频主聚集地，装机、NAS、编程教程应有尽有。', [], [], 0, 0, '2026-05-06 21:33:00'],
    ['飞牛OS 论坛', 'https://www.fnnas.com', '飞牛 fnOS 官方社区，教程、套件与问题反馈的第一手信息。', ['NAS 与自托管'], ['自托管'], 1, 0, '2026-07-22 19:35:00'],
    ['Docker Hub', 'https://hub.docker.com', '官方镜像仓库，自建服务部署拉镜像的必经之路。', ['NAS 与自托管'], ['自托管'], 0, 0, '2026-06-10 11:26:00'],
    ['Tailscale', 'https://tailscale.com', '基于 WireGuard 的零配置组网，异地访问 NAS 的备选通道。', ['NAS 与自托管'], ['自托管', '效率'], 0, 0, '2026-05-18 16:08:00'],
    ['Figma', 'https://figma.com', '在线协作设计工具，界面稿、原型与设计系统都在这里。', ['设计资源'], ['设计'], 1, 0, '2026-04-25 13:59:00'],
    ['Dribbble', 'https://dribbble.com', '设计师作品展示社区，界面灵感与视觉趋势风向标。', ['设计资源', '灵感采集'], ['设计'], 0, 0, '2026-09-08 17:22:00'],
    ['iconfont 阿里图标库', 'https://www.iconfont.cn', '阿里矢量图标库，中文项目图标检索与批量管理首选。', ['设计资源'], ['设计', '前端'], 0, 0, '2026-08-02 10:15:00'],
    ['Excalidraw', 'https://excalidraw.com', '手绘风白板，架构草图与方案沟通的轻量利器。', ['设计资源'], ['效率'], 0, 0, '2026-10-05 20:31:00'],
  ]

  const insBm = db.prepare(
    `INSERT INTO bookmarks (user_id, title, url, description, favicon, favorite, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insBf = db.prepare('INSERT OR IGNORE INTO bookmark_folders (bookmark_id, folder_id) VALUES (?, ?)')
  const insBt = db.prepare('INSERT OR IGNORE INTO bookmark_tags (bookmark_id, tag_id) VALUES (?, ?)')

  for (const [title, url, desc, fns, tns, fav, pin, createdAt] of rows) {
    let favicon: string | null = null
    try {
      const host = new URL(url).hostname.replace(/^www\./, '')
      favicon = BRAND_ICONS[host] ?? null
    } catch { /* ignore */ }
    const id = Number(
      insBm.run(uid, title, url, desc, favicon, fav, pin, createdAt, createdAt).lastInsertRowid,
    )
    for (const fn of fns) if (folders[fn]) insBf.run(id, folders[fn])
    for (const tn of tns) if (tags[tn]) insBt.run(id, tags[tn])
  }
}

seed()
backfillVpn() // 须在 seed 之后：种子与存量一次性回填

// 旧库迁移：AI 配置初始默认值为空的字段补上（不影响已保存的真实 Key）
db.exec(`
  UPDATE ai_settings SET provider='zhipu' WHERE provider='';
  UPDATE ai_settings SET base_url='https://open.bigmodel.cn/api/paas/v4' WHERE base_url='';
  UPDATE ai_settings SET model='glm-4-flash' WHERE model='';
`)

/* ---------------- 手动排序迁移（BK-109） ---------------- */

/** 为表补列（不存在才加） */
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
}

ensureColumn('bookmarks', 'sort_order', 'sort_order INTEGER')
ensureColumn('bookmarks', 'last_visited_at', 'last_visited_at TEXT')
ensureColumn('bookmarks', 'source', "source TEXT NOT NULL DEFAULT 'web'") // web=网页端 ext=浏览器扩展
ensureColumn('bookmarks', 'pin_order', 'pin_order INTEGER')
ensureColumn('bookmark_folders', 'sort_order', 'sort_order INTEGER')
ensureColumn('skills', 'favorite', 'favorite INTEGER NOT NULL DEFAULT 0') // Skills 星标（v0.4.1）
ensureColumn('share_links', 'skill_id', 'skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE') // Skill 分享（v0.4.1）
ensureColumn('skills', 'github_path', "github_path TEXT DEFAULT ''") // GitHub 导入来源文件路径，用于检查更新（v0.4.5）
ensureColumn('skills', 'download_count', 'download_count INTEGER NOT NULL DEFAULT 0') // 下载/导出计数（v0.4.5）

/** 回填：按创建时间倒序编号（与默认视图一致）；仅补空值，不动已排过的 */
function backfillSort() {
  // 全局书签顺序
  const bmRows = db
    .prepare(`SELECT id, user_id FROM bookmarks ORDER BY user_id, created_at DESC, id DESC`)
    .all() as Array<{ id: number; user_id: number }>
  const lastByUser = new Map<number, number>()
  const updBm = db.prepare(`UPDATE bookmarks SET sort_order = ? WHERE id = ? AND sort_order IS NULL`)
  for (const r of bmRows) {
    const next = (lastByUser.get(r.user_id) ?? 0) + 1
    lastByUser.set(r.user_id, next)
    updBm.run(next, r.id)
  }
  // Pin 顺序（仅已固定的行）
  const pinRows = db
    .prepare(`SELECT id, user_id FROM bookmarks WHERE pinned = 1 ORDER BY user_id, created_at DESC, id DESC`)
    .all() as Array<{ id: number; user_id: number }>
  const lastByUser2 = new Map<number, number>()
  const updPin = db.prepare(`UPDATE bookmarks SET pin_order = ? WHERE id = ? AND pin_order IS NULL`)
  for (const r of pinRows) {
    const next = (lastByUser2.get(r.user_id) ?? 0) + 1
    lastByUser2.set(r.user_id, next)
    updPin.run(next, r.id)
  }
  // 分组内书签顺序（bookmark_folders 关联序）
  const bfRows = db
    .prepare(
      `SELECT bf.bookmark_id, bf.folder_id, COALESCE(b.created_at, '') AS created_at, b.user_id
       FROM bookmark_folders bf JOIN bookmarks b ON b.id = bf.bookmark_id
       ORDER BY bf.folder_id, b.created_at DESC, bf.bookmark_id DESC`,
    )
    .all() as Array<{ bookmark_id: number; folder_id: number; created_at: string; user_id: number }>
  const lastByFolder = new Map<number, number>()
  const updBf = db.prepare(`UPDATE bookmark_folders SET sort_order = ? WHERE bookmark_id = ? AND folder_id = ? AND sort_order IS NULL`)
  for (const r of bfRows) {
    const next = (lastByFolder.get(r.folder_id) ?? 0) + 1
    lastByFolder.set(r.folder_id, next)
    updBf.run(next, r.bookmark_id, r.folder_id)
  }
}
backfillSort()


/* ---------------- 回收站自动清理（BK-106：软删 30 天后物理清除） ---------------- */

export function purgeExpiredTrash(days = 30) {
  const cutoff = new Date(Date.now() - days * 86400_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')
  const info = db.prepare('DELETE FROM bookmarks WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff)
  if (info.changes > 0) console.log(`[trash] 自动清理 ${info.changes} 条过期回收站书签`)
}
purgeExpiredTrash()
setInterval(() => purgeExpiredTrash(), 24 * 3600_000).unref()
