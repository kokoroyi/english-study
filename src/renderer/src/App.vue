<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { router } from './router'
import { store, bus } from './store'
import SentenceWorkspace from './components/SentenceWorkspace.vue'

const nav = [
  { path: '/dashboard', label: '控制台', icon: 'dashboard' },
  { path: '/reading', label: '阅读 / 复习', icon: 'book-open' },
  { path: '/vocabulary', label: '词库', icon: 'library' },
  { path: '/grammar', label: '语法本', icon: 'grammar' },
  { path: '/articles', label: '文章历史', icon: 'file-text' },
  { path: '/settings', label: '设置', icon: 'settings' }
]

const route = useRoute()
const dueCount = ref(0)

// ---- 工作区收起态: 进入阅读页初始自行展开; 有上下文(选中句/全文)时自动展开 ----
const wsCollapsed = ref(false)
// 无上下文场景(如复习列表): ▸ 手动展开的空工作区(占位 + 提问入口), 关闭/切页即复位
const wsForceOpen = ref(false)
// 「收起」按钮与 ▸ 展开条共用: 按当前可见态做互斥的收起/展开; 无上下文时允许手动展开空工作区
function toggleWsCollapse() {
  if (wsVisible.value) {
    wsCollapsed.value = true
    wsForceOpen.value = false
  } else {
    wsCollapsed.value = false
    wsForceOpen.value = !wsContext.value
  }
}

const wsArticleText = computed(() => !!(store.workspaceArticle && store.workspaceArticle.text))
// 工作区上下文: 有选中句(句子模式) 或 全文上下文(阅读正文/原文复习文章/AI 复习故事)
const wsContext = computed(() => !!store.selectedSentence || wsArticleText.value)
// 完整工作区可见 = 未收起 且 (有上下文 或 手动展开)
const wsVisible = computed(() => !wsCollapsed.value && (wsContext.value || wsForceOpen.value))
// 收起/关闭后的独立展开条: 阅读页(含复习)任何模式下, 只要工作区不可见就提供 ▸
// (此前只在 wsCollapsed 时显示: 复习列表无上下文时 wsVisible=false 且 wsCollapsed=false → 工作区与展开条双双消失)
const wsStripVisible = computed(() => route.path === '/reading' && !wsVisible.value)

function goReview() {
  // 直接跳转复习页并自动进入复习模式
  router.push({ path: '/reading', query: { review: '1' } })
}

async function refreshDue() {
  try {
    // 用专用计数接口, 避免到期词超过列表 LIMIT 时徽标被截断
    dueCount.value = await window.api.review.dueCount()
  } catch {
    dueCount.value = 0
  }
}


// ---- 首启三步气泡引导(P2-5): 仅首次展示一次, 沿用 app.guideSeen 落库门控 ----
const guideSteps = [
  '「阅读 / 复习」页粘贴英文短文 → 点「开始阅读」, 划选生词点荧光笔标记。',
  '单击任意句子 → 右侧 AI 工作区 → 「翻译」「完整解析」或直接提问。',
  '完整解析过的句子自动收录进「语法本」, 按语法点归档, 可一键跳回原文。'
]
const appSetRef = ref(null)
const guideSeen = ref(true)
const guideStep = ref(0)
async function maybeShowGuide() {
  try {
    const appSet = await window.api.settings.get('app')
    appSetRef.value = appSet || {}
    guideSeen.value = !!appSet?.guideSeen
  } catch {
    /* 引导失败不影响使用 */
  }
}
function nextGuide() {
  if (guideStep.value < guideSteps.length - 1) guideStep.value++
  else dismissGuide()
}
function dismissGuide() {
  guideSeen.value = true
  try { window.api.settings.set('app', { ...(appSetRef.value || {}), guideSeen: true }) } catch { /* 忽略 */ }
}

