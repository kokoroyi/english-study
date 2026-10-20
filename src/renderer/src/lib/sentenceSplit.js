// 轻量英文分句器: 规则分句(缩写/小数点保护), 返回 [{text, start, end}]
const ABBRS = ['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'St.', 'vs.', 'etc.', 'e.g.', 'i.e.', 'U.S.', 'U.K.', 'No.', 'a.m.', 'p.m.']

export function splitSentences(text) {
  const src = String(text || '')
  // 缩写句点 → 占位符(1:1 字符替换, 索引不变)
  let protectedText = src
  for (const a of ABBRS) {
    protectedText = protectedText.split(a).join(a.replace('.', '\u0001'))
  }
  // 小数点保护: 3.14 → 3\u000214
  protectedText = protectedText.replace(/(\d)\.(\d)/g, '$1\u0002$2')

  const re = /[^.!?]*[.!?]+["')\]]*(?=\s|$)|[^.!?]+$/g
  const out = []
  let m
  while ((m = re.exec(protectedText)) !== null) {
    const raw = m[0]
    const restored = raw.replace(/\u0001/g, '.').replace(/\u0002/g, '.')
    const s = restored.trim()
    if (!s) continue
    out.push({ text: s, start: m.index, end: m.index + raw.length })
  }
  return out
}

/** 定位字符偏移所在的句子索引 */
export function findSentenceIndex(sentences, offset) {
  const idx = sentences.findIndex((s) => offset >= s.start && offset < s.end)
  return idx >= 0 ? idx : sentences.length - 1
}

/**
 * 结构片段级着色分段(成分拆分原句条专用):
 * 1) 文本优先: 按片段顺序在原文中定位每个片段的文本(模型给的 start/end 偏移常不可靠,
 *    而其片段文本是准确的); 覆盖到词的多个片段中取"最窄"的(最具体, 支持嵌套)。
 * 2) 所有片段文本都匹配失败时, 回退到偏移重叠归属(旧行为)。
 * 3) 同片段相邻词合并为整块(词间空格保留在块内); 拼接恒等于原文(不黏字/不丢字)。
 */
export function buildColoredParts(text, segments) {
  const src = String(text || '')
  const segs = Array.isArray(segments) ? segments : []
  const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim()

  // ---------- 1) 文本优先顺序对齐 ----------
  const spans = [] // {start, end, seg}
  let cursor = 0
  let anyMatched = false
  for (const seg of segs) {
    const t = norm(seg?.text)
    if (!t) continue
    let idx = src.indexOf(t, Math.max(0, cursor - 3))
    if (idx < 0 && spans.length) {
      // 嵌套回退: 子片段文本位于上一片段区间内(顺序对齐的游标在区间之后搜不到)
      const lastSpan = spans[spans.length - 1]
      const idx2 = src.indexOf(t, lastSpan.start)
      if (idx2 >= 0 && idx2 + t.length <= lastSpan.end) idx = idx2
    }
    if (idx >= 0) {
      spans.push({ start: idx, end: idx + t.length, seg })
      cursor = Math.max(cursor, idx + t.length)
      anyMatched = true
    }
  }

  // ---------- 2) 词级切分 + 归属 ----------
  const tokens = []
  const re = /[A-Za-z0-9'’-]+|\s+|[^A-Za-z0-9'’\s]+/g
  let m
  while ((m = re.exec(src)) !== null) {
    const start = m.index
    const end = m.index + m[0].length
    const isWord = /[A-Za-z0-9]/.test(m[0])
    const kind = isWord ? 'word' : /^\s+$/.test(m[0]) ? 'space' : 'punct'
    if (!isWord) {
      tokens.push({ text: m[0], seg: null, kind })
      continue
    }
    let seg = null
    if (anyMatched) {
      // 覆盖该词的文本对齐片段中取最窄的(最具体)
      let best = null
      let bestW = Infinity
      for (const sp of spans) {
        if (start < sp.end && end > sp.start) {
          const w = sp.end - sp.start
          if (w < bestW) {
            bestW = w
            best = sp.seg
          }
        }
      }
      seg = best
    } else {
      // 偏移回退: 重叠最多者胜
      let best = null
      let bestOverlap = 0
      for (const s of segs) {
        const s0 = Math.max(0, Math.min(src.length, Math.round(Number(s?.start) || 0)))
        const s1 = Math.max(0, Math.min(src.length, Math.round(Number(s?.end) || 0)))
        const overlap = Math.min(end, s1) - Math.max(start, s0)
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          best = s
        }
      }
      seg = bestOverlap > 0 ? best : null
    }
    tokens.push({ text: m[0], seg, kind: 'word' })
  }

  // ---------- 3) 同片段相邻词合并成整块 ----------
  const parts = []
  for (const t of tokens) {
    const last = parts[parts.length - 1]
    if (t.seg != null) {
      if (last && last.seg === t.seg) {
        last.text += t.text // 词间空格已随空格 token 折入块内
      } else {
        parts.push({ text: t.text, seg: t.seg })
      }
    } else if (t.kind === 'word') {
      // 无归属的词: 独立无色块(绝不并入前一个色块)
      parts.push({ text: t.text, seg: null })
    } else if (t.kind === 'space') {
      if (last && last.seg != null) last.text += t.text
      else parts.push({ text: t.text, seg: null })
    } else {
      // 标点附在前一块之后(标准排版), 不打断色块
      if (last) last.text += t.text
      else parts.push({ text: t.text, seg: null })
    }
  }
  return parts
}
