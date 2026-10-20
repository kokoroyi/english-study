<script setup>
import { ref, computed } from 'vue'
import { fmtPhonetic } from '../lib/phonetic.js'
import { reviewResultLabel, REVIEW_RESULT_LABELS } from '../lib/reviewLabels.js'

const props = defineProps({
  words: { type: Array, default: () => [] } // [{id, lemma, display, phonetic, translation}]
})

const emit = defineEmits(['result', 'done'])

// 卡片状态机: 'ask' (看词回忆) → 'reveal' (翻面看释义) → 下一条
const index = ref(0)
const phase = ref('ask') // ask | reveal
const results = ref([])
const dictCache = ref({})

const current = computed(() => props.words[index.value] || null)
// 最后一条翻完即 100%; 无词时为 0
const progress = computed(() => props.words.length ? Math.round(((index.value + 1) / props.words.length) * 100) : 0)

const pendingChoice = ref(null)

const pendingLabel = computed(() => REVIEW_RESULT_LABELS[pendingChoice.value] || '')

async function reveal() {
  if (phase.value !== 'ask') return
  // 载入词典释义
  if (current.value && !dictCache.value[current.value.id]) {
    try {
      const entry = await window.api.dict.lookup(current.value.lemma || current.value.word)
      dictCache.value[current.value.id] = entry
    } catch {}
  }
  phase.value = 'reveal'
}

// 先问后看: 用户在翻面前已选 认识/模糊/不认识(标记为"待确认"), 翻面后确认或改判
// 双击防护: 按真实时钟戳判断(上次提交 250ms 内的点击忽略)。
// 不用 setTimeout 锁: 窗口隐藏时计时器被浏览器节流到秒级, 会误吞下一张卡的正常点击。
let lastSubmitAt = 0

function choose(initial) {
  if (phase.value === 'ask') {
    // 先记住初判, 翻面后确认
    pendingChoice.value = initial
    reveal()
  } else {
    submitResult(initial)
  }
}

function submitResult(final) {
  const now = Date.now()
  if (now - lastSubmitAt < 250) return // 双击间隔 < 250ms 视为误触
  const w = current.value
  if (!w) return
  lastSubmitAt = now
  results.value.push({ wordId: w.id, result: final })
  emit('result', { wordId: w.id, result: final })
  advance()
}

function advance() {
  pendingChoice.value = null
  phase.value = 'ask'
  index.value += 1
  if (index.value >= props.words.length) {
    emit('done', results.value)
  }
}

function currentEntry() {
  return dictCache.value[current.value?.id]
}

function resultCount(prefix) {
  const n = results.value.filter((r) => r.result === prefix).length
  return { label: reviewResultLabel(prefix), count: n }
}
</script>

<template>
  <div class="review-cards">
    <!-- 进度条 -->
    <div class="rc-progress">
      <div class="rc-progress-bar" :style="{ '--progress': progress + '%' }"></div>
      <span class="rc-progress-text">{{ Math.min(index + 1, words.length) }} / {{ words.length }}</span>
    </div>

    <!-- 卡片 -->
    <div v-if="current" class="rc-card" :class="phase">
      <!-- 正面: 看词回忆 -->
      <div class="rc-word">{{ current.lemma || current.display }}</div>
      <div class="rc-phonetic" v-if="currentEntry()?.phonetic">{{ fmtPhonetic(currentEntry()?.phonetic) }}</div>
      <div class="rc-hint" v-if="phase === 'ask'">先回忆这个词的意思…</div>

      <!-- 翻面: 释义对照 -->
      <div v-if="phase === 'reveal'" class="rc-reveal">
        <div class="rc-trans">{{ currentEntry()?.translation || '词典未收录' }}</div>
        <div class="rc-def" v-if="currentEntry()?.definition">{{ currentEntry()?.definition }}</div>
        <div class="rc-tags" v-if="currentEntry()?.tag">
          <span class="tag" v-for="t in currentEntry().tag.split(' ').filter(Boolean)" :key="t">{{ t }}</span>
        </div>
      </div>

      <div class="rc-actions">
        <button class="rc-btn known" @click="choose('known')">认识</button>
        <button class="rc-btn fuzzy" @click="choose('fuzzy')">模糊</button>
        <button class="rc-btn unknown" @click="choose('unknown')">不认识</button>
        <button class="rc-btn later" @click="choose('later')">稍后</button>
      </div>
      <div v-if="phase === 'ask'" class="rc-remind">点击判定后先翻面看释义, 再最终确认</div>
      <div v-else class="rc-remind">
        对照释义, 点按钮确认(可改判)<template v-if="pendingLabel"> · 初判「{{ pendingLabel }}」</template>
      </div>
    </div>

    <!-- 完成 -->
    <div v-else class="rc-done">
      <div class="rc-done-title">复习完成</div>
      <div class="rc-done-stats">
        <span class="rc-done-item known">{{ resultCount('known').label }} <b>{{ resultCount('known').count }}</b></span>
        <span class="rc-done-item fuzzy">{{ resultCount('fuzzy').label }} <b>{{ resultCount('fuzzy').count }}</b></span>
        <span class="rc-done-item unknown">{{ resultCount('unknown').label }} <b>{{ resultCount('unknown').count }}</b></span>
        <span class="rc-done-item later">{{ resultCount('later').label }} <b>{{ resultCount('later').count }}</b></span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.review-cards { padding: 20px; }

