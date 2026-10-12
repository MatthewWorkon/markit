import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/api'

export interface Skill {
  id: number
  title: string
  description: string
  scope: 'global' | 'project'
  projectName: string
  source: 'manual' | 'github' | 'upload' | 'copy'
  githubUrl: string
  githubAuthor: string
  githubPath: string
  downloadCount: number
  folderId: number | null
  isPublic: boolean
  favorite: boolean
  fileSize: number
  createdAt: string
  updatedAt: string
  deleted: boolean
  authorNickname?: string
  authorUsername?: string
  /** 详情接口：他人公开条目为只读 */
  own?: boolean
  readonly?: boolean
}

export interface SkillFolder {
  id: number
  name: string
  icon: string
  iconColor: string | null
  sortOrder: number
}

export type SkillsView = 'plaza' | 'all' | 'uncategorized' | 'global' | 'project' | 'favorite' | 'folder' | 'trash'

export const useSkillsStore = defineStore('skills', () => {
  const skills = ref<Skill[]>([])
  const folders = ref<SkillFolder[]>([])
  const loaded = ref(false)
  const currentView = ref<SkillsView>('all')
  const folderId = ref<number | null>(null)
  const searchQuery = ref('')
  /** 排序：updated=最新更新 / oldest=最早更新 / downloads=最多下载（v0.4.5） */
  const sortMode = ref<'updated' | 'oldest' | 'downloads'>(
    (localStorage.getItem('markit.skillsSortMode') as 'updated' | 'oldest' | 'downloads') || 'updated',
  )
  function setSortMode(v: 'updated' | 'oldest' | 'downloads') {
    sortMode.value = v
    localStorage.setItem('markit.skillsSortMode', v)
  }

  async function bootstrap() {
    const data = await api.get<{ skills: Skill[]; folders: SkillFolder[] }>('/api/skills/bootstrap')
    skills.value = data.skills
    folders.value = data.folders
    loaded.value = true
  }

  async function getDetail(id: number): Promise<Skill & { content: string }> {
    return api.get(`/api/skills/${id}`)
  }

  async function create(input: {
    title: string; description?: string; content: string
    scope?: 'global' | 'project'; projectName?: string
    source?: string; githubUrl?: string; githubAuthor?: string
    folderId?: number | null; isPublic?: boolean
  }) {
    const s = await api.post<Skill>('/api/skills', input)
    skills.value.unshift(s)
    return s
  }

  async function update(id: number, patch: Partial<Skill> & { content?: string }) {
    const s = await api.patch<Skill>(`/api/skills/${id}`, patch)
    const i = skills.value.findIndex((x) => x.id === id)
    if (i >= 0) skills.value[i] = s
    return s
  }

  async function softDelete(id: number) {
    await api.delete(`/api/skills/${id}`)
    const b = skills.value.find((x) => x.id === id)
    if (b) b.deleted = true
  }

  /** 从回收站恢复 */
  async function restore(id: number) {
    const s = await api.post<Skill>(`/api/skills/${id}/restore`)
    const i = skills.value.findIndex((x) => x.id === id)
    if (i >= 0) skills.value[i] = s
  }

  /** 彻底删除（仅回收站内可用） */
  async function purge(id: number) {
    await api.delete(`/api/skills/${id}`)
    skills.value = skills.value.filter((x) => x.id !== id)
  }

  /** GitHub 来源检查更新（探测模式）：返回是否线上有新版（不落库） */
  async function checkRemoteUpdate(id: number): Promise<boolean> {
    const r = await api.post<{ updated: boolean }>(`/api/skills/${id}/sync?check=1`)
    return r.updated
  }

  /** GitHub 来源检查更新（应用模式）：有新版覆盖正文，返回是否更新 */
  async function syncFromGithub(id: number): Promise<boolean> {
    const r = await api.post<{ updated: boolean; skill?: Skill }>(`/api/skills/${id}/sync`)
    if (r.updated && r.skill) {
      const i = skills.value.findIndex((x) => x.id === id)
      if (i >= 0) skills.value[i] = r.skill
    }
    return r.updated
  }

  /** 历史版本（最多 3 条，新→旧） */
  async function listVersions(id: number) {
    return api.get<Array<{ id: number; size: number; reason: string; createdAt: string; preview: string }>>(`/api/skills/${id}/versions`)
  }

  /** 回退到指定历史版本（当前版自动入历史） */
  async function rollbackTo(id: number, versionId: number) {
    const s2 = await api.post<Skill>(`/api/skills/${id}/versions/${versionId}/restore`)
    const i = skills.value.findIndex((x) => x.id === id)
    if (i >= 0) skills.value[i] = s2
    return s2
  }

  /** 批量操作：move(folderId?) / star / unstar / delete（软删） */
  async function batch(ids: number[], action: 'move' | 'star' | 'unstar' | 'delete', folderId?: number | null) {
    const r = await api.post<{ affected: number; failed: number[] }>('/api/skills/batch', { ids, action, folderId })
    // 本地同步
    for (const id of ids) {
      if (action === 'delete') {
        const s2 = skills.value.find((x) => x.id === id)
        if (s2) s2.deleted = true
      } else if (action === 'star' || action === 'unstar') {
        const s2 = skills.value.find((x) => x.id === id)
        if (s2) s2.favorite = action === 'star'
      } else if (action === 'move') {
        const s2 = skills.value.find((x) => x.id === id)
        if (s2) s2.folderId = folderId ?? null
      }
    }
    return r
  }

  /** 下载计数上报（fire-and-forget） */
  function bumpDownload(id: number) {
    api.post<{ downloadCount: number }>(`/api/skills/${id}/download`)
      .then((r) => {
        const s = skills.value.find((x) => x.id === id)
        if (s) s.downloadCount = r.downloadCount
      })
      .catch(() => { /* 静默 */ })
  }

  /** 星标切换（不动 updated_at） */
  async function toggleFavorite(id: number) {
    const cur = skills.value.find((x) => x.id === id)
    if (!cur) return
    const s = await api.patch<Skill>(`/api/skills/${id}`, { favorite: !cur.favorite })
    const i = skills.value.findIndex((x) => x.id === id)
    if (i >= 0) skills.value[i] = s
  }

  async function addFolder(name: string, icon = 'folder', iconColor: string | null = null) {
    const { id } = await api.post<{ id: number }>('/api/skill-folders', { name, icon, iconColor })
    folders.value.push({ id, name, icon, iconColor, sortOrder: folders.value.length + 1 })
    return id
  }

  async function deleteFolder(id: number) {
    await api.delete(`/api/skill-folders/${id}`)
    folders.value = folders.value.filter((f) => f.id !== id)
    for (const s of skills.value) {
      if (s.folderId === id) s.folderId = null
    }
    if (currentView.value === 'folder' && folderId.value === id) {
      currentView.value = 'all'
      folderId.value = null
    }
  }

  /** 重命名（v0.4.1） */
  async function renameFolder(id: number, name: string) {
    await api.patch(`/api/skill-folders/${id}`, { name })
    const f = folders.value.find((x) => x.id === id)
    if (f) f.name = name
  }

  /** 换图标/底色（v0.4.1） */
  async function setFolderIcon(id: number, icon: string, iconColor: string | null) {
    await api.patch(`/api/skill-folders/${id}`, { icon, iconColor })
    const f = folders.value.find((x) => x.id === id)
    if (f) {
      f.icon = icon
      f.iconColor = iconColor
    }
  }

  /** 拖拽排序（v0.4.1，一级平铺） */
  async function reorderFolders(orderedIds: number[]) {
    await api.post('/api/skill-folders/reorder', { orderedIds })
    orderedIds.forEach((id, i) => {
      const f = folders.value.find((x) => x.id === id)
      if (f) f.sortOrder = i + 1
    })
  }

  /** 上移/下移（触屏替代拖拽） */
  function moveFolder(id: number, dir: -1 | 1) {
    const sorted = [...folders.value].sort((a, b) => a.sortOrder - b.sortOrder)
    const i = sorted.findIndex((f) => f.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= sorted.length) return
    ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
    reorderFolders(sorted.map((f) => f.id))
  }

  /** 广场条目收藏/取消（跨用户关联） */
  async function togglePlazaFavorite(id: number): Promise<boolean> {
    const r = await api.post<{ favorited: boolean }>(`/api/skills/${id}/favorite`)
    if (currentView.value === 'plaza') {
      const s2 = plazaSkills.value.find((x) => x.id === id)
      if (s2) s2.favorite = r.favorited
    }
    // 星标视图与角标即时同步
    void loadFavoritedPlaza()
    return r.favorited
  }

  /** 广场（跨用户公开） */
  const plazaSkills = ref<Skill[]>([])
  const plazaCount = ref(0)
  async function loadPlaza() {
    plazaSkills.value = await api.get('/api/skills/plaza')
    plazaCount.value = plazaSkills.value.length
  }

  /** 我收藏的广场条目（星标收藏视图与库内星标合并展示，v0.4.8） */
  const favoritedPlaza = ref<Skill[]>([])
  async function loadFavoritedPlaza() {
    try {
      favoritedPlaza.value = await api.get('/api/skills/favorited-plaza')
    } catch {
      favoritedPlaza.value = []
    }
  }

  async function copyFromPlaza(id: number) {
    const s = await api.post<Skill>(`/api/skills/${id}/copy`)
    skills.value.unshift(s)
    return s
  }

  /** GitHub 解析（预览，不入库） */
  async function parseGithub(repoUrl: string) {
    return api.post<{ items: Array<{ title: string; description: string; path: string; size: number; content: string }>; projectName: string; author: string; repoUrl: string }>(
      '/api/skills/import/github', { repoUrl },
    )
  }

  /** 批量确认入库 */
  async function importConfirm(items: Array<{ title: string; description: string; content: string }>, opts: {
    scope?: string; projectName?: string; folderId?: number | null; source?: string; githubUrl?: string; githubAuthor?: string
  }) {
    const r = await api.post<{ ok: boolean; added: number }>('/api/skills/import/confirm', { items, ...opts })
    await bootstrap()
    return r
  }

  async function search(q: string) {
    return api.get<Skill[]>(`/api/skills/search?q=${encodeURIComponent(q)}`)
  }

  function setFolderView(id: number) {
    currentView.value = 'folder'
    folderId.value = id
  }

  /** 视图过滤 */
  const visibleSkills = computed<Skill[]>(() => {
    if (currentView.value === 'plaza') return plazaSkills.value
    const q = searchQuery.value.trim().toLowerCase()
    if (currentView.value === 'trash') {
      let list = skills.value.filter((s) => s.deleted)
      if (q) list = list.filter((s) => s.title.toLowerCase().includes(q))
      return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    }
    let list = skills.value.filter((s) => !s.deleted)
    switch (currentView.value) {
      case 'global': list = list.filter((s) => s.scope === 'global'); break
      case 'project': list = list.filter((s) => s.scope === 'project'); break
      case 'favorite': return [...list.filter((s) => s.favorite), ...favoritedPlaza.value]
      case 'uncategorized': list = list.filter((s) => s.folderId == null); break
      case 'folder':
        if (folderId.value == null) list = []
        else list = list.filter((s) => s.folderId === folderId.value)
        break
    }
    if (q) {
      list = list.filter((s) =>
        s.title.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.projectName.toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    if (sortMode.value === 'oldest') sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    else if (sortMode.value === 'downloads') sorted.sort((a, b) => b.downloadCount - a.downloadCount || b.updatedAt.localeCompare(a.updatedAt))
    else sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return sorted
  })

  const trashCount = computed(() => skills.value.filter((s) => s.deleted).length)

  const stats = computed(() => ({
    all: skills.value.filter((s) => !s.deleted).length,
    global: skills.value.filter((s) => !s.deleted && s.scope === 'global').length,
    project: skills.value.filter((s) => !s.deleted && s.scope === 'project').length,
  }))

  const favoriteCount = computed(
    () => skills.value.filter((s) => !s.deleted && s.favorite).length + favoritedPlaza.value.length,
  )

  const uncategorizedCount = computed(() => skills.value.filter((s) => !s.deleted && s.folderId == null).length)

  function folderCount(fid: number): number {
    return skills.value.filter((s) => !s.deleted && s.folderId === fid).length
  }

  return {
    skills, folders, loaded, currentView, folderId, searchQuery,
    visibleSkills, stats, folderCount, trashCount, favoriteCount, uncategorizedCount,
    bootstrap, getDetail, create, update, softDelete, restore, purge, toggleFavorite, syncFromGithub, checkRemoteUpdate, bumpDownload, listVersions, rollbackTo, batch,
    sortMode, setSortMode,
    addFolder, deleteFolder, setFolderView, renameFolder, setFolderIcon, reorderFolders, moveFolder,
    plazaSkills, plazaCount, loadPlaza, copyFromPlaza, togglePlazaFavorite, favoritedPlaza, loadFavoritedPlaza,
    parseGithub, importConfirm, search,
  }
})
