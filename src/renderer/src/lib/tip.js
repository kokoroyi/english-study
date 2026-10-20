// v-tip 指令: 项目风格悬浮提示(替代原生 title 的黑色系统样式)
// 用法: v-tip="'提示文本'" 或 v-tip="动态表达式"; 悬停居中于元素上方, 放不下翻到下方, 视口钳制
let tipEl = null
function ensureEl() {
  if (!tipEl && typeof document !== 'undefined') {
    tipEl = document.createElement('div')
    tipEl.className = 'app-tip'
    tipEl.style.display = 'none'
    document.body.appendChild(tipEl)
  }
  return tipEl
}
function show(el, text) {
  const tip = ensureEl()
  if (!tip) return
  tip.textContent = String(text ?? '').trim()
  if (!tip.textContent) {
    hide()
    return
  }
  tip.style.display = 'block'
  const r = el.getBoundingClientRect()
  const tw = tip.offsetWidth
  let x = r.left + r.width / 2 - tw / 2
  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8))
  let y = r.top - tip.offsetHeight - 8
  if (y < 8) y = r.bottom + 8 // 上方放不下翻到下方
  tip.style.left = `${x}px`
  tip.style.top = `${y}px`
}
function hide() {
  const tip = ensureEl()
  if (tip) tip.style.display = 'none'
}
export const vTip = {
  mounted(el, binding) {
    if (!binding.value) return
    el._tipValue = String(binding.value ?? '')
    const showFn = () => show(el, el._tipValue)
    const hideFn = () => hide()
    el.addEventListener('mouseenter', showFn)
    el.addEventListener('mouseleave', hideFn)
    el.addEventListener('mousedown', hideFn)
    // scroll 不冒泡: 捕获阶段监听, 页面/容器滚动时收起提示(避免残留在错位坐标)
    window.addEventListener('scroll', hideFn, true)
    el._tipCleanup = () => {
      el.removeEventListener('mouseenter', showFn)
      el.removeEventListener('mouseleave', hideFn)
      el.removeEventListener('mousedown', hideFn)
      window.removeEventListener('scroll', hideFn, true)
    }
  },
  updated(el, binding) {
    if (el._tipCleanup) el._tipValue = String(binding.value ?? '')
  },
  unmounted(el) {
    if (el._tipCleanup) el._tipCleanup()
  }
}
