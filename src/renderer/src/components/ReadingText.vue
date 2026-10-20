<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { store } from '../store'
import { buildBionicParts } from '../lib/bionicFade.js'
import { getAdhdMode } from '../lib/adhdMode.js'
import { selectSemanticHighlights } from '../lib/semanticEngine.js'
import { fmtPhonetic } from '../lib/phonetic.js'
import { splitSentences, findSentenceIndex } from '../lib/sentenceSplit.js'
import { reviewResultLabel } from '../lib/reviewLabels.js'

const props = defineProps({
  text: { type: String, default: '' },
  reviewWords: { type: Array, default: () => [] },
  reviewMode: { type: Boolean, default: false },
  selectedSentence: { type: Object, default: null } // {start,end} 选中的句子范围(由父级工作区管理)
})

const emit = defineEmits(['word-marked', 'word-unmarked', 'word-result', 'sentence-click'])

const container = ref(null)
const words = ref([])

// ADHD 设置的长链读取收敛为单一 computed(避免 store.settings?.appearance?.adhd?.x 四处漂移)。
// 必须声明在 text watcher(immediate, setup 阶段同步执行 buildWords)之前, 否则触发 TDZ 崩溃
const adhdSettings = computed(() => store.settings?.appearance?.adhd || {})
// 单一模式: 'semantic' | 'bionic' | 'off'(旧数据由 getAdhdMode 归一化)
const adhdModeKey = computed(() => getAdhdMode(store.settings?.appearance))

// ---------- 内联复习判定状态(必须声明在 text watcher 之前) ----------
// watch(props.text, { immediate: true }) 在 setup 阶段同步调用 closeReviewPop(),
// 若这些 const 声明在文件后部会触发临时死区(TDZ) ReferenceError → 整个组件渲染崩溃(开发模式白屏)
const reviewPopWord = ref(null) // 当前弹出判定的词 token
const reviewFeedback = ref(false) // 判定后显示释义反馈
const reviewEntry = ref(null)
const reviewEntryLoading = ref(false)
const reviewPopPos = ref({ x: 0, y: 0 })
let reviewEntrySeq = 0

// ---------- 分词 ----------
const sentences = computed(() => splitSentences(props.text || ''))
const selectedSentenceIdx = computed(() => {
  if (!props.selectedSentence) return -1
  return findSentenceIndex(sentences.value, props.selectedSentence.start)
})

function tokenize(text) {
  const tokens = []
  const regex = /([A-Za-z][A-Za-z''-]*)|(\s+)|([^\s]+)/g
  let m
  while ((m = regex.exec(text)) !== null) {
    const base = { start: m.index, end: m.index + m[0].length }
    if (m[1]) tokens.push({ type: 'word', text: m[1], raw: m[0], ...base })
    else if (m[2]) tokens.push({ type: 'space', text: m[2], ...base })
    else tokens.push({ type: 'punct', text: m[0], ...base })
  }
  return tokens
}

function buildWords() {
  const tokens = tokenize(props.text || '')
  const sentenceList = splitSentences(props.text || '')
  const out = []
  let wi = 0
  const wordTokens = []
  for (const t of tokens) {
    const sentenceIndex = findSentenceIndex(sentenceList, t.start)
    if (t.type === 'word') {
      out.push({ id: `w${wi}`, index: wi++, word: t.text, marked: false, result: null, loading: false, start: t.start, end: t.end, sentenceIndex })
      wordTokens.push({ ...t })
    } else {
      out.push({ type: 'plain', text: t.text, start: t.start, end: t.end, sentenceIndex })
    }
  }
  // 语义关键词检测(阅读与复习模式均生效)。
  // 激活条件只看单一模式: 语义模式选中即生效
  let highlightSet = new Set()
  let amplifySet = new Set()
  if (adhdModeKey.value === 'semantic') {
    const { highlightSet: h, amplifySet: a } = selectSemanticHighlights(wordTokens, {
      density: adhdSettings.value.semanticDensity ?? 0.25
    })
    highlightSet = h
    amplifySet = a
  }
  let wi2 = 0
  for (const w of out) {
    if (w.type === 'plain') continue
    w.semantic = highlightSet.has(wi2)
    w.semanticAmplify = amplifySet.has(wi2)
    wi2++
  }
  return out
}

