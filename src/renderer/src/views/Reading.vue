<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute } from 'vue-router'
import ReadingText from '../components/ReadingText.vue'
import ReviewCards from '../components/ReviewCards.vue'
import { store, bus } from '../store'
import { plain } from '../lib/ipcSafe'
import { alert, confirm, choose } from '../lib/modal'
import { toast } from '../lib/toast'
import { splitSentences } from '../lib/sentenceSplit'
import { getAdhdMode, nextAdhdMode, withAdhdMode, ADHD_MODE_LABEL } from '../lib/adhdMode'

const route = useRoute()

const DRAFT_KEY = 'es-reading-draft'
const DRAFT_TITLE_KEY = 'es-reading-title'

// 模式: 'input' | 'reading' | 'review'
const mode = ref('input')
const text = ref('')
const title = ref('')
const articleId = ref(null)

// 阅读会话计时
const sessionId = ref(null)
const elapsed = ref(0)
let tickTimer = null
let isActive = true
let lastActivity = Date.now()

// 本次阅读标记的词
const markedPool = ref([])

// ADHD 阅读模式: 单一 mode 三态(语义/Bionic/普通), 不再由两个布尔各自漂移。
// 右上角按钮循环切换「语义 → Bionic → 普通」, 文案始终反映当前真实模式。
const adhdModeKey = computed(() => getAdhdMode(store.settings?.appearance))
const adhdOn = computed(() => adhdModeKey.value !== 'off')
const adhdModeLabel = computed(() => ADHD_MODE_LABEL[adhdModeKey.value])
const adhdTip = computed(() => `ADHD 阅读: ${adhdModeLabel.value} · 点击切换 语义 → Bionic → 普通`)
function toggleAdhd() {
  const appearance = plain(store.settings?.appearance || {})
  const adhd = withAdhdMode(appearance.adhd, nextAdhdMode(getAdhdMode(appearance)))
  window.api.settings.set('appearance', plain({ ...appearance, adhd }))
    .then(() => store.refreshSettings())
    .catch((e) => console.error('ADHD 开关失败', e))
}

// 草稿持久化(切换页面不丢失)
watch(text, (v) => localStorage.setItem(DRAFT_KEY, v))
watch(title, (v) => localStorage.setItem(DRAFT_TITLE_KEY, v))

onMounted(() => {
  text.value = localStorage.getItem(DRAFT_KEY) || ''
  title.value = localStorage.getItem(DRAFT_TITLE_KEY) || ''
  // 从控制台「开始复习」/顶部到期徽标跳转而来: 自动进入复习模式
  if (route.query.review === '1') {
    startReview()
  } else if (route.query.article) {
    // 语法本例句跳回原文: 打开已有文章并定位句子
    openGrammarJump()
  } else {
    // 页面级持久化: 恢复上次的阅读视图(去语法本/词库再回来不回到输入页)
    tryRestoreReading()
  }
})

// 页面级持久化: 离开时保存阅读状态(在 App 清空全局选中前取本地镜像)
function saveReadingState() {
  if (mode.value === 'reading' && articleId.value) {
    store.pageState.reading = {
      mode: 'reading',
      text: text.value,
      title: title.value,
      articleId: articleId.value,
      elapsed: elapsed.value,
      selected: lastSelected.value ? { s: { ...lastSelected.value.s }, articleId: lastSelected.value.articleId } : null
    }
  } else {
    store.pageState.reading = null
  }
}

async function tryRestoreReading() {
  const saved = store.pageState.reading
  if (!saved || saved.mode !== 'reading' || !saved.articleId) return
  let art = null
  try { art = await window.api.articles.get(saved.articleId) } catch { /* 按已删除处理 */ }
  if (!art) {
    // 冲突兜底: 文章已被删除 → 回退输入模式(草稿保留), 不再重复尝试恢复
    store.pageState.reading = null
    toast('上次阅读的文章已删除', 'info')
    return
  }
  title.value = art.title || saved.title || ''
  text.value = art.cleaned_content || art.content
  articleId.value = saved.articleId
  mode.value = 'reading'
  try {
    const s = await window.api.sessions.start({ type: 'reading', articleId: articleId.value })
    sessionId.value = s.id
    startTicking()
    elapsed.value = saved.elapsed || 0
  } catch (e) {
    console.error('恢复阅读会话失败', e)
  }
  if (saved.selected?.s) {
    store.selectedSentence = { s: saved.selected.s, articleId: saved.selected.articleId ?? saved.articleId }
    lastSelected.value = { s: saved.selected.s, articleId: saved.selected.articleId ?? saved.articleId }
  }
}

// 语法本 → 回原文: 加载已有文章(不重建), 选中对应句子并打开工作区
const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim()
async function openGrammarJump() {
  const id = Number(route.query.article)
  let art = null
  try { art = await window.api.articles.get(id) } catch { /* 数据异常按已删除处理 */ }
  if (!art) {
    toast('原文章已删除, 该例句仍保留在语法本', 'info')
    return
  }
  title.value = art.title || ''
  text.value = art.cleaned_content || art.content
  articleId.value = id
  mode.value = 'reading'
  try {
    const s = await window.api.sessions.start({ type: 'reading', articleId: id })
    sessionId.value = s.id
    startTicking()
  } catch (e) {
    console.error('会话启动失败', e)
  }
  if (route.query.sentence) {
    const target = norm(String(route.query.sentence))
    const list = splitSentences(text.value)
    const found = list.find((s) => norm(s.text) === target)
    if (found) {
      store.selectedSentence = { s: { index: list.indexOf(found), text: found.text, start: found.start, end: found.end }, articleId: id }
      lastSelected.value = { s: store.selectedSentence.s, articleId: id }
    } else {
      toast('未能在原文中定位到该句(文章内容可能已变化)', 'info')
    }
  }
}

