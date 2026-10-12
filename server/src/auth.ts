import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { db } from './db.js'

export interface AuthUser {
  id: number
  username: string
  nickname: string
  isAdmin: boolean
  mustChangePassword: boolean
}

const SESSION_DAYS = 30

/* ---------------- Cookie 解析（免依赖） ---------------- */
function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.cookie
  if (!raw) return out
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

/* ---------------- 会话 ---------------- */
export function createSession(res: Response, userId: number) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + SESSION_DAYS * 86400_000
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt,
  )
  res.setHeader(
    'Set-Cookie',
    `markit_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  )
}

export function destroySession(req: Request, res: Response) {
  const token = parseCookies(req).markit_sid
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  res.setHeader('Set-Cookie', 'markit_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
}

/** 解析当前用户，挂到 req.authUser */
export function attachUser(req: Request, _res: Response, next: NextFunction) {
  const token = parseCookies(req).markit_sid
  if (!token) return next()
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.nickname, u.is_admin, u.must_change_password, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as
    | { id: number; username: string; nickname: string; is_admin: number; must_change_password: number; expires_at: number }
    | undefined

  if (!row) return next()
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
    return next()
  }
  ;(req as AuthedRequest).authUser = {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    isAdmin: row.is_admin === 1,
    mustChangePassword: row.must_change_password === 1,
  }
  next()
}

export interface AuthedRequest extends Request {
  authUser?: AuthUser
}

/** 要求登录 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req as AuthedRequest).authUser) return res.status(401).json({ error: 'unauthorized' })
  next()
}

/** 要求管理员（BK-018） */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const u = (req as AuthedRequest).authUser
  if (!u) return res.status(401).json({ error: 'unauthorized' })
  if (!u.isAdmin) return res.status(403).json({ error: 'forbidden' })
  next()
}

/** CSRF 简易防护：变更请求必须带自定义头（跨站表单无法携带） */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  if (req.headers['x-requested-with'] !== 'fetch') {
    return res.status(403).json({ error: 'csrf' })
  }
  next()
}

/* ---------------- 登录限速（同 IP 5 次失败锁 15 分钟，BK-001） ---------------- */
const attempts = new Map<string, { count: number; lockedUntil: number }>()

export function loginBlocked(ip: string): number {
  const a = attempts.get(ip)
  if (a && a.lockedUntil > Date.now()) return a.lockedUntil - Date.now()
  return 0
}

export function recordLoginFailure(ip: string) {
  const a = attempts.get(ip) ?? { count: 0, lockedUntil: 0 }
  a.count += 1
  if (a.count >= 5) {
    a.lockedUntil = Date.now() + 15 * 60_000
    a.count = 0
  }
  attempts.set(ip, a)
}

export function resetLoginFailures(ip: string) {
  attempts.delete(ip)
}

export { bcrypt }