watch(
  () => props.text,
  () => {
    words.value = buildWords()
    applyReviewMarks()
    closeReviewPop()
  },
  { immediate: true }
)

// reviewWords 变化(换组)时重新匹配高亮
watch(
  () => props.reviewWords,
  () => applyReviewMarks()
)

// 模式/密度实时切换: 语义标记是 buildWords 的一次性计算结果, 不重建则切换不生效
// (此前必须"打开复习前选好模式"; 现在切换即时重算, 并保留已标记/已判定状态)
watch(
  () => [adhdModeKey.value, adhdSettings.value.semanticDensity],
  () => rebuildWordsPreservingState()
)

function rebuildWordsPreservingState() {
  const markedSet = new Set()
  const judgedMap = new Map() // word(lower) → result
  for (const w of words.value) {
    if (w.type === 'plain') continue
    if (w.marked) markedSet.add(w.word.toLowerCase())
    if (w.reviewStatus === 'done') judgedMap.set(w.word.toLowerCase(), w.result)
  }
  words.value = buildWords()
  applyReviewMarks()
  for (const w of words.value) {
    if (w.type === 'plain') continue
    if (markedSet.has(w.word.toLowerCase())) w.marked = true
    const r = judgedMap.get(w.word.toLowerCase())
    if (r) {
      w.reviewStatus = 'done'
      w.result = r
    }
  }
  closeReviewPop()
}

function applyReviewMarks() {
  // 先重置, 防止旧组标记残留
  for (const w of words.value) {
    if (w.type === 'plain') continue
    w.reviewId = null
    w.reviewStatus = null
    w.result = null
    w.reviewLemma = null
  }
  if (!props.reviewMode || !Array.isArray(props.reviewWords) || !props.reviewWords.length) return
  const byKey = new Map()
  for (const rw of props.reviewWords) {
    const l = (rw.lemma || '').toLowerCase()
    const d = (rw.display || '').toLowerCase()
    if (l) byKey.set(l, rw)
    if (d && d !== l) byKey.set(d, rw)
  }
  for (const w of words.value) {
    if (w.type === 'plain') continue
    const rw = byKey.get(w.word.toLowerCase())
    if (rw) {
      w.reviewId = rw.id
      w.reviewStatus = 'pending'
      w.result = null
      w.reviewLemma = rw.lemma || w.word
    }
  }
}

// ---------- ADHD 模式 ----------
// 一个词的三档仿生结构(仅在 bionic 模式渲染, 见模板条件)
function wordParts(w) {
  const splitRatio = adhdSettings.value.splitRatio ?? 0.35
  return buildBionicParts(w.word, splitRatio)
}

// ---------- 划选标记 ----------
const selection = ref(null)
const dictPreview = ref(null)
const selectionLoading = ref(false)
const popupPos = ref({ x: 0, y: 0 })

function handleMouseUp(e) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) {
    selection.value = null
    dictPreview.value = null
    return
  }
  const range = sel.getRangeAt(0)
  if (!container.value.contains(range.commonAncestorContainer)) {
    selection.value = null
    dictPreview.value = null
    return
  }
  const text = sel.toString().trim()
  if (!text) return
  const wordCount = text.split(/\s+/).length
  if (wordCount > 4) {
    // 超出短语长度上限: 清掉上一个残留弹窗
    selection.value = null
    dictPreview.value = null
    return
  }

  const rect = range.getBoundingClientRect()
  // 上下限双向钳制: 横向滚动/靠近边缘时弹窗不能溢出屏幕左侧或顶部
  const x = Math.max(8, Math.min(rect.left, window.innerWidth - 340))
  const y = Math.max(8, Math.min(rect.bottom + 10, window.innerHeight - 200))
  popupPos.value = { x, y }

  // 判断选中词里是否已有已标记的词
  const wordList = text.match(/[A-Za-z''-]+/g) || []
  const lowerSet = new Set(wordList.map((w) => w.toLowerCase()))
  const markedWords = []
  for (const w of words.value) {
    if (w.type === 'plain') continue
    if (lowerSet.has(w.word.toLowerCase()) && w.marked) {
      markedWords.push(w.word)
    }
  }

  selection.value = {
    text,
    firstWord: text.match(/[A-Za-z''-]+/)?.[0] || '',
    hasMarked: markedWords.length > 0,
    markedCount: markedWords.length
  }
  selectionLoading.value = true
  loadDictPreview(selection.value.firstWord)
}

