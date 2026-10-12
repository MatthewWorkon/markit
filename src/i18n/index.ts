import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'

/** 默认简体中文（PRD BK-015），语言选择按用户保存 */
export const i18n = createI18n({
  legacy: false,
  locale: localStorage.getItem('markit.locale') || 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    en,
  },
})

export function setLocale(locale: 'zh-CN' | 'en') {
  i18n.global.locale.value = locale
  localStorage.setItem('markit.locale', locale)
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
}