async function startReading() {
  if (!text.value.trim()) return
  // 防重复: 已在阅读模式且有文章时不重复创建
  if (mode.value === 'reading' && articleId.value) {
    return
  }
  // 从复习模式直接切到阅读: 先结束复习会话, 再清空复习视图状态,
  // 否则 reviewMode/currentReviewWords 残留会让阅读模式的标记/取消判定走错分支(交互冲突)
  if (mode.value === 'review') {
    await stopTickingAndEndSession()
    reviewMode.value = false
    reviewArticle.value = null
    reviewStoryText.value = ''
    reviewWordsForArticle.value = []
    currentReviewWords.value = []
    showReviewCards.value = false
    reviewState.value = null
  }
  try {
    // 开始新文章前清掉上一次会话残留的标记池(防止摘要/复习误判)与句子选中
    markedPool.value = []
    clearSentence()
    // 清洗文本
    const cleaned = await window.api.articles.clean(text.value)
    text.value = cleaned
    // 未填标题: 用清洗后正文首句自动生成(截断 40 字符), 避免历史/复习列表一直显示「未命名文章」
    let autoTitled = false
    if (!title.value.trim()) {
      const auto = autoTitle(cleaned)
      if (auto) {
        title.value = auto
        autoTitled = true
      }
    }
    const created = await window.api.articles.create({ title: title.value, content: text.value })
    // 自动标题属于文章元数据, 不留在草稿标题里(否则下一次新建会沿用上一篇的标题)
    if (autoTitled) localStorage.removeItem(DRAFT_TITLE_KEY)
    articleId.value = created.id
    mode.value = 'reading'
    // 启动计时
    const s = await window.api.sessions.start({ type: 'reading', articleId: articleId.value })
    sessionId.value = s.id
    startTicking()
  } catch (e) {
    console.error('开始阅读失败', e)
    await alert('开始阅读失败', e.message)
  }
}

// 切回输入模式: 若正在阅读/复习计时, 先结束会话再切换(此前会话在后台继续计时)
async function switchToInput() {
  await stopTickingAndEndSession()
  clearSentence()
  mode.value = 'input'
}

function startTicking() {
  elapsed.value = 0
  isActive = true
  lastActivity = Date.now()
  tickTimer = setInterval(() => {
    if (document.hidden) {
      isActive = false
      return
    }
    // 闲置暂停: 超过 idleTimeout 秒无交互则暂停计时
    const idleTimeout = (store.settings?.behavior?.idleTimeoutSeconds ?? 300) * 1000
    if (Date.now() - lastActivity > idleTimeout) {
      isActive = false
      return
    }
    isActive = true
    elapsed.value++
    if (sessionId.value) window.api.sessions.tick(sessionId.value, 1)
  }, 1000)
  window.addEventListener('blur', onBlur)
  window.addEventListener('mousemove', onActivity)
  window.addEventListener('keydown', onActivity)
  document.addEventListener('visibilitychange', onVis)
}

function onActivity() { lastActivity = Date.now() }
function onBlur() { isActive = false }
function onVis() { isActive = !document.hidden }

function stopTicking() {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('mousemove', onActivity)
  window.removeEventListener('keydown', onActivity)
  document.removeEventListener('visibilitychange', onVis)
}

// 停止计时并结束会话(秒数落库)
async function stopTickingAndEndSession(data = null) {
  stopTicking()
  // 先取走并置空, 防止并发调用对同一会话二次 endSession(会把已落库时长清零)
  const id = sessionId.value
  sessionId.value = null
  if (id) {
    try {
      await window.api.sessions.end(id, data || {})
    } catch (e) {
      console.error('结束会话失败', e)
    }
  }
}

async function endReading() {
  // 生词在点击荧光笔时已即时入库, 这里只需结束会话计时
  await stopTickingAndEndSession({ markedWords: markedPool.value.length })
  showSummary.value = true
}

const showSummary = ref(false)

async function finishSession() {
  showSummary.value = false
  markedPool.value = []
  clearSentence()
  mode.value = 'input'
  text.value = ''
  title.value = ''
  articleId.value = null
  sessionId.value = null
  elapsed.value = 0
  store.pageState.reading = null // 会话已完成, 不再恢复
  localStorage.removeItem(DRAFT_KEY)
  localStorage.removeItem(DRAFT_TITLE_KEY)
}

// 在本次复习词中查找(按 lemma / display 小写匹配)
function matchDueWord(lower) {
  return (
    currentReviewWords.value.find(
      (rw) => (rw.lemma || '').toLowerCase() === lower || (rw.display || '').toLowerCase() === lower
    ) || null
  )
}

async function onWordMarked(words) {
  for (const w of words) {
    const lower = w.toLowerCase()
    if (markedPool.value.some((m) => m.word.toLowerCase() === lower)) {
      continue // 已标记过
    }
    // 复习模式 + 该词是本次待复习词: 只记入标记池供"读完判定"使用,
    // 不再调用 words.mark —— 否则熟词会被 markWord 打回一次、又被 submitWordResult(unknown)
    // 再打回一次, miss_count 双计; 同时避免"刚标记就点复习完成"的异步竞态
    let dueWord = reviewMode.value ? matchDueWord(lower) : null
    if (reviewMode.value && !dueWord) {
      // 词形变化匹配: 故事里出现 "perceiving", 到期词是 "perceive" → 归并到原型
      try {
        const lemma = await window.api.dict.lemma(w)
        if (lemma && lemma.toLowerCase() !== lower) {
          dueWord = matchDueWord(lemma.toLowerCase())
          if (dueWord) markedPool.value.push({ word: w, lemma: dueWord.lemma, wordId: dueWord.id || null, isNew: false })
        }
      } catch {
        /* 词典不可用则跳过归并 */
      }
      if (dueWord) continue
    }
    if (dueWord) {
      markedPool.value.push({ word: w, lemma: dueWord.lemma, wordId: dueWord.id || null, isNew: false })
      continue
    }

    // 同步加入池子(先于任何 await), 保证 finishPureReading 能立即看到
    markedPool.value.push({ word: w, wordId: null, isNew: true })
    // 立即写入数据库, 防止切走丢词
    try {
      const res = await window.api.words.mark({
        word: w,
        sourceArticleId: articleId.value || null
      })
      const entry = markedPool.value.find((m) => m.word.toLowerCase() === lower)
      if (!entry) {
        // 等待期间用户取消了标记: 若刚新建的词条, 撤回它
        if (res?.isNew && res?.word?.id) {
          window.api.words.remove(res.word.id).catch(() => {})
        }
        continue
      }
      // 写入结果回填(isNew=false 表示之前已在生词本)
      entry.wordId = res?.word?.id || null
      entry.isNew = res?.isNew !== false
    } catch (e) {
      console.error('生词入库失败', w, e)
    }
  }
}