let dictReqSeq = 0

async function loadDictPreview(word) {
  const seq = ++dictReqSeq
  try {
    // 先归并原型再查词义: 直接查变体词(如 perceived)只会得到"perceive 的过去式"
    // 这类时态说明, 而不是真正词义
    let lemma = word
    try {
      const l = await window.api.dict.lemma(word)
      if (l) lemma = l
    } catch { /* 词典不可用则用原词 */ }
    const entry = (await window.api.dict.lookup(lemma)) || (await window.api.dict.lookup(word))
    // 只展示最新一次选中的预览, 丢弃过期响应
    if (seq !== dictReqSeq) return
    dictPreview.value = entry ? { ...entry, queriedWord: word, lemma } : null
  } catch {
    if (seq !== dictReqSeq) return
    dictPreview.value = null
  } finally {
    if (seq === dictReqSeq) selectionLoading.value = false
  }
}

function markSelection() {
  if (!selection.value) return
  const wordList = selection.value.text.match(/[A-Za-z''-]+/g) || []
  if (!wordList.length) return
  const lowerWords = new Set(wordList.map((w) => w.toLowerCase()))
  const marked = []
  for (const w of words.value) {
    if (w.type === 'plain') continue
    if (lowerWords.has(w.word.toLowerCase()) && !w.marked) {
      w.marked = true
      marked.push(w.word)
    }
  }
  if (marked.length) emit('word-marked', marked)
  clearSelection()
}

function unmarkSelection() {
  if (!selection.value) return
  const wordList = selection.value.text.match(/[A-Za-z''-]+/g) || []
  if (!wordList.length) return
  const lowerWords = new Set(wordList.map((w) => w.toLowerCase()))
  const unmarked = []
  for (const w of words.value) {
    if (w.type === 'plain') continue
    if (lowerWords.has(w.word.toLowerCase()) && w.marked) {
      w.marked = false
      unmarked.push(w.word)
    }
  }
  if (unmarked.length) emit('word-unmarked', unmarked)
  clearSelection()
}

function clearSelection() {
  window.getSelection()?.removeAllRanges()
  selection.value = null
  dictPreview.value = null
}

// ---------- 内联复习判定: 点击高亮的到期词 → 认识/模糊/不认识 ----------
const resultLabel = reviewResultLabel

// ---------- 选句手势(PLAN 4.1): mousedown→mouseup 位移 <5px 且无文字选区 → 命中句子 ----------
// 此前只判断选区(hasActiveSelection), 按住拖动但未形成选区也会误触发选句
const gesture = { downX: 0, downY: 0, upX: 0, upY: 0 }

function handleTextMouseDown(e) {
  gesture.downX = e.clientX
  gesture.downY = e.clientY
  gesture.upX = e.clientX
  gesture.upY = e.clientY
}

function handleTextMouseUp(e) {
  gesture.upX = e.clientX
  gesture.upY = e.clientY
}

function hasActiveSelection() {
  const sel = window.getSelection()
  return !!(sel && !sel.isCollapsed)
}

/** 视为拖动手势: 有文字选区, 或 mousedown→mouseup 位移 ≥5px */
function isDragGesture() {
  if (hasActiveSelection()) return true
  return Math.hypot(gesture.upX - gesture.downX, gesture.upY - gesture.downY) >= 5
}

// 点击句子(单词或标点): 定位所在句并通知父级打开工作区
function emitSentenceClick(tok) {
  const s = sentences.value[findSentenceIndex(sentences.value, tok.start)]
  if (s) emit('sentence-click', { index: sentences.value.indexOf(s), text: s.text, start: s.start, end: s.end })
}

