import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true, // 允许局域网访问（手机验收用）
    port: 5180,
    fs: {
      // node_modules 软链到同步盘外的 store 目录，需允许 vite 服务这些文件
      allow: [fileURLToPath(new URL('./', import.meta.url)), '/Users/workon/.markit-store'],
    },
    proxy: {
      // 开发期 API 转发到本地后端（server/，端口 8340）
      '/api': {
        target: 'http://127.0.0.1:8340',
        changeOrigin: true,
      },
      // 抓取的站点图标也在后端（data/favicons）
      '/favicons': {
        target: 'http://127.0.0.1:8340',
        changeOrigin: true,
      },
    },
  },
})
