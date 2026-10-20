// 仿生阅读(Bionic-style)分词与三档渐变引擎
// 独立实现：按公开的「词首加粗、余下渐隐」阅读辅助思路，将单词拆成 lead/mid/tail 三段。
// 不依赖任何第三方插件代码；只处理拉丁字母单词，标点/数字边界保持原样。

const WORD_JOINERS = new Set(["'", '’', '-', '–'])

function isLetterOrDigit(ch) {
  return /[\p{L}\p{N}]/u.test(ch)
}

function isCountingChar(ch) {
  return /[\p{L}\p{N}]/u.test(ch)
}

/**
 * 计算一个单词前部需要加粗的 UTF-16 长度。
 * 按字母/数字计数(撇号、连字符等连接符不算长度)，至少 1 个字母。
 */
export function computeLatinLeadUnits(wordText, splitRatio) {
  if (!wordText) return 0
  if (typeof splitRatio !== 'number' || !Number.isFinite(splitRatio) || splitRatio <= 0) return 0

  const chars = Array.from(wordText)
  // 只处理开头连续的词字符；标点/空白留给外层原样渲染
  let wordCharCount = 0
  const wordChars = []
  for (const ch of chars) {
    if (!isLetterOrDigit(ch) && !WORD_JOINERS.has(ch)) break
    wordChars.push(ch)
    if (isCountingChar(ch)) wordCharCount += 1
  }
  if (!wordCharCount) return 0

  const leadCount = Math.min(wordCharCount, Math.max(1, Math.round(wordCharCount * splitRatio)))
  let counted = 0
  let leadUnits = 0
  for (const ch of wordChars) {
    if (counted >= leadCount) break
    leadUnits += ch.length
    if (isCountingChar(ch)) counted += 1
  }
  return leadUnits
}

/**
 * 把一个单词切成三段(UTF-16 下标)：
 * lead = 前 splitRatio 的字母; mid = 剩余部分的前半; tail = 最后至少 1 个字符。
 * 短词可能没有 mid/tail(null)。
 */
export function buildLatinFadeRanges(wordText, splitRatio) {
  const length = typeof wordText === 'string' ? wordText.length : 0
  const leadEnd = Math.max(0, Math.min(length, computeLatinLeadUnits(wordText, splitRatio)))
  if (leadEnd >= length) return { leadEnd, mid: null, tail: null }

  const restLen = length - leadEnd
  if (restLen <= 0) return { leadEnd, mid: null, tail: null }

  // mid 最多到倒数第二个字符，保证尾部至少留 1 个字符
  const midLen = Math.min(Math.max(0, restLen - 1), Math.ceil(restLen * 0.5))
  const midEnd = leadEnd + midLen
  return {
    leadEnd,
    mid: midLen > 0 ? { start: leadEnd, end: midEnd } : null,
    tail: midEnd < length ? { start: midEnd, end: length } : null
  }
}

/**
 * 把单词渲染成 [{ text, cls }] 三档结构，供组件直接 v-for。
 * cls: bionic-lead | bionic-mid | bionic-tail
 */
export function buildBionicParts(word, splitRatio) {
  if (!word) return [{ text: word || '', cls: '' }]
  const ranges = buildLatinFadeRanges(word, splitRatio)
  const parts = []
  if (ranges.leadEnd > 0) parts.push({ text: word.slice(0, ranges.leadEnd), cls: 'bionic-lead' })
  if (ranges.mid) parts.push({ text: word.slice(ranges.mid.start, ranges.mid.end), cls: 'bionic-mid' })
  if (ranges.tail) parts.push({ text: word.slice(ranges.tail.start, ranges.tail.end), cls: 'bionic-tail' })
  if (!parts.length) parts.push({ text: word, cls: '' })
  return parts
}