function onWordClick(w) {
  // 拖选(文字选区或位移 ≥5px)不触发选句/判定
  if (isDragGesture()) return
  // 复习模式: 到期高亮词 → 判定面板(最高优先级)
  if (w.reviewId != null && w.reviewStatus !== 'done') {
    if (reviewPopWord.value === w) {
      closeReviewPop()
      return
    }
    clearSelection()
    const el = container.value?.querySelector(`[data-wi="${w.index}"]`)
    const rect = el?.getBoundingClientRect()
    reviewPopWord.value = w
    reviewFeedback.value = false
    reviewEntry.value = null
    reviewPopPos.value = {
      x: Math.max(8, Math.min(rect?.left ?? 120, window.innerWidth - 300)),
      y: Math.max(8, Math.min((rect?.bottom ?? 120) + 8, window.innerHeight - 240))
    }
    loadReviewEntry(w.reviewLemma || w.word)
    return
  }
  // 普通点击 → 选句
  emitSentenceClick(w)
}

function onPlainClick(tok) {
  if (isDragGesture()) return
  emitSentenceClick(tok)
}

async function loadReviewEntry(word) {
  const seq = ++reviewEntrySeq
  reviewEntryLoading.value = true
  try {
    const entry = await window.api.dict.lookup(word)
    if (seq !== reviewEntrySeq) return
    reviewEntry.value = entry
  } catch {
    if (seq !== reviewEntrySeq) return
    reviewEntry.value = null
  } finally {
    if (seq === reviewEntrySeq) reviewEntryLoading.value = false
  }
}

function judgeInline(result) {
  const w = reviewPopWord.value
  if (!w || w.reviewStatus === 'done') return
  w.reviewStatus = 'done'
  w.result = result
  emit('word-result', { id: w.reviewId, word: w.word, result })
  // 翻面反馈: 显示释义, 用户对照后自行关闭
  reviewFeedback.value = true
}

function closeReviewPop() {
  reviewPopWord.value = null
  reviewFeedback.value = false
  reviewEntry.value = null
  reviewEntrySeq++
}

onMounted(() => {
  document.addEventListener('mouseup', handleMouseUp)
  words.value = buildWords()
  applyReviewMarks()
})

onBeforeUnmount(() => {
  document.removeEventListener('mouseup', handleMouseUp)
})
</script>