async function onWordUnmarked(words) {
  // words 可能是数组(unmarkSelection 批量)或单字符串
  const list = Array.isArray(words) ? words : [words]
  for (const word of list) {
    if (reviewMode.value) {
      // 复习模式: 取消标记仅表示"这个词其实认识", 不删除数据库词条
      reviewUnmark(word)
    } else {
      await unmarkOne(word)
    }
  }
}

function reviewUnmark(word) {
  const idx = markedPool.value.findIndex((m) => m.word.toLowerCase() === word.toLowerCase())
  if (idx >= 0) markedPool.value.splice(idx, 1)
}

async function unmarkOne(word) {
  const idx = markedPool.value.findIndex((m) => m.word.toLowerCase() === word.toLowerCase())
  if (idx < 0) return
  const rec = markedPool.value[idx]
  markedPool.value.splice(idx, 1)

  try {
    const lemma = await window.api.dict.lemma(word)
    const found = await window.api.words.list({ keyword: lemma })
    for (const w of found) {
      if (w.lemma !== lemma) continue
      if (rec.isNew && rec.wordId) {
        // 本次新标记的词 → 真正撤销: 从生词本删除
        await window.api.words.remove(rec.wordId)
      } else if (w.source_article_id != null && w.source_article_id === articleId.value) {
        // 之前就在生词本: 仅当来源就是当前文章时才解除关联,
        // 否则会把词的历史来源(其他文章)误删、降级为"无来源词"
        await window.api.words.update(w.id, { source_article_id: null })
      }
    }
  } catch (e) {
    console.error('取消标记失败', word, e)
  }
}

// ---- 句子解析工作区(App 级右侧抽屉, 全局 store 选中态) ----
const selectedSentence = computed(() => store.selectedSentence?.s || null)
// 本地选中镜像: 离开页面时 App 会清空全局选中(关抽屉), 持久化需要本地快照
const lastSelected = ref(null)

function onSentenceClick(s) {
  // 再点同一句 = 取消选中(工作区开合自如); 点其他句 = 切换选中
  if (store.selectedSentence?.s?.index === s.index && store.selectedSentence?.s?.start === s.start) {
    clearSentence()
    return
  }
  // 文章归属: 阅读模式 → 当前文章; 原文复习 → 复习文章; AI 故事复习 → 无
  const aid = mode.value === 'review' ? (reviewArticle.value?.id ?? null) : articleId.value
  store.selectedSentence = { s, articleId: aid }
  lastSelected.value = { s, articleId: aid }
}

function clearSentence() {
  store.selectedSentence = null
  lastSelected.value = null
}

// ---- 复习模式 ----
const reviewMode = ref(false)
const reviewState = ref(null)
const reviewResults = ref([])
const reviewArticle = ref(null)
const reviewStoryText = ref('')
const reviewStoryTitle = ref('') // AI 故事标题(提示词要求输出, 显示在工具栏; 无标题时回退「AI 复习故事」)
const reviewGenerating = ref(false)
const reviewWordsForArticle = ref([])
const showReviewCards = ref(false)
const reviewMeta = ref(null) // { total, limit, shown }
const lastStoryRequest = ref([]) // 最近一次故事生成的请求词集(手动「重新生成」复用同一批词, force 绕缓存)

// ---- 工作区全文上下文: 阅读正文 / 原文复习文章 / AI 复习故事 统一暴露为「全文模式」 ----
// 句子模式优先(App 层用 selectedSentence); 这里只维护无选中句时的全文上下文。
// 复习模式此前直接置 null → 工作区拿不到文章, 只能选句后使用; 现在原文复习与故事复习都能直接对全文提问。
watch(
  () => [
    mode.value, reviewMode.value, text.value, title.value, articleId.value,
    reviewArticle.value, reviewStoryTitle.value, reviewStoryText.value
  ],
  () => {
    // 输入模式不暴露全文上下文: 否则边打字边把草稿当"全文"推给工作区(每次按键触发一次哈希/缓存 IPC),
    // 且未开始阅读就自动展开工作区。点「开始阅读」进入 reading 后自然展开。
    if (mode.value === 'input') {
      store.workspaceArticle = null
      return
    }
    if (mode.value === 'review') {
      if (reviewStoryText.value) {
        store.workspaceArticle = { title: reviewStoryTitle.value || 'AI 复习故事', text: reviewStoryText.value, articleId: null }
      } else if (reviewArticle.value) {
        store.workspaceArticle = {
          title: reviewArticle.value.title || '',
          text: reviewArticle.value.cleaned_content || reviewArticle.value.content || '',
          articleId: reviewArticle.value.id ?? null
        }
      } else {
        store.workspaceArticle = null
      }
      return
    }
    if (!text.value) {
      store.workspaceArticle = null
    } else {
      store.workspaceArticle = { title: title.value || '', text: text.value, articleId: articleId.value || null }
    }
  },
  { immediate: true }
)

// 本组原文复习的词(纯阅读判定: 重新标记=不认识, 未标记=认识)
const currentReviewWords = ref([])

// 「第 2/3 次复习 → AI 故事」分流: stage>=1 的有原文词默认进入 AI 故事桶(README: 第 1 次原文, 第 2/3 次 AI 故事);
// 用户可一键改回原文复习(AI 不可用等场景的逃生阀), 该选择仅本会话内有效
const storyFallback = ref(false)