// Esc 直接关闭工作区(全鼠标交互的唯一键盘例外); 气泡打开时 Esc 优先只关气泡
// Esc / ✕ 主动关闭工作区: 与「取消选中(回到全文)」区分——关闭时必须真的收起, 不能被选中态 watcher 弹回来
let closingWorkspace = false
function closeWorkspace() {
  closingWorkspace = true
  store.selectedSentence = null
  wsForceOpen.value = false
  wsCollapsed.value = true
  setTimeout(() => { closingWorkspace = false }, 0)
}
function onKeydown(e) {
  if (e.key !== 'Escape' || document.querySelector('.term-popup')) return
  if (store.selectedSentence) closeWorkspace()
  else if (wsVisible.value) { // 全文模式/手动展开时 Esc 收起(保留 ▸ 展开条)
    wsCollapsed.value = true
    wsForceOpen.value = false
  }
}

// 选中句子 → 自动展开(全文模式/收起状态下点句都恢复); 路由切换清除选中并按页控制展开
let routeChanging = false
watch(() => store.selectedSentence, (v) => {
  if (v) {
    wsCollapsed.value = false
    wsForceOpen.value = false
  } else if (!routeChanging && !closingWorkspace) {
    // 取消选中(再点同一句): 有全文上下文(阅读正文/复习原文/故事)时回到全文模式, 不直接关工作区
    wsCollapsed.value = !wsArticleText.value
    wsForceOpen.value = false
  }
})
// 全文上下文从无到有(打开原文复习/生成 AI 故事/恢复阅读)时自动展开工作区
watch(wsContext, (v, old) => {
  if (v && !old) {
    wsCollapsed.value = false
    wsForceOpen.value = false
  }
})
watch(() => route.path, (p) => {
  routeChanging = true
  store.selectedSentence = null
  wsForceOpen.value = false
  wsCollapsed.value = p !== '/reading' // 进入阅读页初始自行展开
  setTimeout(() => { routeChanging = false }, 0)
})

// ---- 页面/工作区过渡: JS 钩子 + setTimeout 驱动 ----
// 元素移除由计时器保证(transitionend/动画帧在隐藏窗口会被节流或永不触发),
// CSS 过渡只负责可见时的视觉效果, 失败不影响正确性。
function onPageEnter(el, done) {
  el.style.opacity = '0'
  el.style.transform = 'translateY(8px)'
  el.style.transition = 'opacity 180ms ease, transform 180ms ease'
  setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'none' }, 20)
  setTimeout(() => {
    el.style.transition = ''
    el.style.opacity = ''
    el.style.transform = ''
    done()
  }, 240)
}
function onPageLeave(el, done) {
  // 离场页绝对定位覆盖在内容区: 不影响新页布局, 不拦截点击
  el.style.position = 'absolute'
  el.style.inset = '0'
  el.style.zIndex = '5'
  el.style.pointerEvents = 'none'
  el.style.transition = 'opacity 80ms ease'
  el.style.opacity = '0'
  setTimeout(done, 120)
}
function onDrawerEnter(el, done) {
  el.style.opacity = '0'
  el.style.transform = 'translateX(40px)'
  el.style.transition = 'transform 220ms ease, opacity 220ms ease'
  setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'none' }, 20)
  setTimeout(() => {
    el.style.transition = ''
    el.style.opacity = ''
    el.style.transform = ''
    done()
  }, 280)
}
function onDrawerLeave(el, done) {
  el.style.transition = 'transform 220ms ease, opacity 220ms ease'
  el.style.transform = 'translateX(40px)'
  el.style.opacity = '0'
  setTimeout(done, 280)
}

onMounted(() => {
  store.init()
  refreshDue()
  bus.on('review-done', refreshDue)
  window.addEventListener('keydown', onKeydown)
  // 等设置初始化完成后再判断是否首次(settings.get 依赖主进程, 与 store 并行即可)
  maybeShowGuide()
})

