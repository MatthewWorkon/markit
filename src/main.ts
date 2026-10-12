import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { i18n } from './i18n'
import { vClickOutside } from './utils/clickOutside'

// 字体自托管（离线可用，OFL 开源授权）
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/500.css'
import '@fontsource/noto-sans-sc/700.css'

import './styles/tokens.css'
import './styles/base.css'
import './styles/motion.css'

const app = createApp(App)
app.directive('ClickOutside', vClickOutside)
app.use(createPinia())
app.use(i18n)
app.use(router)
app.mount('#app')

// PWA：Service Worker 仅生产环境注册（BK-110）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {})
}