function buildReviewState(due) {
  // 按状态分流: new/learning → 纯阅读复习; fluent(熟词) → 逐词确认卡片
  const byArticle = {}
  const noSource = { read: [], fluent: [] }
  const story = [] // 有原文且 stage>=1(第 2/3 次复习) → AI 故事桶
  for (const w of due) {
    const bucket = w.status === 'fluent' ? 'fluent' : 'read'
    if (w.source_article_id) {
      if (bucket === 'read' && !storyFallback.value && Number(w.stage) > 0) {
        story.push(w)
        continue
      }
      if (!byArticle[w.source_article_id]) byArticle[w.source_article_id] = { read: [], fluent: [] }
      byArticle[w.source_article_id][bucket].push(w)
    } else {
      noSource[bucket].push(w)
    }
  }
  return {
    type: 'original',
    articleId: null,
    noSource,
    story,
    groups: Object.entries(byArticle).map(([aid, g]) => ({
      aid: Number(aid),
      ...g,
      // 后端 words.list/review.dueToday 新增 source_article_title; 字段缺失/已删文章 → null 回退「文章 #id」
      title: [...g.read, ...g.fluent].map((w) => String(w.source_article_title || '').trim()).find((t) => t) || null
    }))
  }
}

/** 标题显示截断(英文/中文均按字符数, 超出加省略号) */
function shortTitle(t, max = 20) {
  const s = String(t || '').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}