onBeforeUnmount(() => {
  bus.off('review-done', refreshDue)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="app-shell">
    <!-- 顶部横栏: 全宽固定, 不随工作区开合而变化 -->
    <header class="topbar">
      <div class="topbar-brand">
        <div class="brand-logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 6v13M6 12H3a9 9 0 0 0 9 9h0a9 9 0 0 0 9-9h-3" />
            <circle cx="12" cy="6" r="3" />
          </svg>
        </div>
        <div class="brand-text">
          <div class="brand-name">English Study</div>
          <div class="brand-sub">个人英语助手</div>
        </div>
      </div>
      <div class="crumb">
        <span class="crumb-current">{{ nav.find((n) => n.path === route.path)?.label || '控制台' }}</span>
      </div>
      <div class="topbar-right">

        <div v-if="dueCount > 0" class="due-pill clickable" @click="goReview" v-tip="'点击进入复习'">
          <span class="due-dot"></span> {{ dueCount }} 词到期
        </div>
      </div>
    </header>

    <!-- 主体三栏: 左导航 | 中内容(自适应) | 右 AI 工作区 -->
    <div class="app-body">
      <aside class="sidebar">
        <nav class="nav">
          <div class="nav-group">学习</div>
          <RouterLink v-for="item in nav.slice(0, 4)" :key="item.path" :to="item.path" class="nav-item">
            <span class="nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <template v-if="item.icon === 'dashboard'"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></template>
                <template v-else-if="item.icon === 'book-open'"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></template>
                <template v-else-if="item.icon === 'grammar'"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></template>
                <template v-else><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></template>
              </svg>
            </span>
            <span class="nav-label">{{ item.label }}</span>
            <span v-if="item.path === '/reading' && dueCount > 0" class="nav-badge">{{ dueCount }}</span>
          </RouterLink>

          <div class="nav-group">管理</div>
          <RouterLink v-for="item in nav.slice(4)" :key="item.path" :to="item.path" class="nav-item">
            <span class="nav-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <template v-if="item.icon === 'file-text'"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></template>
                <template v-else><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></template>
              </svg>
            </span>
            <span class="nav-label">{{ item.label }}</span>
          </RouterLink>
        </nav>

        <div class="sidebar-foot">
          <div class="foot-dot"></div>
          <span>本地个人数据</span>
        </div>
      </aside>

      <main class="content">
        <RouterView v-slot="{ Component }">
          <!-- JS 钩子 + setTimeout 驱动: 元素移除由计时器保证(隐藏窗口动画节流也不卡),
               视觉动画仅作装饰, 失败不影响正确性 -->
          <Transition appear :css="false" @enter="onPageEnter" @leave="onPageLeave">
            <component :is="Component" :key="route.fullPath" />
          </Transition>
        </RouterView>
      </main>

      <!-- AI 工作区: 三栏右列(真实占位, 不遮挡阅读; ✕ 或 Esc 或再点同句关闭; 阅读页初始自行展开·全文模式) -->
      <Transition :css="false" @enter="onDrawerEnter" @leave="onDrawerLeave">
        <aside v-if="wsVisible" class="sentence-drawer" :class="{ collapsed: wsCollapsed }">
          <SentenceWorkspace
            :sentence="store.selectedSentence ? store.selectedSentence.s : null"
            :article-id="store.selectedSentence ? store.selectedSentence.articleId : null"
            :article="store.workspaceArticle"
            :collapsed="wsCollapsed"
            @toggle-collapse="toggleWsCollapse"
            @close="closeWorkspace"
          />
        </aside>
      </Transition>
      <!-- 收起态展开条: 关闭/收起后无需选中句子, 点 ▸ 即可重新打开工作区 -->
      <div v-if="wsStripVisible" class="ws-reopen">
        <button class="ws-collapse-btn" @click="toggleWsCollapse" v-tip="'展开工作区'">▸</button>
      </div>
    </div>

    <!-- 首启三步气泡引导卡(一次性; ✕ 可提前关闭) -->
    <div v-if="!guideSeen" class="guide-card ca-card">
      <div class="guide-head">
        <span class="guide-title">欢迎使用 English Study</span>
        <button class="guide-close" @click="dismissGuide" v-tip="'跳过引导'">✕</button>
      </div>
      <div class="guide-body">
        <div class="guide-step-label">第 {{ guideStep + 1 }} / {{ guideSteps.length }} 步</div>
        <div class="guide-text">{{ guideSteps[guideStep] }}</div>
        <div class="guide-dots">
          <span v-for="(s, i) in guideSteps" :key="i" class="guide-dot" :class="{ on: i === guideStep }"></span>
        </div>
      </div>
      <div class="guide-actions">
        <button class="ca-btn ca-btn--primary" @click="nextGuide">
          {{ guideStep === guideSteps.length - 1 ? '开始使用' : '下一步' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 整体骨架: 顶部横栏(全宽固定) + 主体三栏 */
.app-shell {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.app-body { flex: 1; display: flex; min-height: 0; }

.sidebar {
  width: var(--ca-sidebar-width);
  flex: 0 0 var(--ca-sidebar-width);
  background: var(--ca-surface);
  border-right: 1px solid var(--ca-line);
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar-brand {
  width: var(--ca-sidebar-width);
  flex: 0 0 var(--ca-sidebar-width);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-right: 1px solid var(--ca-line);
  height: 100%;
}

.brand-logo {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  color: #fff;
  background-image: var(--ca-primary-gradient);
}

.brand-name { font-weight: 700; font-size: 15px; }
.brand-sub { font-size: 11px; color: var(--ca-ink-3); }

.nav { flex: 1; padding: 8px 12px; overflow-y: auto; }

.nav-group {
  font-size: 11px;
  color: var(--ca-ink-3);
  font-weight: 600;
  letter-spacing: 0.08em;
  padding: 12px 8px 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  color: var(--ca-ink-2);
  text-decoration: none;
  font-size: 13px;
  font-weight: 500;
  transition: background var(--ca-duration-fast) var(--ca-ease), color var(--ca-duration-fast) var(--ca-ease);
}

.nav-item:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }

.nav-item.router-link-active {
  background: var(--ca-primary-soft);
  color: var(--ca-primary);
  font-weight: 600;
}

.nav-icon { display: grid; place-items: center; color: inherit; }
.nav-label { flex: 1; }

.nav-badge {
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--ca-critical);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}

.sidebar-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--ca-line);
  font-size: 12px;
  color: var(--ca-ink-3);
}

.foot-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ca-success); }

