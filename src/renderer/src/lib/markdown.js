// 轻量 Markdown 渲染(零依赖, 防注入):
// 先整体 HTML 转义, 再做受限的语法转换 —— 加粗/斜体/行内代码/代码块/标题/无序/有序列表/段落
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s) {
  let t = escapeHtml(s)
  t = t.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*(?!\*)/g, '$1<em>$2</em>')
  return t
}

export function renderMarkdown(src) {
  let text = String(src ?? '')
  // 1) 代码块先提取占位(整体转义, 不参与行解析)
  const codeBlocks = []
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    codeBlocks.push(`<pre class="md-pre"><code>${escapeHtml(String(code).replace(/^\n/, '').trim())}</code></pre>`)
    return `\n\u0000CODE${codeBlocks.length - 1}\u0000\n`
  })

  // 2) 表格提取(连续的 |…| 行 + 分隔行 :---)
  const tables = []
  text = text.replace(/(?:(?:^\s*\|[^\n]*\|\s*$)\n?)+/gm, (block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) return block
    const sepIdx = lines.findIndex((l) => /^\|[\s:\-|]+\|$/.test(l) && l.includes('-'))
    if (sepIdx <= 0) return block
    const parse = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    const headers = parse(lines[0])
    const rows = lines.slice(sepIdx + 1).map(parse).filter((r) => r.some((c) => c))
    let html = '<div class="md-table-wrap"><table class="md-table"><thead><tr>' + headers.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>'
    for (const r of rows) {
      html += '<tr>' + headers.map((_, i) => `<td>${inline(r[i] ?? '')}</td>`).join('') + '</tr>'
    }
    html += '</tbody></table></div>'
    tables.push(html)
    return `\n\u0000TABLE${tables.length - 1}\u0000\n`
  })

  // 3) 行级解析: 标题 / 列表 / 段落(段内单换行 → <br>)
  const out = []
  let para = []
  let list = null // 'ul' | 'ol' | null
  const flushPara = () => {
    if (para.length) {
      out.push(`<p class="md-p">${para.map(inline).join('<br>')}</p>`)
      para = []
    }
  }
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`)
      list = null
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const trimmed = line.trim()
    if (trimmed.startsWith('\u0000CODE') || trimmed.startsWith('\u0000TABLE')) {
      flushPara(); closeList()
      out.push(trimmed)
      continue
    }
    if (!trimmed) {
      flushPara(); closeList()
      continue
    }
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushPara(); closeList()
      const lv = Math.min(6, h[1].length)
      out.push(`<h${lv} class="md-h md-h${lv}">${inline(h[2])}</h${lv}>`)
      continue
    }
    const ul = trimmed.match(/^\s*[-*+]\s+(.*)$/)
    if (ul) {
      flushPara()
      if (list !== 'ul') { closeList(); out.push('<ul class="md-ul">'); list = 'ul' }
      out.push(`<li>${inline(ul[1])}</li>`)
      continue
    }
    const ol = trimmed.match(/^\s*(\d+)[.)]\s+(.*)$/)
    if (ol) {
      flushPara()
      if (list !== 'ol') { closeList(); out.push(`<ol class="md-ol" start="${ol[1]}">`); list = 'ol' }
      out.push(`<li>${inline(ol[2])}</li>`)
      continue
    }
    closeList()
    para.push(line)
  }
  flushPara()
  closeList()

  // 4) 还原代码块与表格
  return out
    .join('')
    .replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeBlocks[Number(i)] || '')
    .replace(/\u0000TABLE(\d+)\u0000/g, (_, i) => tables[Number(i)] || '')
}