<template>
  <div class="reading-text" ref="container" @mousedown="handleTextMouseDown" @mouseup="handleTextMouseUp">
    <template v-for="(w, i) in words" :key="w.type === 'plain' ? 'p-' + i : w.id">
      <span
        v-if="w.type === 'plain'"
        class="rt-plain"
        :class="{
          'sentence-selected': selectedSentenceIdx >= 0 && w.sentenceIndex === selectedSentenceIdx
        }"
        @click="onPlainClick(w)"
      >{{ w.text }}</span>
      <span
        v-else
        class="rt-word"
        :class="{
          'rt-marked': w.marked,
          'rt-semantic': w.semantic,
          'rt-semantic-amp': w.semanticAmplify,
          'rt-review': w.reviewId != null,
          'rt-review-done': w.reviewStatus === 'done',
          'rt-review-known': w.reviewStatus === 'done' && w.result === 'known',
          'rt-review-fuzzy': w.reviewStatus === 'done' && w.result === 'fuzzy',
          'rt-review-unknown': w.reviewStatus === 'done' && w.result === 'unknown',
          'sentence-selected': selectedSentenceIdx >= 0 && w.sentenceIndex === selectedSentenceIdx
        }"
        :data-wi="w.index"
        :data-word="w.word"
        @click="onWordClick(w)"
      >
        <template
          v-if="
            adhdModeKey === 'bionic' &&
            !w.reviewId
          "
        >
          <template v-for="(part, pi) in wordParts(w)" :key="pi">
            <span :class="part.cls">{{ part.text }}</span>
          </template>
        </template>
        <template v-else>{{ w.word }}</template>
      </span>
    </template>

    <!-- 划选浮动工具条 -->
    <div
      v-if="selection"
      class="selection-pop"
      :style="{ left: popupPos.x + 'px', top: popupPos.y + 'px' }"
    >
      <div class="selection-preview">
        <div class="sp-word">
          {{ selection.firstWord }}
          <span v-if="dictPreview && dictPreview.lemma && dictPreview.lemma.toLowerCase() !== selection.firstWord.toLowerCase()" class="sp-lemma">
            → {{ dictPreview.lemma }}
          </span>
        </div>
        <div v-if="selectionLoading" class="sp-loading">查询中…</div>
        <template v-else-if="dictPreview">
          <div class="sp-phonetic" v-if="dictPreview.phonetic">{{ fmtPhonetic(dictPreview.phonetic) }}</div>
          <div class="sp-trans" v-if="dictPreview.translation">{{ dictPreview.translation.split('\n').slice(0, 2).join(' ') }}</div>
          <div class="sp-trans muted" v-else>词典未收录</div>
        </template>
        <div v-else class="sp-loading">未找到释义</div>
      </div>
      <div class="selection-actions">
        <!-- 选中含已标记词 → 显示取消标记 -->
        <button v-if="selection.hasMarked" class="highlight-btn unmark" @mousedown.prevent @click.stop="unmarkSelection">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          取消标记 ({{ selection.markedCount }})
        </button>
        <button v-else class="highlight-btn" @mousedown.prevent @click.stop="markSelection">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
          标记为生词
        </button>
        <button class="cancel-btn" @mousedown.prevent @click.stop="clearSelection">✕</button>
      </div>
    </div>
    <!-- 内联复习判定面板 -->
    <div
      v-if="reviewPopWord"
      class="review-panel"
      :style="{ left: reviewPopPos.x + 'px', top: reviewPopPos.y + 'px' }"
      @mousedown.prevent
    >
      <div class="rp-head">
        <span class="rp-word">{{ reviewPopWord.word }}</span>
        <button class="cancel-btn" @click.stop="closeReviewPop">✕</button>
      </div>
      <template v-if="reviewFeedback">
        <div class="rp-feedback">
          <div class="rp-phonetic" v-if="reviewEntry?.phonetic">{{ fmtPhonetic(reviewEntry.phonetic) }}</div>
          <div class="rp-trans">
            <template v-if="reviewEntryLoading">释义加载中…</template>
            <template v-else>{{ reviewEntry?.translation || '词典未收录' }}</template>
          </div>
          <div class="rp-verdict" :class="'v-' + reviewPopWord.result">你的判定: {{ resultLabel(reviewPopWord.result) }}</div>
        </div>
      </template>
      <template v-else>
        <div class="rp-hint">先回忆这个词的意思</div>
        <div class="rp-actions">
          <button class="rp-btn known" @click.stop="judgeInline('known')">认识</button>
          <button class="rp-btn fuzzy" @click.stop="judgeInline('fuzzy')">模糊</button>
          <button class="rp-btn unknown" @click.stop="judgeInline('unknown')">不认识</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.reading-text {
  font-size: calc(18px * var(--rt-base-scale, 1));
  line-height: var(--rt-line-height, 2);
  letter-spacing: var(--rt-letter-spacing, 0.02em);
  word-spacing: var(--rt-word-spacing, 0.08em);
  color: var(--ca-ink);
  user-select: text;
  cursor: text;
  white-space: pre-wrap;
}

.rt-plain { white-space: pre-wrap; }

/* 句子选中: 整句连续蓝色底色(词间距用 padding 补偿, 无每词竖条/无圆角碎片感) */
.rt-word.sentence-selected, .rt-plain.sentence-selected {
  background: var(--ca-primary-soft);
  border-radius: 0;
  padding-right: var(--rt-word-spacing, 0em);
  margin-right: calc(-1 * var(--rt-word-spacing, 0em));
}

.rt-word {
  cursor: pointer;
  border-radius: 3px;
  white-space: pre-wrap;
}

/* (聚焦淡化已移除: 悬停时其余词变淡会造成大面积闪烁, 影响阅读) */

/* Bionic 三档: 词首加粗放大引导视线; 中/尾段只轻微淡化(旧版 0.55/0.35 过淡, 影响连贯阅读) */
.bionic-lead { font-weight: 700; font-size: calc(1em * var(--rt-lead-scale, 1)); }
.bionic-mid { font-weight: 500; opacity: 0.72; }
.bionic-tail { font-weight: 400; opacity: 0.55; }

/* 语义关键词增强 */
.rt-semantic { font-weight: 700; }
.rt-semantic-amp { font-weight: 800; color: var(--ca-primary); }