/* 顶部横栏: 全宽固定, 开合工作区不改变其宽度 */
.topbar {
  height: var(--ca-topbar-height);
  flex: 0 0 var(--ca-topbar-height);
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px 0 0;
  background: var(--ca-surface);
  border-bottom: 1px solid var(--ca-line);
}

.crumb { display: flex; align-items: center; flex: 1; font-size: 13px; }
.crumb-current { font-weight: 600; }

.due-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  background: var(--ca-warning-soft);
  color: var(--ca-warning-ink);
  font-size: 12px;
  font-weight: 600;
}
.due-pill.clickable { cursor: pointer; }
.due-pill.clickable:hover { box-shadow: 0 0 0 2px var(--ca-warning); }

.due-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--ca-warning); }

.content { flex: 1; overflow-y: auto; position: relative; }

/* AI 工作区: 三栏布局中的右列(真实占位, 阅读区随之中间自适应收缩, 互不遮挡) */
.sentence-drawer {
  position: relative;
  flex: 0 0 420px;
  width: 420px;
  height: 100%;
  z-index: 50;
  display: flex;
  background: var(--ca-surface);
  border-left: 1px solid var(--ca-line);
}
.sentence-drawer :deep(.sentence-ws) {
  width: 100%;
  flex: 0 0 100%; /* 必须压掉组件自身的 flex: 0 0 460px, 否则 flex-basis 优先级高于 width, 右缘溢出被裁 */
  min-width: 0;
  height: 100%;
  border: none;
  border-radius: 0;
}
@media (max-width: 1280px) {
  .sentence-drawer { flex: 0 0 360px; width: 360px; }
}
/* 窄窗口: 空间不足以三栏, 工作区退化为底部抽屉 */
@media (max-width: 1100px) {
  .sentence-drawer {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    top: auto;
    width: auto;
    flex: none;
    margin: 0;
    height: 58vh;
    z-index: 900;
    border-left: none;
    border-top: 1px solid var(--ca-line);
    box-shadow: 0 -14px 36px rgba(11, 18, 32, 0.16);
  }
  .sentence-drawer :deep(.sentence-ws) { max-height: none; }
}

