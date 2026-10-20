// 音标展示格式化: 统一加 / / 包裹, 更醒目、更符合词典惯例
export function fmtPhonetic(p) {
  if (!p) return ''
  const s = String(p).trim()
  if (!s) return ''
  if (s.startsWith('/') && s.endsWith('/')) return s
  if (s.startsWith('[') && s.endsWith(']')) return s
  return `/${s}/`
}
