<script setup>
import { ref, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import StructurePanel from './StructurePanel.vue'
import MarkdownText from './MarkdownText.vue'
import GrammarTermPopup from './GrammarTermPopup.vue'
import { toast } from '../lib/toast'
import { store } from '../store'
import { termLabel, leafForTermKey } from '../lib/grammarTermMap'

const props = defineProps({
  sentence: { type: Object, default: null }, // {index, text, start, end}
  articleId: { type: Number, default: null },
  article: { type: Object, default: null }, // 全文模式上下文 { title, text, articleId }
  collapsed: { type: Boolean, default: false } // 工作区收起态(由 App 控制)
})
const emit = defineEmits(['close', 'toggleCollapse'])

const router = useRouter()
const hash = ref('')
const question = ref('')
const wsStreamEl = ref(null)
// 流式回答当前落点(线程内某条 pending 的问答项下标)
const streamIdx = ref(-1)

const blocks = reactive({
  translate: { status: 'idle', text: '', cached: false, error: '' },
  structure: { status: 'idle', data: null, cached: false, error: '' },
  chat: { items: [], pending: false, followups: [] },
  quiz: { status: 'idle', data: null, cached: false, error: '' }
})

// 提问模板(槽位化: 用当前句缓存的结构/时态/从句填真实语法点, 无缓存退回静态文案)
const TEMPLATES = [
  { key: 'explain', label: '解释句子结构' },
  { key: 'example', label: '给出同类型例句' },
  { key: 'tense', label: '为什么用这个时态' },
  { key: 'clause', label: '拆解每个从句' },
  { key: 'simple', label: '用简单英语改写' }
]
const templateCtx = computed(() => ({
  structure: blocks.structure,
  translation: blocks.translate,
  quiz: blocks.quiz
}))
function buildTenseSlot(ctx) {
  const tense = ctx?.structure?.data?.segments?.[0]?.tense
  if (tense && String(tense) !== '-') return '为什么用' + tense
  return ''
}
function buildClauseSlot(ctx) {
  const segs = ctx?.structure?.data?.segments || []
  const types = [...new Set(segs.map((s) => s.type).filter((t) => t && String(t).includes('从句')))]
  if (types.length) return '拆解' + types.join('和')
  return ''
}
function templateText(tpl) {
  if (tpl.key === 'tense') return buildTenseSlot(templateCtx.value) || tpl.label
  if (tpl.key === 'clause') return buildClauseSlot(templateCtx.value) || tpl.label
  return tpl.label
}
function sendTemplate(tpl) {
  ask(templateText(tpl))
}

const STATUS_LABEL = { idle: '', running: '分析中', done: '完成', error: '失败' }

// ---------- 任务进度订阅(仅用于按钮排队态提示; 统一 OpenAI 兼容接口后不再有本地模型加载等待) ----------
const taskPhase = reactive({ translate: '', structure: '', quiz: '' })
let offProgressCb = null
function onProgress(p) {
  if (!p || !p.kind) return
  const key = p.kind === 'analyze' ? 'structure' : p.kind
  if (key === 'translate' || key === 'structure' || key === 'quiz') taskPhase[key] = p.phase || ''
}

// ---------- 单任务队列按钮态 / 错误态[去设置] ----------
const anyTaskRunning = computed(() =>
  blocks.translate.status === 'running' ||
  blocks.structure.status === 'running' ||
  blocks.quiz.status === 'running'
)
function actionBtn(task) {
  const running = task === 'translate'
    ? blocks.translate.status === 'running'
    : blocks.structure.status === 'running'
  // 新任务自动排队(PLAN 4.3): 仅禁用自身运行中的按钮; 其他任务运行时点本按钮 = 入队, 显示「排队中…」
  const label = running
    ? (task === 'translate' ? '翻译中…' : '解析中…')
    : anyTaskRunning.value ? '排队中…' : (task === 'translate' ? '翻译' : '完整解析')
  return { label, disabled: running }
}
/** 配置类错误(未填 Key/地址/模型, 或鉴权失败): 给出「去设置」入口 */
function errorNeedsSettings(msg) {
  return /未配置|API Key|接口地址|模型|401|403|Unauthorized|Forbidden/i.test(String(msg || ''))
}
const openSettings = () => { try { router.push('/settings') } catch { /* 忽略 */ } }

// ---------- 结果块自动滚底(仅当用户已在底部) ----------
function maybeScrollBottom() {
  const el = wsStreamEl.value
  if (!el) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) el.scrollTop = el.scrollHeight
}
// 显式任务(翻译/解析/提问测试)触发后强制滚到底: 用户主动点了按钮, 新块(加载态/结果)必须可见。
// 流式问答仍走上面的「仅当已在底部才自动滚」策略, 不受影响。
function revealStream() {
  const el = wsStreamEl.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

// 句子切换: 只重置「按句」结果块(翻译/解析/题组); 会话线程属于整篇文章, 切句不清空、不打断
function resetTaskBlocks() {
  blocks.translate = { status: 'idle', text: '', cached: false, error: '' }
  blocks.structure = { status: 'idle', data: null, cached: false, error: '' }
  blocks.quiz = { status: 'idle', data: null, cached: false, error: '' }
}

function clearChat() {
  blocks.chat.items = []
  blocks.chat.followups = []
  blocks.chat.pending = false
  streamIdx.value = -1
  question.value = ''
}

/** 用户主动取消(取消按钮/退出)不是故障: 回到 idle 而不是显示红色错误块 */
function isTaskCancelled(e) {
  return /任务已取消/.test(String(e?.message || e || ''))
}

/** 按句缓存(翻译/解析/题组): 与文章会话线程分离, 切句时重新填充 */
async function loadSentenceCached() {
  const t = props.sentence?.text
  if (!t) return
  try {
    hash.value = await window.api.sentence.hash(t)
    const c = await window.api.sentence.cached(hash.value)
    if (props.sentence?.text !== t) return // 期间已切句: 丢弃过期缓存
    if (c?.translation) blocks.translate = { status: 'done', text: c.translation, cached: true, error: '' }
    if (c?.structure) blocks.structure = { status: 'done', data: c.structure, cached: true, error: '' }
    if (c?.quiz?.items?.length) blocks.quiz = { status: 'done', data: c.quiz, cached: true, error: '' }
  } catch (e) {
    console.error('句子缓存读取失败', e)
  }
}

watch(
  () => props.sentence?.text,
  (v) => {
    resetTaskBlocks()
    if (v) loadSentenceCached()
  },
  { immediate: true }
)

// ---------- 按文章的 AI 会话线程 ----------
// 一篇文章 = 一个会话线程(不按句子切窗口): 所有句子的提问按时间累积, 切句/切页不丢可见历史;
// 主进程按 threadKey 持久化, 提问 prompt 前缀(system+文章)固定 → 云端上下文/本地 KV 缓存可复用。
/** 句子/文章标题截断(问答项上方的归属标记用) */
function shortSentence(t, max = 44) {
  const s = String(t || '').trim()
  return s.length > max ? s.slice(0, max) + '…' : s
}
/** 文章上下文串(与主进程 articleContextString 逐字一致, 也是旧版全文会话的缓存 key) */
function articleContext() {
  if (!props.article?.text) return ''
  return `标题: ${props.article.title || '未命名文章'}\n\n${props.article.text}`
}
const threadKey = ref(null)
let threadSeq = 0
async function loadThread() {
  const seq = ++threadSeq
  clearChat()
  const a = props.article
  if (!a || !a.text) { threadKey.value = null; return }
  let key = a.articleId ? `a:${a.articleId}` : null
  if (!key) {
    try { key = `t:${await window.api.sentence.hash(articleContext())}` } catch { key = null }
  }
  if (seq !== threadSeq) return // 期间又切了文章
  threadKey.value = key
  if (!key) return
  try {
    const r = await window.api.sentence.threadGet({ threadKey: key, articleTitle: a.title || '', articleText: a.text })
    if (seq !== threadSeq || threadKey.value !== key) return
    blocks.chat.items = (r?.items || []).map((h) => ({
      q: h.q, a: h.a || '', sentence: h.sentence || null, ts: h.ts || null, pending: false
    }))
    nextTick(revealStream)
  } catch (e) {
    console.error('会话线程读取失败', e)
  }
}
watch(() => [props.article?.articleId, props.article?.title, props.article?.text], loadThread, { immediate: true })

async function runTranslate(force = false) {
  if (!props.sentence || blocks.translate.status === 'running') return
  const startedSentence = props.sentence.text
  blocks.translate = { status: 'running', text: '', cached: false, error: '' }
  nextTick(revealStream)
  try {
    const r = await window.api.sentence.translate({ sentence: props.sentence.text, articleId: props.articleId ?? null, force })
    if (startedSentence !== props.sentence?.text) return // 已切换句子: 丢弃过期结果
    blocks.translate = { status: 'done', text: r.translation, cached: !!r.cached, error: '' }
    nextTick(revealStream)
    if (force) toast('翻译已重新生成', 'info')
  } catch (e) {
    if (startedSentence !== props.sentence?.text) return
    if (isTaskCancelled(e)) { blocks.translate = { status: 'idle', text: '', cached: false, error: '' }; return }
    blocks.translate = { status: 'error', text: '', cached: false, error: e.message || String(e) }
    nextTick(revealStream)
  }
}

async function runAnalyze(force = false) {
  if (!props.sentence || blocks.structure.status === 'running') return
  const startedSentence = props.sentence.text
  blocks.structure = { status: 'running', data: null, cached: false, error: '' }
  nextTick(revealStream)
  try {
    const r = await window.api.sentence.analyze({ sentence: props.sentence.text, articleId: props.articleId ?? null, force })
    if (startedSentence !== props.sentence?.text) return // 已切换句子: 丢弃过期结果
    blocks.structure = { status: 'done', data: r, cached: !!r.cached, error: '' }
    nextTick(revealStream)
    if (r.followups?.length) blocks.chat.followups = r.followups
    if (force) toast('解析已重新生成', 'info')
  } catch (e) {
    if (startedSentence !== props.sentence?.text) return
    if (isTaskCancelled(e)) { blocks.structure = { status: 'idle', data: null, cached: false, error: '' }; return }
    blocks.structure = { status: 'error', data: null, cached: false, error: e.message || String(e) }
    nextTick(revealStream)
  }
}

async function ask(q) {
  const text = String(q || question.value || '').trim()
  if (!text || blocks.chat.pending) return
  if (!threadKey.value) {
    // 无文章上下文(如复习列表): 提示而不是静默失败
    toast('请先打开一篇文章', 'info')
    return
  }
  const reqThread = threadKey.value
  const reqSentence = props.sentence?.text || null
  blocks.chat.pending = true
  blocks.chat.followups = []
  // 线程内追加一条问答(带句子归属): 切句/切文章后仍然可见/可恢复
  const item = { q: text, a: '', sentence: reqSentence, ts: null, pending: true }
  blocks.chat.items.push(item)
  streamIdx.value = blocks.chat.items.length - 1
  nextTick(revealStream)
  try {
    const r = await window.api.sentence.askStream({
      threadKey: reqThread,
      articleTitle: props.article?.title || '',
      articleText: props.article?.text || '',
      sentence: reqSentence,
      question: text
    })
    if (threadKey.value !== reqThread) return // 已切文章: 主进程已持久化, 切回时重新加载显示
    item.a = r.answer
    item.ts = r.item?.ts || null
    item.pending = false
    blocks.chat.followups = r.followups || []
  } catch (e) {
    if (threadKey.value === reqThread) {
      item.a = '提问失败: ' + (e.message || String(e))
      item.pending = false
    }
  } finally {
    if (threadKey.value === reqThread) {
      blocks.chat.pending = false
      question.value = ''
      streamIdx.value = -1
    }
  }
}

// 流式增量: 只追加到当前文章线程的 pending 项(切到别的文章后旧增量直接忽略)
function onAskDelta(p) {
  if (p?.threadKey && p.threadKey !== threadKey.value) return
  if (streamIdx.value < 0) return
  const item = blocks.chat.items[streamIdx.value]
  if (item && item.pending && p?.delta) item.a += p.delta
}
let offAskDelta = null
// 结果块挂载后: 仅当用户已在滚动底部才自动滚底(避免打断历史阅读)
watch(
  () => [blocks.translate.status, blocks.structure.status, blocks.quiz.status, blocks.chat.items.length],
  () => nextTick(maybeScrollBottom)
)
onMounted(() => {
  try { offAskDelta = window.api.sentence.onAskDelta(onAskDelta) } catch { /* 兼容: 无流式通道时忽略 */ }
  try { offProgressCb = window.api.sentence?.onProgress?.(onProgress) } catch { /* 兼容 */ }
})
onBeforeUnmount(() => {
  try { offAskDelta?.() } catch { /* 忽略 */ }
  try { offProgressCb?.() } catch { /* 忽略 */ }
})

async function cancelTask() {
  try { await window.api.sentence.cancel() } catch { /* 忽略 */ }
}

// ---------- 提问测试 ----------
const judgeMode = computed(() => store.settings?.quiz?.judgeMode || 'immediate')

async function runQuiz(force = false) {
  if (!props.sentence || blocks.quiz.status === 'running') return
  const startedSentence = props.sentence.text
  blocks.quiz = { status: 'running', data: null, cached: false, error: '' }
  nextTick(revealStream)
  try {
    const r = await window.api.sentence.quiz({ sentence: props.sentence.text, articleId: props.articleId ?? null, force })
    if (startedSentence !== props.sentence?.text) return // 已切换句子: 丢弃过期结果
    blocks.quiz = { status: 'done', data: r.quiz, cached: !!r.cached, error: '' }
    nextTick(revealStream)
    if (force) toast('已生成新题组', 'info')
  } catch (e) {
    if (startedSentence !== props.sentence?.text) return
    if (isTaskCancelled(e)) { blocks.quiz = { status: 'idle', data: null, cached: false, error: '' }; return }
    blocks.quiz = { status: 'error', data: null, cached: false, error: e.message || String(e) }
    nextTick(revealStream)
  }
}

function quizAnswered(qi) {
  return blocks.quiz.data?.answers?.[qi] != null
}
function quizLocked(qi) {
  const d = blocks.quiz.data
  if (!d) return true
  if (judgeMode.value === 'afterAll') return !!d.finished
  return quizAnswered(qi)
}
function quizRevealed(qi) {
  const d = blocks.quiz.data
  if (!d) return false
  if (judgeMode.value === 'afterAll') return !!d.finished
  return quizAnswered(qi)
}
function quizCorrect(qi) {
  const d = blocks.quiz.data
  return quizAnswered(qi) && d.answers[qi] === d.items[qi].answer
}
function quizOptClass(qi, oi) {
  const d = blocks.quiz.data
  if (!quizRevealed(qi)) return []
  const cls = []
  if (oi === d.items[qi].answer) cls.push('correct')
  if (quizAnswered(qi) && oi === d.answers[qi] && oi !== d.items[qi].answer) cls.push('wrong')
  return cls
}
const quizScore = computed(() => {
  const d = blocks.quiz.data
  if (!d?.items?.length) return { correct: 0, total: 0 }
  let correct = 0
  d.items.forEach((it, i) => {
    if (d.answers?.[i] === it.answer) correct++
  })
  return { correct, total: d.items.length }
})
const quizWrongTerms = computed(() => {
  const d = blocks.quiz.data
  if (!d?.items) return []
  return d.items
    .map((it, i) => ({ qi: i, label: it.grammarLabel || termLabel(it.grammar || ''), key: it.grammar }))
    .filter((t) => (t.key || t.label) && quizAnswered(t.qi) && d.answers[t.qi] !== d.items[t.qi].answer)
})
let quizSubmitSeq = 0
async function persistQuiz(answers, finished) {
  const seq = ++quizSubmitSeq
  try {
    const r = await window.api.sentence.quizSubmit({ hash: hash.value, answers, finished })
    if (seq !== quizSubmitSeq) return // 过期响应: 忽略, 防止旧快照回退本地作答
    if (r?.ok && r.quiz) blocks.quiz.data = r.quiz
  } catch (e) {
    if (seq !== quizSubmitSeq) return
    toast('作答保存失败: ' + (e.message || String(e)), 'error')
  }
}
async function pickOption(qi, oi) {
  const d = blocks.quiz.data
  if (!d || quizLocked(qi)) return
  const next = d.answers.slice()
  next[qi] = oi
  const finished = judgeMode.value === 'immediate' && next.every((a) => a != null)
  blocks.quiz.data = { ...d, answers: next, finished }
  await persistQuiz(next, finished)
}
async function submitQuiz() {
  const d = blocks.quiz.data
  if (!d) return
  if (d.answers.some((a) => a == null)) {
    toast('还有题目未作答', 'info')
    return
  }
  await persistQuiz(d.answers.slice(), true)
}
async function retryQuiz() {
  const d = blocks.quiz.data
  if (!d) return
  await persistQuiz(d.items.map(() => null), false)
}

// 术语气泡(复用 StructurePanel 的弹窗模式)
const termPopup = ref(null)
function quizLeafInfo(key) {
  const parts = String(key || '').split(':')
  if (parts[0] === 'leaf') return { category: parts[1] || '', sub: parts[2] || '', detail: parts[3] || '' }
  return leafForTermKey(key)
}
async function openQuizTerm(qi, anchorEl) {
  const item = blocks.quiz.data?.items?.[qi]
  const key = item?.grammar
  const label = item?.grammarLabel || (key ? termLabel(key) : null)
  if (!key && !label) return
  try {
    let data
    if (key) {
      data = await window.api.grammar.termExplain(key)
    } else {
      // 术语无法归一时保留原文标签: 气泡显示"暂无内置解释", 无深链
      data = { key: '', label, short: '', full: '', examples: [], source: 'none' }
    }
    const r = anchorEl?.getBoundingClientRect()
    termPopup.value = { key: key || '', data, leaf: key ? quizLeafInfo(key) : null, x: r ? r.left : 0, y: r ? r.bottom + 6 : 0 }
  } catch (e) {
    toast('术语解释加载失败: ' + (e.message || String(e)), 'error')
  }
}
</script>

<template>
  <div class="sentence-ws" :class="{ collapsed }">
    <div v-if="collapsed" class="ws-collapsed">
      <button class="ws-collapse-btn" @click="emit('toggleCollapse')" v-tip="'展开工作区'">▸</button>
    </div>
    <template v-else>
      <div class="ws-head">
        <span class="ws-title">AI 工作区</span>
        <button class="ws-mini" @click="emit('toggleCollapse')" v-tip="'收起工作区'">收起</button>
        <button class="ws-close" @click="emit('close')" v-tip="'取消选中'">✕</button>
      </div>

      <div v-if="!sentence" class="ws-empty">
        <template v-if="article && article.text">
          <div class="ws-article-mode">
            <div class="ws-article-label">全文模式</div>
            <div class="ws-article-title">{{ article.title || '未命名文章' }}</div>
            <div class="ws-article-hint">未选中句子 · 提问将把「标题 + 全文」作为上下文发送给 AI; 单击文章中的句子可切换单句解析。</div>
          </div>
        </template>
        <template v-else>单击文章中的句子开始解析；打开原文复习或生成 AI 故事后, 可直接对全文提问</template>
      </div>

      <template v-else>
        <div class="ws-sentence">{{ sentence.text }}</div>

        <div class="ws-actions">
          <button class="ws-btn" :disabled="actionBtn('translate').disabled" @click="runTranslate()">
            {{ actionBtn('translate').label }}
          </button>
          <button class="ws-btn primary" :disabled="actionBtn('structure').disabled" @click="runAnalyze()">
            {{ actionBtn('structure').label }}
          </button>
        </div>
      </template>

      <div ref="wsStreamEl" class="ws-stream">
        <!-- 翻译块 -->
        <div v-if="blocks.translate.status !== 'idle'" class="ws-block">
          <div class="ws-block-head">
            <span>翻译</span>
            <span class="ws-badge" :class="blocks.translate.status">{{ STATUS_LABEL[blocks.translate.status] }}</span>
            <span v-if="blocks.translate.cached" class="ws-badge cached">缓存</span>
            <button v-if="blocks.translate.status === 'done'" class="ws-mini" @click="runTranslate(true)" v-tip="'绕过缓存重新生成'">重跑</button>
          </div>
          <div v-if="blocks.translate.status === 'running'" class="ws-loading">
            {{ taskPhase.translate === 'retrying' ? '重试中…' : 'AI 分析中…' }}
            <button class="ws-mini" @click="cancelTask">取消</button>
          </div>
          <div v-else-if="blocks.translate.status === 'error'" class="ws-error">
            {{ blocks.translate.error }}
            <button class="ws-mini" @click="runTranslate()">重试</button>
            <button v-if="errorNeedsSettings(blocks.translate.error)" class="ws-mini" @click="openSettings">去设置</button>
          </div>
          <div v-else class="ws-trans"><MarkdownText :text="blocks.translate.text" /></div>
        </div>

        <!-- 结构块 -->
        <div v-if="blocks.structure.status !== 'idle'" class="ws-block">
          <div class="ws-block-head">
            <span>成分拆分</span>
            <span class="ws-badge" :class="blocks.structure.status">{{ STATUS_LABEL[blocks.structure.status] }}</span>
            <span v-if="blocks.structure.cached" class="ws-badge cached">缓存</span>
            <button v-if="blocks.structure.status === 'done'" class="ws-mini" @click="runAnalyze(true)" v-tip="'绕过缓存重新生成'">重跑</button>
          </div>
          <div v-if="blocks.structure.status === 'running'" class="ws-loading">
            {{ taskPhase.structure === 'retrying' ? '重试中…' : 'AI 分析中…' }}
            <button class="ws-mini" @click="cancelTask">取消</button>
          </div>
          <div v-else-if="blocks.structure.status === 'error'" class="ws-error">
            {{ blocks.structure.error }}
            <button class="ws-mini" @click="runAnalyze()">重试</button>
            <button v-if="errorNeedsSettings(blocks.structure.error)" class="ws-mini" @click="openSettings">去设置</button>
          </div>
          <template v-else-if="blocks.structure.data">
            <div v-if="blocks.structure.data.rawText" class="ws-trans"><MarkdownText :text="blocks.structure.data.rawText" /></div>
            <StructurePanel v-else :sentence="sentence.text" :structure="blocks.structure.data" />
          </template>
        </div>

        <!-- 提问测试块 -->
        <div v-if="blocks.quiz.status !== 'idle'" class="ws-block">
          <div class="ws-block-head">
            <span>提问测试</span>
            <span class="ws-badge" :class="blocks.quiz.status">{{ STATUS_LABEL[blocks.quiz.status] }}</span>
            <span v-if="blocks.quiz.status === 'done' && blocks.quiz.data" class="ws-badge">{{ blocks.quiz.data.items.length }} 题</span>
            <span v-if="blocks.quiz.cached" class="ws-badge cached">缓存</span>
            <button v-if="blocks.quiz.status === 'done'" class="ws-mini" @click="runQuiz(true)" v-tip="'重新生成一批题目'">换一批</button>
          </div>
          <div v-if="blocks.quiz.status === 'running'" class="ws-loading">
            {{ taskPhase.quiz === 'retrying' ? '重试中…' : 'AI 出题中…' }}
            <button class="ws-mini" @click="cancelTask">取消</button>
          </div>
          <div v-else-if="blocks.quiz.status === 'error'" class="ws-error">
            {{ blocks.quiz.error }}
            <button class="ws-mini" @click="runQuiz()">重试</button>
            <button v-if="errorNeedsSettings(blocks.quiz.error)" class="ws-mini" @click="openSettings">去设置</button>
          </div>
          <div v-else-if="blocks.quiz.data" class="quiz-list">
            <div v-for="(q, qi) in blocks.quiz.data.items" :key="'q' + qi" class="quiz-card">
              <div class="quiz-stem"><span class="quiz-qnum">{{ qi + 1 }}.</span><MarkdownText :text="q.stem" /></div>
              <button
                v-for="(opt, oi) in q.options"
                :key="'o' + oi"
                class="quiz-opt"
                :class="quizOptClass(qi, oi)"
                :disabled="quizLocked(qi)"
                @click="pickOption(qi, oi)"
              >
                <span class="quiz-opt-key">{{ 'ABCD'[oi] }}</span><span class="quiz-opt-text">{{ opt }}</span>
              </button>
              <div v-if="quizRevealed(qi)" class="quiz-explain">
                <div class="quiz-verdict" :class="quizCorrect(qi) ? 'ok' : 'bad'">{{ quizCorrect(qi) ? '✓ 回答正确' : '✗ 回答错误' }}</div>
                <MarkdownText :text="q.explain" />
                <div v-if="q.grammar || q.grammarLabel" class="quiz-term">
                  <span class="muted">考察点:</span>
                  <button class="quiz-term-btn" @click="openQuizTerm(qi, $event.currentTarget)">{{ q.grammarLabel || termLabel(q.grammar) }}</button>
                </div>
              </div>
            </div>
            <div v-if="judgeMode === 'afterAll' && !blocks.quiz.data.finished" class="quiz-submit-row">
              <button class="ws-btn primary" @click="submitQuiz">交卷</button>
            </div>
            <div v-if="blocks.quiz.data.finished" class="quiz-score">
              <div class="quiz-score-main">答对 {{ quizScore.correct }} / {{ quizScore.total }}</div>
              <div v-if="quizWrongTerms.length" class="quiz-score-terms">
                <span class="muted">薄弱点:</span>
                <button v-for="(t, i) in quizWrongTerms" :key="'w' + i" class="quiz-term-btn" @click="openQuizTerm(t.qi, $event.currentTarget)">{{ t.label }}</button>
              </div>
              <div class="quiz-score-actions">
                <button class="ws-mini" @click="retryQuiz">重新作答</button>
                <button class="ws-mini" @click="runQuiz(true)">换一批</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 问答线程: 整篇文章一个线程, 每条问答标注所属句子(切句不清空) -->
        <div v-if="blocks.chat.items.length" class="ws-thread-label">
          整篇文章会话{{ article?.title ? '《' + shortSentence(article.title, 24) + '》' : '' }} · {{ blocks.chat.items.length }} 条问答
        </div>
        <div v-for="(item, i) in blocks.chat.items" :key="'c' + i" class="ws-chat-item">
          <div v-if="item.sentence" class="ws-q-sentence" v-tip="item.sentence">↳ {{ shortSentence(item.sentence) }}</div>
          <div class="ws-q">你: {{ item.q }}</div>
          <div class="ws-a">
            <template v-if="item.pending"><span class="ws-loading-inline">思考中…</span></template>
            <MarkdownText v-else :text="item.a" />
          </div>
        </div>

        <!-- 智能追问(最多 2 条, 过长截断省略, 悬停看全文) -->
        <div v-if="blocks.chat.followups.length && !blocks.chat.pending" class="ws-followups">
          <button v-for="(f, i) in blocks.chat.followups.slice(0, 2)" :key="'f' + i" class="ws-chip follow" v-tip="f" @click="ask(f)">{{ f }}</button>
        </div>

        <!-- 加载中: 解答流尾部骨架块(shimmer) -->
        <div v-if="anyTaskRunning" class="ws-skeleton">
          <span class="ws-skeleton-line"></span>
          <span class="ws-skeleton-line short"></span>
        </div>
      </div>

      <div class="ws-templates">
        <button v-for="t in TEMPLATES" :key="t.key" class="ws-chip" @click="sendTemplate(t)">{{ templateText(t) }}</button>
        <button class="ws-chip quiz" :disabled="!sentence || blocks.quiz.status === 'running'" @click="runQuiz()" v-tip="sentence ? '' : '选中句子后可用'">
          {{ blocks.quiz.status === 'running' ? '出题中…' : anyTaskRunning ? '排队中…' : '提问测试' }}
        </button>
      </div>
      <div class="ws-input">
        <input v-model="question" :placeholder="threadKey ? '对这篇文章提问…' : '打开一篇文章后可提问'" @keyup.enter="ask()" :disabled="blocks.chat.pending || !threadKey" />
        <button class="ws-btn" :disabled="blocks.chat.pending || !threadKey || !question.trim()" @click="ask()">发送</button>
      </div>
    </template>

    <!-- 提问测试术语气泡(Teleport 到 body) -->
    <GrammarTermPopup
      v-if="termPopup"
      :label="termPopup.data.label || termPopup.key"
      :short="termPopup.data.short || ''"
      :example="termPopup.data.examples?.[0] || null"
      :live-text="''"
      :leaf="termPopup.leaf"
      :x="termPopup.x"
      :y="termPopup.y"
      @close="termPopup = null"
    />
  </div>
</template>

<style scoped>
.sentence-ws {
  width: 460px;
  flex: 0 0 460px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--ca-line);
  border-radius: var(--ca-radius-card);
  background: var(--ca-surface);
  overflow: hidden;
}
/* 收起态: 仅剩一条侧栏条(用户点「收起」后 App 缩小抽屉宽度) */
.sentence-ws.collapsed { border-radius: 0; }
.ws-collapsed {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ca-surface);
}
.ws-collapse-btn {
  width: 28px; height: 28px; border-radius: 8px; border: 1px solid var(--ca-line);
  background: var(--ca-surface); color: var(--ca-primary); cursor: pointer; font-size: 14px;
}
.ws-collapse-btn:hover { background: var(--ca-surface-subtle); }
.ws-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--ca-line);
}
.ws-title { font-size: 13px; font-weight: 700; }
.ws-close { width: 24px; height: 24px; border: none; border-radius: 6px; background: transparent; color: var(--ca-ink-3); cursor: pointer; }
.ws-close:hover { background: var(--ca-surface-subtle); }
.ws-empty { padding: 40px 16px; text-align: center; color: var(--ca-ink-3); font-size: 13px; }
/* 全文模式空态(初始自行展开时展示) */
.ws-article-mode { display: flex; flex-direction: column; gap: 8px; text-align: left; }
.ws-article-label { font-size: 11px; font-weight: 700; color: var(--ca-primary); letter-spacing: 0.04em; }
.ws-article-title { font-size: 14px; font-weight: 700; color: var(--ca-ink); line-height: 1.5; word-break: break-word; }
.ws-article-hint { font-size: 12px; color: var(--ca-ink-3); line-height: 1.7; }

