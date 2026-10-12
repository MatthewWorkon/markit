import express from 'express'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { db, DATA_DIR } from './db.js'
import { rewriteCsvNow } from './csv.js'
import { api } from './api.js'
import { ai } from './ai.js'
import { share } from './share.js'
import { extTokens, extApi, registerExtCreate } from './ext.js'
import { skillsApi } from './skills.js'
import { createBookmarkInternal, patchBookmarkByExt } from './api.js'
import { registerExtPatch } from './ext-update.js'
import {
  attachUser,
  bcrypt,
  createSession,
  csrfGuard,
  destroySession,
  loginBlocked,
  recordLoginFailure,
  requireAdmin,
  requireAuth,
  resetLoginFailures,
  type AuthedRequest,
} from './auth.js'

const PORT = Number(process.env.PORT || 8340)
const app = express()

app.disable('x-powered-by')
app.use(express.json({ limit: '64mb' })) // 导入 HTML 可达数十 MB
app.use(attachUser)
// CSRF：访客分享查看接口无会话，豁免；其余变更请求必须带自定义头
app.use('/api', (req, res, next) => {
  // 访客分享查看与扩展 Bearer 接口无会话，豁免 CSRF
  if ((req.path.startsWith('/share/') || req.path.startsWith('/ext/')) && req.method === 'POST') return next()
  csrfGuard(req, res, next)
})

/* ---------------- 认证 ---------------- */

app.post('/api/auth/register', (req, res) => {
  const site = db.prepare('SELECT allow_register FROM site_settings WHERE id = 1').get() as { allow_register: number }
  if (!site.allow_register) return res.status(403).json({ error: 'register_closed' })
  const { username, password, nickname } = req.body ?? {}
  if (!username || typeof username !== 'string' || !/^[a-zA-Z0-9_\u4e00-\u9fa5]{3,32}$/.test(username)) {
    return res.status(400).json({ error: 'username_rule' })
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password_rule' })
  }
  const dup = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (dup) return res.status(409).json({ error: 'username_taken' })
  const id = Number(
    db
      .prepare('INSERT INTO users (username, password_hash, nickname, is_admin) VALUES (?, ?, ?, 0)')
      .run(username, bcrypt.hashSync(password, 10), (nickname || username).slice(0, 32)).lastInsertRowid,
  )
  createSession(res, id)
  res.json({ user: { id, username, nickname: (nickname || username).slice(0, 32), isAdmin: false, mustChangePassword: false } })
})

app.get('/api/auth/register-status', (_req, res) => {
  const site = db.prepare('SELECT allow_register FROM site_settings WHERE id = 1').get() as { allow_register: number }
  res.json({ open: site.allow_register === 1 })
})

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip ?? 'unknown'
  const wait = loginBlocked(ip)
  if (wait > 0) return res.status(429).json({ error: 'locked', retryMs: wait })

  const { username, password } = req.body ?? {}
  const user = db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(String(username ?? '')) as
    | { id: number; username: string; password_hash: string; nickname: string; is_admin: number; must_change_password: number }
    | undefined

  if (!user || !bcrypt.compareSync(String(password ?? ''), user.password_hash)) {
    recordLoginFailure(ip)
    return res.status(401).json({ error: 'bad_credentials' })
  }
  resetLoginFailures(ip)
  createSession(res, user.id)
  res.json({
    user: {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      isAdmin: user.is_admin === 1,
      mustChangePassword: user.must_change_password === 1,
    },
  })
})

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: (req as AuthedRequest).authUser })
})

app.patch('/api/auth/me', requireAuth, (req, res) => {
  const me = (req as AuthedRequest).authUser!
  const { nickname, password } = req.body ?? {}
  if (nickname !== undefined) {
    db.prepare('UPDATE users SET nickname = ? WHERE id = ?').run(String(nickname).slice(0, 32) || me.username, me.id)
  }
  if (password) {
    const { current, next } = password
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(me.id) as { password_hash: string }
    if (!bcrypt.compareSync(String(current ?? ''), row.password_hash)) {
      return res.status(400).json({ error: 'current_wrong' })
    }
    if (!next || String(next).length < 8) return res.status(400).json({ error: 'password_rule' })
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
      bcrypt.hashSync(String(next), 10),
      me.id,
    )
  }
  const fresh = db
    .prepare('SELECT username, nickname, is_admin, must_change_password FROM users WHERE id = ?')
    .get(me.id) as { username: string; nickname: string; is_admin: number; must_change_password: number }
  res.json({
    user: {
      username: fresh.username,
      nickname: fresh.nickname,
      isAdmin: fresh.is_admin === 1,
      mustChangePassword: fresh.must_change_password === 1,
    },
  })
})

