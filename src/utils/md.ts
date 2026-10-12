import MarkdownIt from 'markdown-it'

/** 共享 MarkdownIt 单例（悬停预览等轻量渲染用） */
export const md = new MarkdownIt({ html: false, linkify: true, breaks: true })
