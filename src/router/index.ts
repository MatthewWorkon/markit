import { createRouter, createWebHashHistory } from 'vue-router'

/**
 * Hash 路由：单容器静态托管无需服务端回退配置，分发部署零心智负担。
 */
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/HomePage.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/LoginPage.vue'),
    },
    {
      path: '/s/:token',
      name: 'share',
      component: () => import('@/pages/SharePage.vue'),
    },
    {
      path: '/skills',
      name: 'skills',
      component: () => import('@/pages/skills/SkillsPage.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/** 会话校验：查 /api/auth/me（30 天 Cookie 会话） */
router.beforeEach(async (to) => {
  if (to.name !== 'home') return true
  try {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
    if (res.ok) return true
  } catch { /* fallthrough */ }
  return { name: 'login' }
})
