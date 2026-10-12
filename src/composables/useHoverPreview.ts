import { onBeforeUnmount, ref } from 'vue'

/**
 * 悬停预览小窗（v0.4.13）：悬停宿主元素 2 秒后显示 300×200 浮层。
 * Teleport 到 body 定位（避开滚动容器裁剪）；任何滚动/缩放/离开宿主即隐藏。
 */
export function useHoverPreview(delay = 2000) {
  const visible = ref(false)
  const style = ref<Record<string, string>>({})
  let timer: ReturnType<typeof setTimeout> | null = null
  let hostEl: HTMLElement | null = null

  function place() {
    if (!hostEl) return
    const r = hostEl.getBoundingClientRect()
    const W = 300
    const H = 200
    const M = 8
    const left = Math.min(Math.max(r.left + r.width / 2 - W / 2, M), window.innerWidth - W - M)
    // 默认在宿主上方；上方空间不足则放下方
    const top = r.top >= H + 24 ? r.top - H - 8 : r.bottom + 8
    style.value = {
      left: `${Math.round(left)}px`,
      top: `${Math.round(Math.max(top, M))}px`,
      width: `${W}px`,
      height: `${H}px`,
    }
  }

  function enter(e: MouseEvent) {
    hostEl = e.currentTarget as HTMLElement
    leave()
    timer = setTimeout(() => {
      place()
      visible.value = true
    }, delay)
  }

  function leave() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    visible.value = false
  }

  /** 宿主点击/内容更新后立即隐藏 */
  function hide() {
    leave()
  }

  function onWinChange() {
    if (visible.value || timer) leave()
  }

  /** 兜底：小窗可见期间，指针离开宿主矩形即隐藏（mouseleave 未触发时兜住） */
  function onDocMove(e: MouseEvent) {
    if (!visible.value && !timer) return
    if (hostEl && hostEl.contains(e.target as Node)) return
    leave()
  }

  window.addEventListener('scroll', onWinChange, true)
  window.addEventListener('resize', onWinChange)
  document.addEventListener('mousemove', onDocMove)
  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onWinChange, true)
    window.removeEventListener('resize', onWinChange)
    document.removeEventListener('mousemove', onDocMove)
    leave()
  })

  return { visible, style, enter, leave, hide }
}