/* 已标记生词: 提高选择器优先级(双类), 确保在复习高亮(.rt-review 浅蓝底)之上仍显示荧光黄,
   否则复习模式下划选标记"看不见", 标记=不认识的判定手势形同失效 */
.rt-word.rt-marked {
  background: var(--highlight-color, #fef3c7);
  box-shadow: 0 0 0 2px var(--highlight-color, #fef3c7);
  border-radius: 3px;
}

/* 暗色模式: 淡黄荧光不可读, 改用琥珀半透明高对比(用户自定义色在暗色下不生效) */
:root[data-theme="dark"] .rt-word.rt-marked {
  background: rgba(251, 191, 36, 0.32);
  box-shadow: 0 0 0 1.5px rgba(251, 191, 36, 0.55);
  color: #fff8e1;
}

/* 复习模式: 到期词弱高亮 + 虚线提示可点击 */
.rt-review {
  background: var(--ca-primary-soft);
  border-bottom: 1.5px dashed var(--ca-primary);
  border-radius: 2px;
}
.rt-review-done { opacity: 0.6; }
.rt-review-known { border-bottom-style: solid; border-bottom-color: var(--ca-success); }
.rt-review-fuzzy { border-bottom-style: solid; border-bottom-color: var(--ca-warning); }
.rt-review-unknown { border-bottom-style: solid; border-bottom-color: var(--ca-critical); }

/* 划选浮动工具条 */
.selection-pop {
  position: fixed;
  z-index: 3000;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 12px;
  box-shadow: var(--ca-shadow-float);
  padding: 12px;
  min-width: 240px;
  max-width: 340px;
}
.selection-preview { margin-bottom: 10px; }
.sp-word { font-weight: 700; font-size: 15px; }
.sp-lemma { font-weight: 500; font-size: 12px; color: var(--ca-primary); }
.sp-phonetic { color: var(--ca-ink-2); font-size: 13px; font-weight: 600; }
.sp-trans { color: var(--ca-ink-2); font-size: 12px; margin-top: 2px; line-height: 1.5; }
.sp-loading { color: var(--ca-ink-3); font-size: 12px; }
.selection-actions { display: flex; align-items: center; gap: 6px; }

.highlight-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border: 1px solid #fde68a;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--ca-duration-fast) var(--ca-ease);
}
.highlight-btn:hover { background: #fef3c7; }
.highlight-btn.unmark { background: var(--ca-critical-soft); border-color: transparent; color: var(--ca-critical-ink); }
.highlight-btn.unmark:hover { opacity: 0.85; }

.cancel-btn {
  width: 28px; height: 28px;
  border: none; border-radius: 6px;
  background: var(--ca-surface-subtle); color: var(--ca-ink-3);
  cursor: pointer;
}

/* 内联复习判定面板 */
.review-panel {
  position: fixed;
  z-index: 3000;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 12px;
  box-shadow: var(--ca-shadow-float);
  padding: 12px 14px;
  min-width: 250px;
  max-width: 340px;
}
.rp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.rp-word { font-weight: 700; font-size: 16px; }
.rp-hint { font-size: 12px; color: var(--ca-ink-3); margin-bottom: 8px; }
.rp-actions { display: flex; gap: 8px; }
.rp-btn {
  flex: 1;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--ca-line);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.rp-btn.known { background: var(--ca-success-soft); color: var(--ca-success-ink); border-color: transparent; }
.rp-btn.fuzzy { background: var(--ca-warning-soft); color: var(--ca-warning-ink); border-color: transparent; }
.rp-btn.unknown { background: var(--ca-critical-soft); color: var(--ca-critical-ink); border-color: transparent; }
.rp-feedback { display: flex; flex-direction: column; gap: 8px; }
.rp-phonetic { font-size: 13px; font-weight: 600; color: var(--ca-ink-2); }
.rp-trans { font-size: 13px; line-height: 1.6; color: var(--ca-ink-2); }
.rp-verdict { font-size: 12px; font-weight: 600; }
.rp-verdict.v-known { color: var(--ca-success-ink); }
.rp-verdict.v-fuzzy { color: var(--ca-warning-ink); }
.rp-verdict.v-unknown { color: var(--ca-critical-ink); }
</style>