/** 无标题文章: 用清洗后正文首句自动生成标题(去首尾标点/空白, 超 40 字符截断); 失败保持空 */
function autoTitle(body) {
  try {
    const src = String(body || '').replace(/\s+/g, ' ').trim()
    if (!src) return ''
    const first = (src.match(/^[^.!?]+[.!?]?/) || [src])[0]
    const t = first
      .replace(/^[\s"'“”‘’()\[\]【】《》「」]+/, '')
      .replace(/[\s"'“”‘’()\[\]【】《》「」.!?,;:]+$/, '')
      .trim()
    if (!t) return ''
    if (t.length <= 40) return t
    // 超长时优先在单词边界截断(避免 "forest fir…" 这类断词), 找不到合适空格再硬截
    const head = t.slice(0, 40)
    const lastSpace = head.lastIndexOf(' ')
    const cut = lastSpace >= 20 ? head.slice(0, lastSpace) : head
    return cut.trimEnd() + '…'
  } catch {
    return ''
  }
}

/** 第 2/3 次复习词改回原文复习(会话内一次性) */
async function useOriginalForStoryWords() {
  storyFallback.value = true
  try {
    const due = await window.api.review.dueToday()
    reviewState.value = buildReviewState(due)
  } catch (e) {
    console.error('切换原文复习失败', e)
  }
}

async function startReview() {
  try {
    // 从阅读页直接切到复习时, 先结束正在进行的阅读会话(否则旧会话继续计时且永远不落库)
    await stopTickingAndEndSession()
    // 清空上一轮阅读/复习的标记池, 防止旧标记被误判为"本轮不认识"
    markedPool.value = []
    // 清掉上一轮残留的句子选中(否则工作区会带着旧文章的句子进入复习列表)
    clearSentence()
    const due = await window.api.review.dueToday()
    if (!due.length) {
      await alert('今日复习', '今天没有待复习的词')
      return
    }
    reviewState.value = buildReviewState(due)
    reviewMeta.value = await window.api.review.dueMeta()
    mode.value = 'review'
    reviewMode.value = true
    reviewResults.value = []
    processedReviewWords.clear()
    storyFallback.value = false
    // 清掉上一轮残留的复习视图状态(否则会直接显示旧文章视图而非复习列表)
    reviewArticle.value = null
    reviewStoryText.value = ''
    reviewStoryTitle.value = ''
    lastStoryRequest.value = []
    reviewWordsForArticle.value = []
    currentReviewWords.value = []
    showReviewCards.value = false
  } catch (e) {
    await alert('加载复习任务失败', e.message)
  }
}

// 复习完成后刷新: 重新拉取到期词, 已复习的自动从列表消失
async function reloadReviewState() {
  try {
    const due = await window.api.review.dueToday()
    reviewMeta.value = await window.api.review.dueMeta()
    if (!due.length) {
      exitReview()
      await alert('复习完成', '今天的复习任务已全部完成')
      return
    }
    reviewState.value = buildReviewState(due)
  } catch (e) {
    console.error('刷新复习列表失败', e)
  }
}

// 结束本组复习, 返回列表并刷新待复习
// completed=true: 本组已判定完成; false: 用户未判定直接返回(提示语不同)
async function backToReviewList(completed = false) {
  reviewArticle.value = null
  reviewStoryText.value = ''
  reviewStoryTitle.value = ''
  lastStoryRequest.value = []
  reviewWordsForArticle.value = []
  currentReviewWords.value = []
  clearSentence()
  // 清掉本组的标记, 避免同名词在下一组被误判为"不认识"
  markedPool.value = []
  await stopTickingAndEndSession()
  // 等全部复习结果落库后再刷新列表, 保证已复习的词从到期列表消失
  await Promise.allSettled(pendingSubmits.splice(0))
  bus.emit('review-done')
  await reloadReviewState()
  // 进度反馈: 完成与放弃用不同文案(此前放弃也提示"本组完成", 误导用户)
  if (mode.value === 'review' && reviewMeta.value) {
    const { total, shown } = reviewMeta.value
    if (total > 0) {
      const rest = shown < total ? `今日还剩 ${shown} 词(共 ${total} 到期, 超出明日继续)` : `今日还剩 ${shown} 词待复习`
      toast(completed ? `本组完成 · ${rest}` : `已返回列表 · ${rest}`, 'info')
    }
  }
}

const reviewOpening = ref(false) // 打开原文复习的防重入(双击会重复开会话并泄漏上一段计时)
async function openReviewArticle(aid) {
  if (reviewOpening.value) return
  reviewOpening.value = true
  try {
    const article = await window.api.articles.get(aid)
    if (!article) {
      // 文章已被删除/数据不一致: 提示并回到列表(原实现会因 reviewArticle 为 undefined 直接崩溃)
      await alert('文章不存在', '该文章的存档已不存在, 已跳过')
      await reloadReviewState()
      return
    }
    // 换文章: 清掉上一句的选中态, 否则工作区会把旧文章的句子带进新文章
    clearSentence()
    reviewArticle.value = article
    const group = reviewState.value.groups.find((g) => g.aid === aid)
    // 本组到期词交给 ReadingText 高亮 + 内联逐词判定
    currentReviewWords.value = group ? (group.read || []) : []
    const s = await window.api.sessions.start({ type: 'review', articleId: aid })
    sessionId.value = s.id
    startTicking()
  } finally {
    reviewOpening.value = false
  }
}

// 内联判定: ReadingText 里点击到期词 → 认识/模糊/不认识(即时提交)
function onInlineWordResult({ id, word, result }) {
  onWordResult({ wordId: id, result })
}

// 读完原文/AI故事 → 复习完成:
// 1. 划选标记的到期词 → 记 unknown
// 2. 已内联判定的词 → 已提交, 跳过
// 3. 仍未判定的词 → 弹窗让用户选择「保持到期」或「全部记为认识」(默认不默认认识, 防止长文漏读误判)
async function finishPureReading(groupWords) {
  const words = groupWords || currentReviewWords.value
  if (!words.length) return
  const markedLower = new Set(markedPool.value.map((m) => m.word.toLowerCase()))
  const markedLemmas = new Set(markedPool.value.map((m) => (m.lemma || '').toLowerCase()).filter(Boolean))
  const isMiss = (w) =>
    markedLower.has((w.lemma || '').toLowerCase()) ||
    markedLower.has((w.display || '').toLowerCase()) ||
    markedLemmas.has((w.lemma || '').toLowerCase())

  for (const w of words) {
    if (processedReviewWords.has(w.id)) continue
    if (isMiss(w)) onWordResult({ wordId: w.id, result: 'unknown' })
  }

  const still = words.filter((w) => !processedReviewWords.has(w.id))
  if (still.length) {
    const list = still.slice(0, 30).map((w) => w.lemma || w.display).join(', ') + (still.length > 30 ? ` 等共 ${still.length} 个` : '')
    const choice = await choose(
      '复习收尾',
      `还有 ${still.length} 个词没有判定:\n\n${list}\n\n「保持到期」: 这些词明天继续复习(适合还没读到的词)\n「全部记为认识」: 认为这 ${still.length} 个词都掌握了`,
      [
        { label: '保持到期(明天再复习)', value: 'skip' },
        { label: `全部记为「认识」(${still.length})`, value: 'known', cls: 'primary' }
      ],
      'abort' // 遮罩/Esc = 返回继续阅读, 不提交
    )
    if (choice === 'abort') return
    if (choice === 'known') {
      for (const w of still) onWordResult({ wordId: w.id, result: 'known' })
    }
  }
  await backToReviewList(true)
}

async function startAiReview(words, { force = false } = {}) {
  // 预检: 统一 OpenAI 兼容接口, 未配置接口地址/Key 时给出引导
  const aiCfg = store.settings?.ai || {}
  if (!aiCfg.baseUrl || !aiCfg.apiKey) {
    await alert('需要配置 AI', '尚未配置 AI API Key 或接口地址\n\n请在「设置 → AI 设置」中填写 OpenAI 兼容接口地址与 Key(可点「获取模型」「测试连接」验证)后, 再使用 AI 故事复习。')
    return
  }
  if (reviewGenerating.value) return // 防双击重复生成
  if (!Array.isArray(words) || !words.length) {
    await alert('AI 故事复习', '没有需要 AI 故事复习的词')
    return
  }
  // 故事复习是另一篇「文章」: 清掉上一轮的句子选中, 避免工作区残留旧句
  clearSentence()
  lastStoryRequest.value = words
  reviewGenerating.value = true
  try {
    // 难度参考: 优先当前组词自己的原文(第 2/3 次复习的"难度匹配原文"), 无原文时由主进程兜底最近文章
    let sourceArticle = reviewArticle.value || null
    if (!sourceArticle) {
      const w0 = words.find((w) => w.source_article_id)
      if (w0) {
        try { sourceArticle = await window.api.articles.get(w0.source_article_id) } catch { sourceArticle = null }
      }
    }
    const res = await window.api.review.generateStory(
      plain({
        words,
        sourceArticle,
        force // 手动重新生成: 绕过 7 天缓存强制重推理
      })
    )
    reviewStoryText.value = res.content
    reviewStoryTitle.value = res.title || ''
    // 记录本组 AI 复习的词: 只记实际写进故事的那批(主进程按 batchSize 截断 + 词形覆盖校验),
    // 之前把全部无来源词都算"已读", 超出批量/被 AI 遗漏的词会被白白记一次"认识"
    currentReviewWords.value = res.words || words
    if (res.cached) {
      toast('已复用上次生成的故事(7 天内不重复生成)', 'info')
    }
    if (res.missing && res.missing.length) {
      toast(`${res.missing.length} 个词未被 AI 写入故事, 留待下轮复习`, 'info')
    }
    const s = await window.api.sessions.start({ type: 'review' })
    sessionId.value = s.id
    startTicking()
  } catch (e) {
    console.error('生成 AI 故事失败', e)
    await alert('生成 AI 故事失败', e.message + '\n请在 设置-日志 查看详情')
  } finally {
    reviewGenerating.value = false
  }
}

// 手动重新生成故事(对当前故事不满意时): 同一批词 force 绕缓存重推理
async function regenerateStory() {
  if (!lastStoryRequest.value.length || reviewGenerating.value) return
  const ok = await confirm(
    '重新生成故事',
    '将重新调用 AI 生成一篇新故事并替换当前故事(已完成的单词判定不受影响)。'
  )
  if (!ok) return
  await startAiReview(lastStoryRequest.value, { force: true })
}

const processedReviewWords = new Set()
const pendingSubmits = []

function onWordResult({ wordId, result }) {
  if (processedReviewWords.has(wordId)) return
  processedReviewWords.add(wordId)
  reviewResults.value.push({ wordId, result })
  // 记录 promise, 回列表前统一等待; 提交失败会留待下轮复习而不是静默丢失
  pendingSubmits.push(
    window.api.review
      .submitWordResult({ wordId, result, sessionType: 'review' })
      .catch((e) => console.error('复习结果提交失败', wordId, e))
  )
}

// 熟词卡片完成 → 展示完成统计约 1.2 秒 → 刷新待复习
// (此前立即关闭, 完成页统计一闪而过, 用户实际看不到)
async function finishReviewCards() {
  await new Promise((r) => setTimeout(r, 1200))
  showReviewCards.value = false
  reviewWordsForArticle.value = []
  await backToReviewList(true)
}

// 一键把今天到期词全部顺延到明天(今天实在没空 / 网络故障时的逃生阀)
async function postponeAll() {
  if (!reviewMeta.value || !reviewMeta.value.total) return
  const ok = await confirm(
    '全部顺延',
    `把今天到期的 ${reviewMeta.value.total} 个词全部顺延到明天?\n\n适合"今天实在没空"或"网络故障无法生成 AI 故事"的情况。间隔不会被打乱, 只是推迟一天。`
  )
  if (!ok) return
  try {
    const res = await window.api.review.postponeAll()
    toast(`已顺延 ${res.postponed} 个词到明天`, 'info')
    await reloadReviewState()
  } catch (e) {
    console.error('顺延失败', e)
    toast('顺延失败: ' + (e.message || String(e)), 'error')
  }
}

async function exitReview() {
  await stopTickingAndEndSession()
  clearSentence()
  mode.value = 'input'
  reviewMode.value = false
  reviewState.value = null
  reviewArticle.value = null
  reviewStoryText.value = ''
  reviewStoryTitle.value = ''
  lastStoryRequest.value = []
  reviewWordsForArticle.value = []
  currentReviewWords.value = []
  showReviewCards.value = false
  markedPool.value = []
}

onBeforeUnmount(() => {
  saveReadingState()
  stopTickingAndEndSession()
})
</script>

<template>
  <div class="ca-page reading-page">
    <div class="ca-page-header">
      <div>
        <h1 class="ca-page-title">阅读 / 复习</h1>
        <p class="ca-page-desc">输入短文 → 阅读标记生词 → 按艾宾浩斯曲线复习</p>
      </div>
      <div class="flex header-actions">
        <div class="mode-switch">
          <button class="mode-btn" :class="{ active: mode === 'input' }" @click="switchToInput">输入</button>
          <button class="mode-btn" :class="{ active: mode === 'reading' }" @click="startReading" :disabled="!text.trim()">阅读</button>
          <button class="mode-btn" :class="{ active: mode === 'review' }" @click="startReview">复习</button>
        </div>
        <button class="adhd-toggle" :class="['mode-' + adhdModeKey, { on: adhdOn }]" @click="toggleAdhd" v-tip="adhdTip" :aria-label="adhdTip" :aria-pressed="adhdOn">
          <span class="adhd-dot"></span> ADHD · {{ adhdModeLabel }}
        </button>
      </div>
    </div>

    <!-- 输入模式 -->
    <div v-if="mode === 'input'" class="input-workspace ca-workspace">
      <div class="input-tools">
        <input v-model="title" class="ca-input title-input" placeholder="标题(可选, 留空自动取首句)" />
        <span class="word-count">{{ text.trim() ? text.trim().split(/\s+/).length : 0 }} 词</span>
      </div>
      <textarea
        v-model="text"
        class="story-input"
        placeholder="在这里输入或粘贴英语短文 / 文段…&#10;粘贴后点击「开始阅读」自动清理格式并进入阅读模式"
      ></textarea>
      <div class="input-actions">
        <button class="ca-btn ca-btn--primary" @click="startReading" :disabled="!text.trim()">
          开始阅读 →
        </button>
      </div>
    </div>

    <!-- 阅读模式 -->
    <div v-else-if="mode === 'reading'" class="reading-workspace ca-workspace">
      <div class="reading-toolbar">
        <span class="reading-title">{{ title || '当前文章' }}</span>
        <span class="reading-time">⏱ {{ Math.floor(elapsed / 60) }}:{{ String(elapsed % 60).padStart(2, '0') }}</span>
        <span class="marked-pill" v-if="markedPool.length">{{ markedPool.length }} 词已标记</span>
        <button class="ca-btn ca-btn--primary" @click="endReading">结束阅读</button>
      </div>
      <div class="reading-split">
        <div class="reading-content">
          <ReadingText
            :text="text"
            :review-mode="false"
            :selected-sentence="selectedSentence"
            @word-marked="onWordMarked"
            @word-unmarked="onWordUnmarked"
            @sentence-click="onSentenceClick"
          />
        </div>
      </div>
      <div class="reading-foot">
        <span v-if="markedPool.length" class="marked-count">已标记 {{ markedPool.length }} 个生词 · 已实时写入词库</span>
        <span v-else class="muted">划选单词 → 点击荧光笔标记</span>
      </div>
    </div>

    <!-- 复习模式 -->
    <div v-else-if="mode === 'review'" class="review-workspace ca-workspace">
      <div class="reading-toolbar">
        <span class="reading-title">今日复习</span>
        <button class="ca-btn" @click="exitReview">退出复习</button>
      </div>

      <div v-if="reviewGenerating" class="ca-empty" style="padding:80px">
        <div class="spinner"></div>
        <div style="margin-top:12px">AI 正在生成故事…</div>
      </div>

      <!-- 原文复习 -->
      <template v-else-if="reviewState && !reviewArticle && !reviewStoryText">
        <div v-if="reviewMeta" class="review-meta-line">
          <span>
            今日到期 <b>{{ reviewMeta.total }}</b> 词
            <template v-if="reviewMeta.limit > 0 && reviewMeta.shown < reviewMeta.total">
              · 每日上限 {{ reviewMeta.limit }} 词, 超出部分明日继续
            </template>
            <template v-if="reviewMeta.maxOverdueDays >= 7">
              · 有词已逾期 {{ reviewMeta.maxOverdueDays }} 天, 别慌, 从最旧的开始就好
            </template>
          </span>
          <button class="ca-btn small postpone-btn" @click="postponeAll">全部顺延到明天</button>
        </div>
        <div v-if="reviewState.groups.length" class="review-groups">
          <div class="review-section-title">按原文复习今日到期词</div>
          <div v-for="g in reviewState.groups" :key="g.aid" class="review-group ca-card">
            <div class="review-group-head">
              <span v-tip="g.title || ''">
                {{ g.title ? shortTitle(g.title) : '文章 #' + g.aid }} · {{ (g.read || []).length }} 个词待读
              </span>
              <div class="flex">
                <button v-if="g.fluent && g.fluent.length" class="ca-btn" @click="reviewWordsForArticle = g.fluent; showReviewCards = true">
                  熟词确认 ({{ g.fluent.length }})
                </button>
                <button class="ca-btn ca-btn--primary" @click="openReviewArticle(g.aid)" :disabled="!(g.read && g.read.length)">
                  打开原文复习
                </button>
              </div>
            </div>
            <div class="review-group-words" v-if="g.read && g.read.length">
              <span v-for="w in g.read" :key="w.id" class="word-chip">{{ w.lemma }}</span>
            </div>
            <div class="review-group-fluent" v-if="g.fluent && g.fluent.length">
              <span class="fluent-label">熟词待确认:</span>
              <span v-for="w in g.fluent" :key="w.id" class="word-chip fluent">{{ w.lemma }}</span>
            </div>
          </div>
        </div>

        <div v-if="reviewState.story && reviewState.story.length" class="review-groups">
          <div class="review-group ca-card">
            <div class="review-group-head">
              <span>第 2/3 次复习 → AI 故事 · {{ reviewState.story.length }} 个词(难度匹配各自原文)</span>
              <div class="flex">
                <button class="ca-btn" @click="useOriginalForStoryWords">改用原文复习</button>
                <button class="ca-btn ca-btn--primary" @click="startAiReview(reviewState.story)" :disabled="reviewGenerating">
                  {{ reviewGenerating ? '生成中…' : '生成 AI 故事' }}
                </button>
              </div>
            </div>
            <div class="review-group-words">
              <span v-for="w in reviewState.story" :key="w.id" class="word-chip">{{ w.lemma }}</span>
            </div>
          </div>
        </div>

        <div v-if="reviewState.noSource" class="review-groups">
          <div v-if="reviewState.noSource.read.length" class="review-group ca-card">
            <div class="review-group-head">
              <span>无来源词 → AI 故事复习 · {{ reviewState.noSource.read.length }} 个词</span>
              <button class="ca-btn ca-btn--primary" @click="startAiReview(reviewState.noSource.read)" :disabled="reviewGenerating">
                {{ reviewGenerating ? '生成中…' : '生成 AI 故事' }}
              </button>
            </div>
            <div class="review-group-words">
              <span v-for="w in reviewState.noSource.read" :key="w.id" class="word-chip">{{ w.lemma }}</span>
            </div>
          </div>
          <div v-if="reviewState.noSource.fluent.length" class="review-group ca-card">
            <div class="review-group-head">
              <span>熟词复习 · {{ reviewState.noSource.fluent.length }} 个词</span>
              <button class="ca-btn" @click="reviewWordsForArticle = reviewState.noSource.fluent; showReviewCards = true">逐词确认</button>
            </div>
            <div class="review-group-words">
              <span v-for="w in reviewState.noSource.fluent" :key="w.id" class="word-chip fluent">{{ w.lemma }}</span>
            </div>
          </div>
        </div>

        <div v-if="!reviewState.groups.length && !(reviewState.story && reviewState.story.length) && !reviewState.noSource.read.length && !reviewState.noSource.fluent.length" class="ca-empty">今日没有到期词, 去读一篇新文章吧</div>
      </template>

      <!-- 打开原文复习 (纯阅读) -->
      <template v-else-if="reviewArticle && !reviewStoryText">
        <div class="reading-toolbar sub">
          <span class="reading-title">{{ reviewArticle.title }}</span>
          <span class="reading-time">⏱ {{ Math.floor(elapsed / 60) }}:{{ String(elapsed % 60).padStart(2, '0') }}</span>
          <button class="ca-btn ca-btn--primary" @click="finishPureReading()">
            复习完成
          </button>
          <button class="ca-btn" @click="backToReviewList()">返回列表</button>
        </div>
        <div class="reading-split">
          <div class="reading-content">
            <ReadingText
              :text="reviewArticle.cleaned_content || reviewArticle.content"
              :review-mode="true"
              :review-words="currentReviewWords"
              :selected-sentence="selectedSentence"
              @word-marked="onWordMarked"
              @word-unmarked="onWordUnmarked"
              @word-result="onInlineWordResult"
              @sentence-click="onSentenceClick"
            />
          </div>
        </div>
        <div class="reading-foot">
          <span class="muted">高亮词 = 今日到期词 · 点击判定 认识/模糊/不认识 · 也可划选标记认不出的词 · 读完点「复习完成」</span>
        </div>
      </template>

      <!-- AI 故事复习 (纯阅读) -->
      <template v-else-if="reviewStoryText">
        <div class="reading-toolbar sub">
          <span class="reading-title">{{ reviewStoryTitle || 'AI 复习故事' }}</span>
          <span class="reading-time">⏱ {{ Math.floor(elapsed / 60) }}:{{ String(elapsed % 60).padStart(2, '0') }}</span>
          <button class="ca-btn" @click="regenerateStory" :disabled="reviewGenerating">
            {{ reviewGenerating ? '生成中…' : '重新生成' }}
          </button>
          <button class="ca-btn ca-btn--primary" @click="finishPureReading()">复习完成</button>
          <button class="ca-btn" @click="backToReviewList()">返回列表</button>
        </div>
        <div class="reading-split">
          <div class="reading-content">
            <ReadingText
              :text="reviewStoryText"
              :review-mode="true"
              :review-words="currentReviewWords"
              :selected-sentence="selectedSentence"
              @word-marked="onWordMarked"
              @word-unmarked="onWordUnmarked"
              @word-result="onInlineWordResult"
              @sentence-click="onSentenceClick"
            />
          </div>
        </div>
        <div class="reading-foot">
          <span class="muted">高亮词 = 本故事目标词 · 点击判定 认识/模糊/不认识 · 认不出的词照常划选标记 · 读完点「复习完成」</span>
        </div>
      </template>
    </div>

    <!-- 完成总结 -->
    <div v-if="showSummary" class="summary-overlay" @click.self="showSummary = false">
      <div class="summary-card ca-card">
        <h3>本次阅读完成</h3>
        <div class="summary-stats">
          <div>阅读用时: <strong>{{ Math.floor(elapsed / 60) }} 分 {{ elapsed % 60 }} 秒</strong></div>
          <div>标记生词: <strong>{{ markedPool.length }} 个</strong></div>
        </div>
        <div v-if="markedPool.length" class="summary-words">
          <span v-for="w in markedPool" :key="w.word" class="word-chip">{{ w.word }}</span>
        </div>
        <div class="flex mt-4" style="justify-content:flex-end">
          <button class="ca-btn ca-btn--primary" @click="finishSession">完成</button>
        </div>
      </div>
    </div>

    <!-- 复习逐词确认卡片 -->
    <div v-if="showReviewCards" class="summary-overlay">
      <div class="review-cards-overlay ca-card">
        <div class="overlay-head">
          <span>逐词确认</span>
          <button class="op-btn" @click="showReviewCards = false">✕</button>
        </div>
        <ReviewCards
          :words="reviewWordsForArticle"
          @result="onWordResult"
          @done="finishReviewCards"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.reading-page { max-width: 1000px; margin: 0 auto; }
.header-actions { gap: 10px; }

.mode-switch { display: flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--ca-surface-subtle); border: 1px solid var(--ca-line); }
.mode-btn { height: 28px; padding: 0 14px; border: none; border-radius: 8px; background: transparent; font-size: 13px; font-weight: 600; color: var(--ca-ink-3); cursor: pointer; transition: all var(--ca-duration-fast) var(--ca-ease); }
.mode-btn.active { background: var(--ca-surface); color: var(--ca-primary); box-shadow: var(--ca-shadow-card); }
.mode-btn:disabled { cursor: not-allowed; opacity: 0.4; }

.adhd-toggle { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border: 1px solid var(--ca-line); border-radius: 8px; background: var(--ca-surface); font-size: 12px; font-weight: 600; cursor: pointer; transition: all var(--ca-duration-fast) var(--ca-ease); }
.adhd-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ca-ink-3); transition: background var(--ca-duration-fast) var(--ca-ease); }
.adhd-toggle.on { color: var(--ca-primary); border-color: var(--ca-primary-border); }
.adhd-toggle.on .adhd-dot { background: var(--ca-primary); box-shadow: 0 0 0 3px var(--ca-primary-soft); }

.input-workspace, .reading-workspace, .review-workspace {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 180px);
  overflow: hidden;
  margin-bottom: 40px;
}

