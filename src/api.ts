/** API 客户端：统一携带 CSRF 头 + 会话 Cookie，401 统一跳登录 */

export class ApiError extends Error {
  code: string
  status: number
  detail?: string
  constructor(status: number, code: string, detail?: string) {
    super(code)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-requested-with': 'fetch',
    },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    sessionStorage.removeItem('markit.auth')
    location.hash = '#/login'
    throw new ApiError(401, 'unauthorized')
  }
  if (!res.ok) {
    let code = `http_${res.status}`
    let detail: string | undefined
    try {
      const data = (await res.json()) as { error?: string; detail?: string }
      if (data.error) code = data.error
      if (data.detail) detail = data.detail
    } catch { /* keep http code */ }
    throw new ApiError(res.status, code, detail)
  }
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/** 文件下载（导出） */
export function download(path: string) {
  const a = document.createElement('a')
  a.href = path
  a.click()
}