/* ---------------- 管理员：用户管理（BK-018） ---------------- */

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT u.id, u.username, u.nickname, u.is_admin, u.created_at,
              (SELECT COUNT(*) FROM bookmarks b WHERE b.user_id = u.id AND b.deleted_at IS NULL) AS bookmark_count
       FROM users u ORDER BY u.created_at`,
    )
    .all() as Array<{
    id: number; username: string; nickname: string; is_admin: number; created_at: string; bookmark_count: number
  }>
  res.json(
    rows.map((r) => ({
      username: r.username,
      nickname: r.nickname,
      role: r.is_admin ? ('admin' as const) : ('user' as const),
      count: r.bookmark_count,
      created: r.created_at,
    })),
  )
})

app.delete('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  const me = (req as AuthedRequest).authUser!
  const target = db.prepare('SELECT * FROM users WHERE username = ?').get(req.params.username) as
    | { id: number; username: string; is_admin: number }
    | undefined
  if (!target) return res.status(404).json({ error: 'not_found' })
  if (target.is_admin) return res.status(400).json({ error: 'cannot_delete_admin' }) // 防锁死
  if (target.username === me.username) return res.status(400).json({ error: 'cannot_delete_self' })
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id) // FK 级联清除数据
  rewriteCsvNow()
  res.json({ ok: true })
})

/* ---------------- admin：站点设置 / 重置密码 ---------------- */

app.get('/api/settings/site', requireAuth, requireAdmin, (_req, res) => {
  const s = db.prepare('SELECT allow_register, vpn_check FROM site_settings WHERE id = 1').get() as { allow_register: number; vpn_check: number }
  res.json({ allowRegister: s.allow_register === 1, vpnCheck: s.vpn_check === 1 })
})

app.put('/api/settings/site', requireAuth, requireAdmin, (req, res) => {
  const { allowRegister, vpnCheck } = req.body ?? {}
  const s = db.prepare('SELECT allow_register, vpn_check FROM site_settings WHERE id = 1').get() as { allow_register: number; vpn_check: number }
  db.prepare('UPDATE site_settings SET allow_register = ?, vpn_check = ? WHERE id = 1').run(
    allowRegister === undefined ? s.allow_register : allowRegister ? 1 : 0,
    vpnCheck === undefined ? s.vpn_check : vpnCheck ? 1 : 0,
  )
  res.json({ ok: true })
})

app.post('/api/admin/users/:username/reset-password', requireAuth, requireAdmin, (req, res) => {
  const target = db.prepare('SELECT id, is_admin FROM users WHERE username = ?').get(req.params.username) as
    | { id: number; is_admin: number }
    | undefined
  if (!target) return res.status(404).json({ error: 'not_found' })
  if (target.is_admin) return res.status(400).json({ error: 'cannot_reset_admin' })
  const temp = 'mk-' + randomBytes(4).toString('hex')
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(
    bcrypt.hashSync(temp, 10),
    target.id,
  )
  res.json({ tempPassword: temp }) // 仅此一次返回，用户下次登录强制改密
})

/* ---------------- 业务路由 ---------------- */

app.use('/api', api)
app.use('/api', ai)
app.use('/api', share)
app.use('/api', extTokens)
app.use('/api', skillsApi)
app.use('/api/ext', extApi)
registerExtCreate((uid, input, folderIds, tagNames, source) => createBookmarkInternal(uid, input, folderIds, tagNames, source))
registerExtPatch((uid, id, patch) => patchBookmarkByExt(uid, id, patch))

// 版本号读 package.json（发版只改一处）
let APP_VERSION = '0.0.0'
try {
  APP_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as { version: string }).version
} catch { /* 开发兜底 */ }
app.get('/api/health', (_req, res) => res.json({ ok: true, version: APP_VERSION }))

/* ---------------- 静态资源（前端构建产物 + 内置图标） ---------------- */

const distDir = join(process.cwd(), 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api|\/icons|\/favicons|\/downloads).*/, (_req, res) => {
    res.sendFile(join(distDir, 'index.html'))
  })
  // 单独给 icons 长缓存（文件名不变）
  app.use('/icons', express.static(join(distDir, 'icons'), { maxAge: '30d', fallthrough: false }))
}

// 浏览器扩展分发包：优先 data/downloads/（部署者可自行放置新版），其次镜像内置
// cwd 可能是项目根（Docker）或 server/（开发），两处都找；data/downloads 优先
const dlDirs = [join(DATA_DIR, 'downloads'), join(process.cwd(), 'downloads'), join(process.cwd(), '..', 'downloads')]
app.get('/downloads/:file', (req, res) => {
  const file = String(req.params.file)
  if (!/^[\w.-]+\.(zip|md)$/.test(file)) return res.status(400).end()
  for (const dir of dlDirs) {
    const p = join(dir, file)
    if (existsSync(p)) {
      res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
      return res.sendFile(p)
    }
  }
  res.status(404).json({ error: 'not_found' })
})

// 抓取的站点 favicon（在 data/favicons，随数据卷持久）
app.use(
  '/favicons',
  express.static(join(DATA_DIR, 'favicons'), { maxAge: '30d', fallthrough: true }),
)

// 启动即生成 CSV 初始镜像（BK-017）
rewriteCsvNow()

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[markit] listening on http://0.0.0.0:${PORT}`)
  console.log(`[markit] data dir: ${process.env.MARKIT_DATA_DIR || join(process.cwd(), 'data')}`)
})

// 优雅退出：容器停止时快速干净地关闭（避免 SIGKILL 137）
process.on('SIGTERM', () => {
  console.log('[markit] SIGTERM，正在关闭…')
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
})