.input-tools { display: flex; align-items: center; gap: 12px; padding: 16px 20px; border-bottom: 1px solid var(--ca-line); }
.title-input { flex: 1; max-width: 400px; }
.word-count { font-size: 12px; color: var(--ca-ink-3); }

.story-input {
  flex: 1;
  min-height: 380px;
  border: none;
  outline: none;
  padding: 24px 28px;
  font-size: 16px;
  line-height: 1.9;
  resize: none;
  background: var(--ca-surface);
  color: var(--ca-ink);
}
.story-input::placeholder { color: var(--ca-ink-3); }

.input-actions { padding: 16px 20px; display: flex; justify-content: flex-end; border-top: 1px solid var(--ca-line); }

.reading-toolbar { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--ca-line); }
.reading-toolbar.sub { border-top: 1px solid var(--ca-line); }
.reading-title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reading-time { font-variant-numeric: tabular-nums; color: var(--ca-ink-3); font-size: 13px; }
.marked-pill { padding: 2px 10px; border-radius: 999px; background: var(--ca-warning-soft); color: var(--ca-warning-ink); font-size: 12px; font-weight: 600; }

.reading-content { flex: 1; padding: 32px 48px; overflow-y: auto; max-height: calc(100vh - 300px); }
.reading-split { display: flex; gap: 14px; align-items: stretch; flex: 1; min-height: 0; }
.reading-split .reading-content { flex: 1; min-width: 0; }
@media (max-width: 1100px) {
  .reading-split { flex-direction: column; }
}

