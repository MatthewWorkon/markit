import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Bookmark, Folder, Tag, UserInfo, ViewId } from '@/types'
import { api } from '@/api'

/**
 * 数据仓库 · API 版。
 * 策略：bootstrap 一次拉全量到本地，视图过滤/搜索在客户端（家庭规模），
 * 变更走 API 成功后同步本地状态。
 */
export const useDataStore = defineStore('data', () => {
  const user = ref<UserInfo>({ username: '', nickname: '', isAdmin: false })
  const folders = ref<Folder[]>([])
  const tags = ref<Tag[]>([])
  const bookmarks = ref<Bookmark[]>([])
  const loaded = ref(false)

  const currentView = ref<ViewId>({ kind: 'all' })
  const searchQuery = ref('')
  const recentDays = ref(30)
  type SortMode = 'newest' | 'oldest' | 'visits' | 'manual'
  const sortMode = ref<SortMode>(
    (localStorage.getItem('markit.sortMode') as SortMode) || 'newest',
  )
  function setSortMode(v: SortMode) {
    sortMode.value = v
    localStorage.setItem('markit.sortMode', v)
  }

  /** 启动加载（登录后调用一次） */
  const extActive = ref(false)

  async function bootstrap() {
    const data = await api.get<{
      user: UserInfo
      bookmarks: Bookmark[]
      folders: Folder[]
      tags: Tag[]
      extActive: boolean
    }>('/api/bootstrap')
    extActive.value = data.extActive
    user.value = data.user
    bookmarks.value = data.bookmarks
    folders.value = data.folders
    tags.value = data.tags
    loaded.value = true
  }

  /** 已固定（Pin 启动器区；按宫格手动顺序，未排序的按收藏时间倒序兜底） */
  const pinned = computed(() =>
    bookmarks.value
      .filter((b) => b.pinned && !b.deleted)
      .sort((a, b) => {
        const pa = a.pinOrder ?? Number.MAX_SAFE_INTEGER
        const pb = b.pinOrder ?? Number.MAX_SAFE_INTEGER
        if (pa !== pb) return pa - pb
        return b.createdAt.localeCompare(a.createdAt)
      }),
  )

  /** 手动顺序：分组视图按分组内序（folderIds 数组序），其余视图按全局序；空值兜底按时间倒序 */
  function manualCompare(a: Bookmark, b: Bookmark): number {
    const v = currentView.value
    if (v.kind === 'folder') {
      const ia = a.folderOrders[v.folderId] ?? Number.MAX_SAFE_INTEGER
      const ib = b.folderOrders[v.folderId] ?? Number.MAX_SAFE_INTEGER
      if (ia !== ib) return ia - ib
    }
    const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER
    const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    return b.createdAt.localeCompare(a.createdAt)
  }

  /** 当前视图命中的书签，按排序模式输出 */
  const visibleBookmarks = computed<Bookmark[]>(() => {
    let list = bookmarks.value
    const v = currentView.value
    if (v.kind === 'trash') return list.filter((b) => b.deleted)
    list = list.filter((b) => !b.deleted)

    switch (v.kind) {
      case 'all':
        break
      case 'recent': {
        const cutoff = Date.now() - recentDays.value * 86400_000
        list = list.filter((b) => new Date(b.createdAt).getTime() >= cutoff)
        break
      }
      case 'favorite':
        list = list.filter((b) => b.favorite)
        break
      case 'uncategorized':
        list = list.filter((b) => b.folderIds.length === 0)
        break
      case 'ext':
        list = list.filter((b) => b.source === 'ext')
        break
      case 'folder':
        list = list.filter((b) => b.folderIds.includes(v.folderId))
        break
      case 'tag':
        list = list.filter((b) => b.tagIds.includes(v.tagId))
        break
      case 'vpn':
        list = list.filter((b) => b.needVpn)
        break
    }

    const q = searchQuery.value.trim().toLowerCase()
    if (q) {
      const tagNames = new Map(tags.value.map((t) => [t.id, t.name.toLowerCase()]))
      list = list.filter((b) => {
        const inTags = b.tagIds.some((id) => (tagNames.get(id) ?? '').includes(q))
        return (
          b.title.toLowerCase().includes(q) ||
          b.url.toLowerCase().includes(q) ||
          b.description.toLowerCase().includes(q) ||
          inTags
        )
      })
    }

    let cmp: (a: Bookmark, b: Bookmark) => number
    if (sortMode.value === 'visits') cmp = (a, b) => b.visitCount - a.visitCount
    else if (sortMode.value === 'oldest') cmp = (a, b) => a.createdAt.localeCompare(b.createdAt)
    else if (sortMode.value === 'manual') cmp = manualCompare
    else cmp = (a, b) => b.createdAt.localeCompare(a.createdAt)
    return [...list].sort(cmp)
  })


  const allCount = computed(() => bookmarks.value.filter((b) => !b.deleted).length)

  /** 各分组书签数（含子孙目录聚合） */
  const folderCount = computed(() => {
    const direct = new Map<number, number>()
    for (const b of bookmarks.value) {
      if (b.deleted) continue
      for (const fid of b.folderIds) direct.set(fid, (direct.get(fid) ?? 0) + 1)
    }
    const total = new Map<number, number>()
    const byId = new Map(folders.value.map((f) => [f.id, f]))
    for (const [fid, n] of direct) {
      let cur = byId.get(fid)
      while (cur) {
        total.set(cur.id, (total.get(cur.id) ?? 0) + n)
        cur = cur.parentId != null ? byId.get(cur.parentId) : undefined
      }
    }
    return total
  })

  /** 未分类动态视图计数：未删除且未绑定任何分类 */
  const uncategorizedCount = computed(
    () => bookmarks.value.filter((b) => !b.deleted && b.folderIds.length === 0).length,
  )

  /* ---------------- 动作（API 成功后同步本地） ---------------- */

  function replaceLocal(bm: Bookmark) {
    const i = bookmarks.value.findIndex((x) => x.id === bm.id)
    if (i >= 0) bookmarks.value[i] = bm
    else bookmarks.value.unshift(bm)
    // 服务端可能新建标签（返回 tags 字段），同步标签库
    const known = new Set(tags.value.map((t) => t.name))
    for (const name of bm.tags) {
      if (!known.has(name)) {
        const id = Math.max(0, ...tags.value.map((t) => t.id)) + 1
        tags.value.push({ id, name })
      }
    }
  }

  async function addBookmark(input: {
    title: string; url: string; description: string; folderIds: number[]; tagNames: string[]
  }) {
    const bm = await api.post<Bookmark>('/api/bookmarks', input)
    replaceLocal(bm)
    return bm
  }

  async function updateBookmark(
    id: number,
    patch: { title: string; url: string; description: string; folderIds: number[]; tagNames: string[] },
  ) {
    const bm = await api.patch<Bookmark>(`/api/bookmarks/${id}`, patch)
    replaceLocal(bm)
  }

  function urlExists(url: string, excludeId?: number) {
    const norm = url.replace(/\/+$/, '')
    return bookmarks.value.some(
      (b) => b.id !== excludeId && !b.deleted && b.url.replace(/\/+$/, '') === norm,
    )
  }

  async function toggleFlag(id: number, field: 'favorite' | 'pinned') {
    const bm = await api.post<Bookmark>(`/api/bookmarks/${id}/toggle`, { field })
    replaceLocal(bm)
  }

  const toggleFavorite = (id: number) => toggleFlag(id, 'favorite')
  const togglePin = (id: number) => toggleFlag(id, 'pinned')

  async function softDelete(id: number) {
    await api.delete(`/api/bookmarks/${id}`)
    const b = bookmarks.value.find((x) => x.id === id)
    if (b) {
      b.deleted = true
      b.deletedAt = new Date().toISOString()
    }
  }

  async function restore(id: number) {
    const bm = await api.post<Bookmark>(`/api/bookmarks/${id}/restore`)
    replaceLocal(bm)
  }

  async function deleteForever(id: number) {
    await api.post(`/api/bookmarks/${id}/purge`)
    bookmarks.value = bookmarks.value.filter((b) => b.id !== id)
  }

  /* ---------------- 手动排序（BK-109） ---------------- */

  /** 书签：scope global=全部书签视图的顺序；folder=分组内顺序（按 folderIds 数组序） */
  async function reorderBookmarks(scope: 'global' | 'folder', folderId: number | null, orderedIds: number[]) {
    await api.post('/api/bookmarks/reorder', { ids: orderedIds, scope, folderId })
    if (scope === 'global') {
      orderedIds.forEach((id, i) => {
        const b = bookmarks.value.find((x) => x.id === id)
        if (b) b.sortOrder = i + 1
      })
    } else if (folderId != null) {
      orderedIds.forEach((id, i) => {
        const b = bookmarks.value.find((x) => x.id === id)
        if (b) b.folderOrders[folderId] = i + 1 // 组内顺序本地同步
      })
    }
    setSortMode('manual')
  }

  /** Pin 宫格顺序 */
  async function reorderPins(orderedIds: number[]) {
    await api.post('/api/pins/reorder', { ids: orderedIds })
    orderedIds.forEach((id, i) => {
      const b = bookmarks.value.find((x) => x.id === id)
      if (b) b.pinOrder = i + 1
    })
  }

  /** 同层级分组顺序 */
  async function reorderFolders(parentId: number | null, orderedIds: number[]) {
    await api.post('/api/folders/reorder', { parentId, orderedIds })
    orderedIds.forEach((id, i) => {
      const f = folders.value.find((x) => x.id === id)
      if (f) f.sortOrder = i + 1
    })
  }

  /** 分类上移/下移（移动端替代拖拽） */
  async function moveFolder(id: number, dir: -1 | 1) {
    const f = folders.value.find((x) => x.id === id)
    if (!f) return
    const siblings = folders.value
      .filter((x) => x.parentId === f.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const i = siblings.findIndex((x) => x.id === id)
    const j = i + dir
    if (j < 0 || j >= siblings.length) return
    ;[siblings[i], siblings[j]] = [siblings[j], siblings[i]]
    await reorderFolders(f.parentId, siblings.map((x) => x.id))
  }

  /* ---------------- 分组 ---------------- */

  async function addFolder(name: string, parentId: number | null, icon = 'folder', iconColor: string | null = null, description = '') {
    const { id } = await api.post<{ id: number }>('/api/folders', {
      name, parentId, icon, iconColor, description,
    })
    const siblings = folders.value.filter((f) => f.parentId === parentId)
    folders.value.push({ id, name, parentId, icon, iconColor, description, sortOrder: siblings.length + 1 })
    return id
  }

  async function setFolderIcon(id: number, icon: string, iconColor: string | null) {
    await api.patch(`/api/folders/${id}`, { icon, iconColor })
    const f = folders.value.find((x) => x.id === id)
    if (f) {
      f.icon = icon
      f.iconColor = iconColor
    }
  }

  async function renameFolder(id: number, name: string) {
    await api.patch(`/api/folders/${id}`, { name })
    const f = folders.value.find((x) => x.id === id)
    if (f) f.name = name
  }

  /** 删除分组：整树删除 + 并入被删分类的父分类（方案 B，服务端执行） */
  async function deleteFolder(id: number) {
    const target = folders.value.find((f) => f.id === id)
    if (!target) return
    await api.delete(`/api/folders/${id}`)
    const doomed = new Set<number>([id])
    let grew = true
    while (grew) {
      grew = false
      for (const f of folders.value) {
        if (f.parentId != null && doomed.has(f.parentId) && !doomed.has(f.id)) {
          doomed.add(f.id)
          grew = true
        }
      }
    }
    folders.value = folders.value.filter((f) => !doomed.has(f.id))
    for (const b of bookmarks.value) {
      if (!b.folderIds.some((fid) => doomed.has(fid))) continue
      b.folderIds = b.folderIds.filter((fid) => !doomed.has(fid))
      if (target.parentId != null && !b.folderIds.includes(target.parentId)) {
        b.folderIds.push(target.parentId)
      }
    }
    const cv = currentView.value
    if (cv.kind === 'folder' && doomed.has(cv.folderId)) currentView.value = { kind: 'all' }
  }

  return {
    user,
    folders,
    tags,
    bookmarks,
    loaded,
    currentView,
    searchQuery,
    recentDays,
    sortMode,
    setSortMode,
    extActive,
    pinned,
    visibleBookmarks,
    allCount,
    folderCount,
    uncategorizedCount,
    bootstrap,
    addBookmark,
    updateBookmark,
    reorderBookmarks,
    reorderPins,
    replaceLocal,
    reorderFolders,
    moveFolder,
    urlExists,
    toggleFavorite,
    togglePin,
    softDelete,
    restore,
    deleteForever,
    addFolder,
    setFolderIcon,
    deleteFolder,
    renameFolder,
  }
})