.rc-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.rc-progress-bar { position: relative; flex: 1; height: 6px; border-radius: 3px; background: var(--ca-surface-subtle); overflow: hidden; }
.rc-progress-bar::after { content: ''; position: absolute; top: 0; left: 0; bottom: 0; width: var(--progress, 0%); background: var(--ca-primary); border-radius: 3px; transition: width 0.3s var(--ca-ease); }
.rc-progress-text { font-size: 12px; color: var(--ca-ink-3); font-variant-numeric: tabular-nums; }

.rc-card {
  min-height: 260px;
  padding: 28px;
  border-radius: 16px;
  border: 1px solid var(--ca-line);
  background: var(--ca-surface);
  box-shadow: var(--ca-shadow-card);
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: transform 0.2s var(--ca-ease);
}
.rc-card.reveal { border-color: var(--ca-ai); }

.rc-word { font-size: 34px; font-weight: 700; color: var(--ca-ink); }
.rc-phonetic { color: var(--ca-ink-3); font-size: 15px; }
.rc-hint { color: var(--ca-ink-3); font-size: 13px; margin-top: 4px; }

.rc-reveal { margin-top: 8px; max-width: 100%; }
.rc-trans { font-size: 16px; color: var(--ca-ink-2); line-height: 1.6; }
.rc-def { font-size: 13px; color: var(--ca-ink-3); line-height: 1.5; margin-top: 6px; white-space: pre-line; }
.rc-tags { display: flex; gap: 4px; justify-content: center; margin-top: 8px; flex-wrap: wrap; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 999px; background: var(--ca-primary-soft); color: var(--ca-primary); font-weight: 600; }

.rc-actions { display: flex; gap: 10px; margin-top: 20px; }
.rc-btn {
  min-width: 88px;
  height: 36px;
  border-radius: 9px;
  border: 1px solid var(--ca-line);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: transform var(--ca-duration-fast) var(--ca-ease), box-shadow var(--ca-duration-fast) var(--ca-ease);
}
.rc-btn:active { transform: scale(0.97); }
.rc-btn.known { background: var(--ca-success-soft); color: var(--ca-success-ink); border-color: transparent; }
.rc-btn.fuzzy { background: var(--ca-warning-soft); color: var(--ca-warning-ink); border-color: transparent; }
.rc-btn.unknown { background: var(--ca-critical-soft); color: var(--ca-critical-ink); border-color: transparent; }
.rc-btn.later { background: var(--ca-surface-subtle); color: var(--ca-ink-3); }

.rc-remind { font-size: 11px; color: var(--ca-ink-3); margin-top: 10px; }

.rc-done { text-align: center; padding: 40px 20px; }
.rc-done-title { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
.rc-done-stats { display: flex; gap: 16px; justify-content: center; }
.rc-done-item { font-size: 13px; color: var(--ca-ink-3); }
.rc-done-item b { font-size: 18px; margin-left: 4px; color: var(--ca-ink); }
.rc-done-item.known b { color: var(--ca-success-ink); }
.rc-done-item.fuzzy b { color: var(--ca-warning-ink); }
.rc-done-item.unknown b { color: var(--ca-critical-ink); }
</style>