.reading-foot { padding: 10px 20px; border-top: 1px solid var(--ca-line); font-size: 12px; }
.marked-count { color: #92400e; font-weight: 600; }

.review-groups { padding: 24px; display: flex; flex-direction: column; gap: 16px; }
.review-meta-line { padding: 14px 24px 0; font-size: 13px; color: var(--ca-ink-2); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.review-meta-line b { color: var(--ca-warning-ink); font-size: 15px; }
.postpone-btn { height: 26px; padding: 0 10px; font-size: 12px; }
.review-section-title { font-size: 14px; font-weight: 700; }
.review-group { padding: 14px 16px; }
.review-group-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 13px; }
.review-group-words { display: flex; flex-wrap: wrap; gap: 6px; }

.word-chip { padding: 3px 10px; border-radius: 999px; background: var(--ca-primary-soft); color: var(--ca-primary); font-size: 12px; font-weight: 600; }
.word-chip.fluent { background: var(--ca-success-soft); color: var(--ca-success-ink); }
.review-group-fluent { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.fluent-label { font-size: 12px; color: var(--ca-ink-3); }

.spinner {
  width: 32px; height: 32px;
  margin: 0 auto;
  border: 3px solid var(--ca-line);
  border-top-color: var(--ca-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.summary-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(11, 18, 32, 0.4); display: grid; place-items: center; }
.summary-card { width: 420px; max-width: 90vw; padding: 24px; box-shadow: var(--ca-shadow-float); }
.summary-card h3 { margin: 0 0 16px; font-size: 18px; }
.summary-stats { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; font-size: 14px; }
.summary-words { display: flex; flex-wrap: wrap; gap: 6px; }

.review-cards-overlay { width: 520px; max-width: 92vw; box-shadow: var(--ca-shadow-float); overflow: hidden; }
.overlay-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--ca-line); font-weight: 700; font-size: 15px; }
.op-btn { width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--ca-ink-3); cursor: pointer; }
.op-btn:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }
</style>
