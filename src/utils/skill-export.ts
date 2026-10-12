import type { Skill } from '@/stores/skills'

/**
 * Skill 导出为 .md（v0.4.1）：
 * 正文若无 frontmatter 则补 name/description 头——与「上传文件」导入的解析格式对齐，导出的文件可直接再导入。
 */
export function buildSkillMd(skill: Skill, content: string): string {
  if (/^---\r?\n/.test(content)) return content
  const lines = ['---', `name: ${skill.title}`]
  const desc = skill.description.replace(/\r?\n/g, ' ').trim()
  if (desc) lines.push(`description: ${desc}`)
  lines.push('---', '')
  return lines.join('\n') + '\n' + content
}

/** 文件名净化（去文件系统非法字符） */
function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '').trim() || 'skill'
}

export function downloadSkillMd(skill: Skill, content: string): string {
  const name = safeFileName(skill.title)
  const blob = new Blob([buildSkillMd(skill, content)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.md`
  a.click()
  URL.revokeObjectURL(url)
  return `${name}.md`
}