.ws-sentence {
  padding: 12px 14px; font-size: 14px; line-height: 1.7; color: var(--ca-ink);
  border-bottom: 1px solid var(--ca-line); background: var(--ca-surface-subtle);
}
.ws-actions { display: flex; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--ca-line); }
.ws-btn {
  height: 30px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--ca-line);
  background: var(--ca-surface); color: var(--ca-ink-2); font-size: 13px; font-weight: 600; cursor: pointer;
}
.ws-btn:hover { background: var(--ca-surface-subtle); }
.ws-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-btn.primary { color: #fff; background-image: var(--ca-primary-gradient); border-color: var(--ca-primary-border); }

.ws-stream { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 14px; }
/* 结果块入场: 从下方滑入(仅入场, 复用 --ca-ease 缓动; 时长按规格 240ms) */
.ws-block {
  border: 1px solid var(--ca-line); border-radius: 10px; padding: 10px 12px;
  animation: ws-block-in 240ms var(--ca-ease);
}
@keyframes ws-block-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}
/* 加载骨架块(shimmer) */
.ws-skeleton {
  display: flex; flex-direction: column; gap: 8px;
  border: 1px solid var(--ca-line); border-radius: 10px; padding: 12px;
  background: var(--ca-surface-subtle);
}
.ws-skeleton-line {
  height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, var(--ca-surface-subtle) 25%, var(--ca-surface) 50%, var(--ca-surface-subtle) 75%);
  background-size: 200% 100%;
  animation: ws-shimmer 1.2s var(--ca-ease) infinite;
}
.ws-skeleton-line.short { width: 62%; }
@keyframes ws-shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.ws-block-head { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; margin-bottom: 6px; }
.ws-badge { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--ca-surface-subtle); color: var(--ca-ink-3); }
.ws-badge.running { background: var(--ca-warning-soft); color: var(--ca-warning-ink); }
.ws-badge.error { background: var(--ca-critical-soft); color: var(--ca-critical-ink); }
.ws-badge.cached { background: var(--ca-success-soft); color: var(--ca-success-ink); }
.ws-mini { margin-left: auto; height: 22px; padding: 0 8px; font-size: 11px; border: 1px solid var(--ca-line); border-radius: 6px; background: var(--ca-surface); cursor: pointer; }
.ws-loading { font-size: 12px; color: var(--ca-warning-ink); padding: 4px 0; }
.ws-loading-inline { color: var(--ca-warning-ink); }
.ws-error { font-size: 12px; color: var(--ca-critical-ink); line-height: 1.6; }
.ws-trans { font-size: 14px; line-height: 1.8; color: var(--ca-ink-2); white-space: pre-wrap; }

