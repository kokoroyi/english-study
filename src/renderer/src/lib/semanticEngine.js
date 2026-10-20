// 语义关键词高亮引擎(独立实现)
// 思路：过滤停用词 → 按词长/重复度/大写特征打分 → 在密度配额内选出信息量高的实词做视觉增强。
// 无第三方插件代码依赖；输出按 word token 下标(含被跳过的停用词)标注。

import { EN_STOPWORDS } from './stopwords.js'

const DEFAULTS = {
  density: 0.25,
  minTokenLength: 2,
  minGap: 2,
  maxConsecutive: 1,
  repeatLimit: 1,
  amplifyRatio: 0.4
}

const MEDIUM_LENGTH = 5
const LONG_LENGTH = 8

function isNumericOnly(text) {
  return /\p{Number}/u.test(text) && !/\p{Letter}/u.test(text)
}

function isAllCaps(word) {
  return word === word.toUpperCase() && word !== word.toLowerCase()
}

function isTitleCase(word) {
  const first = word[0]
  return !!first && first === first.toUpperCase() && first !== first.toLowerCase()
}

/** 收集候选词，并记录每个词在「全部 word token」中的下标(含停用词占位) */
function collectCandidates(tokens) {
  const frequency = new Map()
  const candidates = []
  let wordIndex = 0
  for (const token of tokens) {
    if (token.type !== 'word') continue
    const raw = token.text || ''
    const lower = raw.toLowerCase()
    const length = Array.from(raw).length
    const usable = lower && !EN_STOPWORDS.has(lower) && !isNumericOnly(raw) && length >= DEFAULTS.minTokenLength
    if (usable) {
      frequency.set(lower, (frequency.get(lower) || 0) + 1)
      candidates.push({ index: wordIndex, raw, lower, length })
    }
    wordIndex += 1
  }
  return { candidates, frequency, totalWords: wordIndex }
}

/** 打分：长词/低频/大写的词信息量更高；分数相同按出现顺序稳定排序 */
function scoreCandidates(candidates, frequency) {
  return candidates
    .map((candidate) => {
      let score = 1
      if (candidate.length >= MEDIUM_LENGTH) score += 1
      if (candidate.length >= LONG_LENGTH) score += 2
      score += 1 / (frequency.get(candidate.lower) || 1)
      if (isAllCaps(candidate.raw)) score += 2
      else if (isTitleCase(candidate.raw)) score += 1
      return { ...candidate, score }
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
}

/** 已选词的相邻间隔限制：避免高亮扎堆 */
function isTooClose(index, selected, gap) {
  if (gap <= 0) return false
  for (const chosen of selected) {
    if (Math.abs(chosen - index) <= gap) return true
  }
  return false
}

/** 连续高亮限制：选中后会形成超过 maxConsecutive 的连续段则跳过 */
function breaksConsecutiveLimit(index, selected, maxConsecutive) {
  if (maxConsecutive <= 0) return false
  let run = 1
  let left = index - 1
  while (selected.has(left)) { run += 1; left -= 1 }
  let right = index + 1
  while (selected.has(right)) { run += 1; right += 1 }
  return run > maxConsecutive
}

/**
 * 选择语义高亮词。
 * @param {Array<{type:string,text:string}>} tokens 分句后按出现顺序的 token 列表
 * @param {object} config { density, minGap, maxConsecutive, repeatLimit, amplifyRatio }
 * @returns {{ highlightSet: Set<number>, amplifySet: Set<number> }} 下标对应全部 word token
 */
export function selectSemanticHighlights(tokens, config = {}) {
  const options = { ...DEFAULTS, ...config }
  const { candidates, frequency, totalWords } = collectCandidates(tokens)
  if (!candidates.length || totalWords === 0) {
    return { highlightSet: new Set(), amplifySet: new Set() }
  }

  const density = Math.max(0, Math.min(1, Number(options.density)))
  const target = Math.max(1, Math.min(totalWords, Math.round(totalWords * density)))
  const scored = scoreCandidates(candidates, frequency)
  const selected = new Set()
  const selectedCandidates = []
  const repeatCounts = new Map()

  // 间隔从大到小放宽，直到选够密度配额
  for (let gap = Math.max(0, Math.round(options.minGap)); gap >= 0 && selected.size < target; gap -= 1) {
    for (const candidate of scored) {
      if (selected.size >= target) break
      if (selected.has(candidate.index)) continue
      if ((repeatCounts.get(candidate.lower) || 0) >= options.repeatLimit) continue
      if (isTooClose(candidate.index, selected, gap)) continue
      if (breaksConsecutiveLimit(candidate.index, selected, options.maxConsecutive)) continue
      selected.add(candidate.index)
      selectedCandidates.push(candidate)
      repeatCounts.set(candidate.lower, (repeatCounts.get(candidate.lower) || 0) + 1)
    }
  }

  if (!selected.size) return { highlightSet: selected, amplifySet: new Set() }

  // 得分最高的一小部分再加一档(更粗/更强调)，形成两级视觉层次
  const amplifyRatio = Math.max(0.2, Math.min(0.6, Number(options.amplifyRatio)))
  const amplifyCount = Math.max(1, Math.round(selectedCandidates.length * amplifyRatio))
  const amplifySet = new Set(
    selectedCandidates
      .slice()
      .sort((a, b) => (b.score - a.score) || (a.index - b.index))
      .slice(0, amplifyCount)
      .map((candidate) => candidate.index)
  )
  return { highlightSet: selected, amplifySet }
}