.drawer-enter-active, .drawer-leave-active { transition: transform 0.22s var(--ca-ease), opacity 0.22s var(--ca-ease); }
.drawer-enter-from, .drawer-leave-to { transform: translateX(40px); opacity: 0; }

/* 工作区收起态: 压缩为细条(宽度固定设计, 仅裁剪占位以让出阅读区) */
.sentence-drawer.collapsed { flex: 0 0 52px; width: 52px; }
.sentence-drawer.collapsed :deep(.sentence-ws) { flex: 0 0 52px; width: 52px; }
@media (max-width: 1280px) {
  .sentence-drawer.collapsed { flex: 0 0 52px; width: 52px; }
  .sentence-drawer.collapsed :deep(.sentence-ws) { flex: 0 0 52px; width: 52px; }
}
/* 收起/关闭后的独立展开条: 无需选中句子即可 ▸ 重新打开工作区 */
.ws-reopen {
  flex: 0 0 52px;
  width: 52px;
  display: flex;
  justify-content: center;
  padding-top: 14px;
  background: var(--ca-surface);
  border-left: 1px solid var(--ca-line);
}
.ws-reopen .ws-collapse-btn {
  width: 28px;
  height: 28px;
  border: 1px solid var(--ca-line);
  border-radius: 8px;
  background: var(--ca-surface-subtle);
  color: var(--ca-ink-2);
  font-size: 14px;
  cursor: pointer;
}
.ws-reopen .ws-collapse-btn:hover { background: var(--ca-primary-soft); color: var(--ca-primary); }
/* 窄窗口下工作区本为底部抽屉, 收起态不再压缩宽度 */
@media (max-width: 1100px) {
  .sentence-drawer.collapsed { flex: none; width: auto; }
}

/* 首启三步气泡引导卡(右上角) */
.guide-card {
  position: fixed;
  top: 64px;
  right: 24px;
  z-index: 1200;
  width: 320px;
  padding: 14px 16px;
  box-shadow: var(--ca-shadow-float);
  border-left: 3px solid var(--ca-primary);
}
.guide-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.guide-title { font-size: 13.5px; font-weight: 700; color: var(--ca-ink); }
.guide-close { width: 22px; height: 22px; border: none; border-radius: 6px; background: transparent; color: var(--ca-ink-3); cursor: pointer; }
.guide-close:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }
.guide-body { display: flex; flex-direction: column; gap: 6px; }
.guide-step-label { font-size: 11px; font-weight: 600; color: var(--ca-primary); }
.guide-text { font-size: 12.5px; line-height: 1.7; color: var(--ca-ink-2); }
.guide-dots { display: flex; gap: 5px; margin-top: 2px; }
.guide-dot { width: 15px; height: 4px; border-radius: 2px; background: var(--ca-line); }
.guide-dot.on { background: var(--ca-primary); }
.guide-actions { display: flex; justify-content: flex-end; margin-top: 10px; }
</style>