.ws-thread-label { font-size: 11px; color: var(--ca-ink-3); font-weight: 600; padding: 2px 0 0; }
.ws-q-sentence {
  font-size: 11px; color: var(--ca-ink-3); line-height: 1.5;
  border-left: 2px solid var(--ca-line); padding-left: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ws-chat-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--ca-surface-subtle);
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  padding: 10px 12px;
}
.ws-q { font-size: 12px; font-weight: 600; color: var(--ca-primary); }
.ws-a { font-size: 14px; line-height: 1.8; color: var(--ca-ink-2); white-space: pre-wrap; }

.ws-followups { display: flex; flex-wrap: wrap; gap: 6px; }
.ws-chip {
  height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid var(--ca-line);
  background: var(--ca-surface); font-size: 12px; color: var(--ca-ink-2); cursor: pointer;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ws-chip:hover { border-color: var(--ca-primary); color: var(--ca-primary); }
.ws-chip.follow { background: var(--ca-primary-soft); border-color: transparent; color: var(--ca-primary); }
.ws-chip.quiz { background: var(--ca-primary-soft); border-color: transparent; color: var(--ca-primary); font-weight: 600; }
.ws-chip.quiz:disabled { opacity: 0.5; cursor: not-allowed; }

/* 提问测试 */
.quiz-list { display: flex; flex-direction: column; gap: 10px; }
.quiz-card { border: 1px solid var(--ca-line); border-radius: 8px; padding: 8px 10px; background: var(--ca-surface); }
.quiz-stem { display: flex; align-items: baseline; gap: 6px; font-size: 13px; font-weight: 600; color: var(--ca-ink); margin-bottom: 6px; line-height: 1.6; }
.quiz-qnum { flex: 0 0 auto; font-weight: 700; }
.quiz-stem :deep(.md-text) { flex: 1; min-width: 0; }
.quiz-stem :deep(.md-p) { margin: 0; }
.quiz-opt {
  display: flex; align-items: flex-start; gap: 8px; width: 100%; text-align: left;
  border: 1px solid var(--ca-line); border-radius: 6px; background: var(--ca-surface);
  padding: 6px 8px; margin-top: 4px; font-size: 13px; color: var(--ca-ink-2); cursor: pointer; line-height: 1.5;
}
.quiz-opt:hover:not(:disabled) { border-color: var(--ca-primary); }
.quiz-opt:disabled { cursor: default; }
.quiz-opt-key { flex: 0 0 18px; height: 18px; border-radius: 5px; background: var(--ca-surface-subtle); color: var(--ca-ink-3); font-size: 11px; font-weight: 700; display: grid; place-items: center; margin-top: 1px; }
.quiz-opt-text { flex: 1; }
.quiz-opt.correct { border-color: var(--ca-success); background: var(--ca-success-soft); color: var(--ca-success-ink); }
.quiz-opt.correct .quiz-opt-key { background: var(--ca-success); color: #fff; }
.quiz-opt.wrong { border-color: var(--ca-critical); background: var(--ca-critical-soft); color: var(--ca-critical-ink); }
.quiz-opt.wrong .quiz-opt-key { background: var(--ca-critical); color: #fff; }
.quiz-explain { margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--ca-line); font-size: 12.5px; line-height: 1.7; color: var(--ca-ink-2); }
.quiz-verdict { font-size: 12px; font-weight: 700; margin-bottom: 4px; }
.quiz-verdict.ok { color: var(--ca-success-ink); }
.quiz-verdict.bad { color: var(--ca-critical-ink); }
.quiz-term { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.quiz-term-btn { border: 1px solid var(--ca-primary-border); background: var(--ca-primary-soft); color: var(--ca-primary); border-radius: 999px; padding: 1px 10px; font-size: 12px; cursor: pointer; }
.quiz-term-btn:hover { text-decoration: underline; }
.quiz-score { margin-top: 4px; border: 1px solid var(--ca-line); border-radius: 8px; padding: 10px 12px; background: var(--ca-surface-subtle); }
.quiz-score-main { font-size: 14px; font-weight: 700; color: var(--ca-ink); }
.quiz-score-terms { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 6px; font-size: 12px; }
.quiz-score-actions { display: flex; gap: 8px; margin-top: 8px; }
.quiz-submit-row { display: flex; justify-content: flex-end; margin-top: 4px; }
.ws-templates { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--ca-line); }
.ws-input { display: flex; gap: 8px; padding: 10px 14px 14px; border-top: 1px solid var(--ca-line); }
.ws-input input { flex: 1; height: 32px; padding: 0 10px; border: 1px solid var(--ca-line); border-radius: 8px; font-size: 13px; background: var(--ca-surface); color: var(--ca-ink); outline: none; }
.ws-input input:focus { border-color: var(--ca-primary); }

/* 窄窗口: 工作区落为底部抽屉 */
@media (max-width: 1100px) {
  .sentence-ws { width: 100%; flex: 0 0 auto; max-height: 42vh; }
}
</style>
