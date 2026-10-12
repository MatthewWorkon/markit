import type { Directive } from 'vue'

type Handler = (e: MouseEvent) => void

/** 已注册的元素 → 处理器映射（卸载时精确移除） */
const listeners = new WeakMap<HTMLElement, Handler>()

/**
 * 点击元素外部时触发（mousedown 冒泡阶段判定）。
 * 浮层与其触发按钮放在同一容器内使用，避免「点按钮收起又立即展开」的抖动。
 */
export const vClickOutside: Directive<HTMLElement, Handler> = {
  mounted(el, binding) {
    if (typeof binding.value !== 'function') return
    const h: Handler = (e) => {
      if (!el.contains(e.target as Node)) binding.value(e)
    }
    listeners.set(el, h)
    document.addEventListener('mousedown', h)
  },
  unmounted(el) {
    const h = listeners.get(el)
    if (h) document.removeEventListener('mousedown', h)
    listeners.delete(el)
  },
}
