import { reactive, watch } from 'vue'

// 轻量事件总线: 复习完成后通知全局刷新
const listeners = new Map()

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(fn)
  },
  off(event, fn) {
    listeners.get(event)?.delete(fn)
  },
  emit(event, payload) {
    listeners.get(event)?.forEach((fn) => {
      try {
        fn(payload)
      } catch (e) {
        console.error(`[bus] ${event} 监听器出错`, e)
      }
    })
  }
}

export const store = reactive({
  settings: null,
  initialized: false,
  // 全局句子选中态(App 级右侧 AI 工作区抽屉的数据源): { s: {index,text,start,end}, articleId } | null
  selectedSentence: null,
  // 阅读页全文上下文(工作区初始自行展开 + 全文模式提问): { title, text, articleId } | null
  // Reading.vue 实时维护; 复习模式/无文本时为 null
  workspaceArticle: null,
  // 页面级状态持久化(会话内跨导航恢复; 深链跳转优先级更高)
  pageState: {
    reading: null, // { mode, text, title, articleId, elapsed, selected: {s, articleId} | null }
    vocabulary: null // { tab, keyword }
  },

  async init() {
    if (this.initialized) return
    if (!window.api) {
      console.warn('[store] window.api 不可用(非 Electron 环境)')
      this.initialized = true
      return
    }
    try {
      this.settings = await window.api.settings.getAll()
      this.applyTheme()
    } catch (e) {
      console.error('初始化设置失败', e)
    }
    this.initialized = true
  },

  async refreshSettings() {
    if (!window.api) return
    this.settings = await window.api.settings.getAll()
    this.applyTheme()
  },

  applyTheme() {
    const root = document.documentElement
    const ap = this.settings?.appearance || {}
    const theme = ap.theme
    if (theme === 'dark') {
      root.dataset.theme = 'dark'
    } else {
      delete root.dataset.theme
    }

    // 阅读外观变量: 之前这些设置项(荧光笔颜色/行距/字距词距/加粗比例等)从未真正生效
    const set = (name, val) => {
      if (val === undefined || val === null || val === '') root.style.removeProperty(name)
      else root.style.setProperty(name, val)
    }
    // 荧光笔颜色: 暗色模式由 token 的 !important 值接管, 用户自定义色只在浅色生效
    if (theme === 'dark') root.style.removeProperty('--highlight-color')
    else set('--highlight-color', ap.highlightColor || '#fef3c7')
    set('--rt-line-height', ap.lineHeight != null ? String(ap.lineHeight) : '2')
    const adhd = ap.adhd || {}
    set('--rt-letter-spacing', adhd.letterSpacing != null ? `${adhd.letterSpacing}em` : '')
    set('--rt-word-spacing', adhd.wordSpacing != null ? `${adhd.wordSpacing}em` : '')
    const base = (Number(ap.fontScale) || 1) * (Number(adhd.baseScale) || 1)
    set('--rt-base-scale', String(base))
    set('--rt-lead-scale', adhd.leadScale != null ? String(adhd.leadScale) : '')
    // (聚焦淡化效果已按用户要求移除, 不再设置 --rt-focus-opacity)
  }
})

// 外观相关设置变化时自动重应用(主题 + 阅读外观变量)
watch(
  () => store.settings?.appearance,
  () => store.applyTheme(),
  { deep: true }
)
