// 术语 key ↔ 语法本叶子 映射(渲染层; 与主进程 grammarTerms.js 保持一致)

export function termLabel(key) {
  const parts = String(key).split(':')
  if (parts[0] === 'leaf') {
    const sub = parts[2] || ''
    const detail = parts[3] || ''
    return detail ? `${sub}(${detail})` : sub
  }
  return parts.slice(1).join(':')
}

/** 语法本叶子 → 知识卡片 key */
export function leafKeyForLeaf({ category, sub, detail }) {
  return `leaf:${category}:${sub}:${detail || ''}`
}

/** 弹窗术语 key → 语法本叶子(无对应返回 null) */
export function leafForTermKey(key) {
  const parts = String(key).split(':')
  const p = parts[0]
  const v = parts.slice(1).join(':')
  if (p === 'tense') return { category: '时态', sub: v, detail: '' }
  if (p === 'voice') return { category: '语态', sub: v, detail: '' }
  if (p === 'role') return { category: '句子成分', sub: v, detail: '' }
  if (p === 'pos') return { category: '词类', sub: v, detail: '' }
  if (p === 'mood') return v === '虚拟' ? { category: '虚拟语气', sub: '虚拟语气', detail: '' } : null
  if (p === 'type') {
    if (v === '主句' || v === '名词短语' || v === '介词短语') return null
    const adv = v.match(/^状语从句\(([^)]+)\)/)
    if (adv) return { category: '从句', sub: '状语从句', detail: adv[1] }
    if (['定语从句', '宾语从句', '主语从句', '表语从句', '同位语从句'].includes(v)) return { category: '从句', sub: v, detail: '' }
    const nf = v.match(/^非谓语结构\(([^)]+)\)/)
    if (nf) return { category: '非谓语', sub: nf[1] === '现在分词' || nf[1] === '过去分词' ? '分词' : nf[1], detail: '' }
  }
  return null
}
