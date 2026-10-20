// 语法本服务: 预分类目录 + 完整解析自动归类入库(去重) + 覆盖概览 + 例句列表/删除 + 术语解释
import { getDb, log } from '../db/database.js'
import { LEAF_TERMS, TERM_EXPLAIN, termLabel } from './grammarTerms.js'

// ---------- 预分类目录(与 PLAN 4.5 一致, 唯一事实来源) ----------
export const GRAMMAR_GROUPS = [
  {
    category: '时态',
    subs: [
      '一般现在时', '一般过去时', '一般将来时', '现在进行时', '过去进行时',
      '现在完成时', '过去完成时', '现在完成进行时', '过去完成进行时', '将来进行时', '将来完成时'
    ]
  },
  { category: '语态', subs: ['主动', '被动'] },
  {
    category: '从句',
    subs: [
      { sub: '定语从句' }, { sub: '宾语从句' }, { sub: '主语从句' }, { sub: '表语从句' }, { sub: '同位语从句' },
      { sub: '状语从句', details: ['时间', '原因', '条件', '让步', '目的', '结果', '方式'] }
    ]
  },
  { category: '非谓语', subs: ['不定式', '动名词', '分词'] },
  { category: '虚拟语气', subs: ['虚拟语气'] },
  { category: '句子成分', subs: ['主语', '谓语', '宾语', '表语', '补语', '定语', '状语', '同位语'] },
  { category: '词类', subs: ['介词', '冠词', '连词', '代词', '情态动词', '助动词', '系动词'] }
]

const CLAUSE_SIMPLE = ['定语从句', '宾语从句', '主语从句', '表语从句', '同位语从句']
const TENSE_SET = new Set(GRAMMAR_GROUPS[0].subs)

/** 展开全部叶子: [{category, sub, detail}] */
export function grammarLeaves() {
  const leaves = []
  for (const g of GRAMMAR_GROUPS) {
    for (const s of g.subs) {
      if (typeof s === 'string') {
        leaves.push({ category: g.category, sub: s, detail: '' })
      } else if (Array.isArray(s.details) && s.details.length) {
        for (const d of s.details) leaves.push({ category: g.category, sub: s.sub, detail: d })
      } else {
        leaves.push({ category: g.category, sub: s.sub, detail: '' })
      }
    }
  }
  return leaves
}

/**
 * 从完整解析结果归类(纯函数, 可单测):
 * 返回去重后的 [{category, sub, detail}] 列表
 */
export function classifyStructure(structure) {
  const out = new Set()
  const add = (category, sub, detail = '') => {
    if (!sub) return
    out.add(JSON.stringify({ category, sub, detail }))
  }
  const segs = Array.isArray(structure?.segments) ? structure.segments : []
  for (const seg of segs) {
    const type = String(seg?.type || '')
    const role = String(seg?.role || '')
    const tense = String(seg?.tense || '')
    const voice = String(seg?.voice || '')
    const mood = String(seg?.mood || '')

    // 从句: 定语/宾语/主语/表语/同位语 → 直接入类; 状语从句(细分) → 挂 detail
    const simple = CLAUSE_SIMPLE.find((c) => type === c)
    if (simple) {
      add('从句', simple)
    } else {
      const adv = type.match(/^状语从句\(([^)]+)\)/)
      if (adv) add('从句', '状语从句', adv[1])
      else if (type.endsWith('从句')) add('从句', type) // 未识别从句类型兜底
    }

    // 非谓语: 现在/过去分词归并到「分词」
    const nf = type.match(/^非谓语结构\(([^)]+)\)/)
    if (nf) add('非谓语', nf[1] === '现在分词' || nf[1] === '过去分词' ? '分词' : nf[1])

    // 时态(仅收录预定义取值, 防幻觉值污染目录)
    if (tense && tense !== '-' && TENSE_SET.has(tense)) add('时态', tense)

    // 语态
    if (voice === '主动' || voice === '被动') add('语态', voice)

    // 虚拟语气
    if (mood === '虚拟') add('虚拟语气', '虚拟语气')

    // 句子成分(role 可组合, 按 + 拆分)
    if (role && role !== '-') {
      for (const r of role.split('+').map((x) => x.trim()).filter(Boolean)) add('句子成分', r)
    }
  }
  return [...out].map((s) => JSON.parse(s))
}

/**
 * 解析成功后自动归类入库(INSERT OR IGNORE 去重, 幂等)
 * @returns {collected} 本次新收录条数
 */
export function collectGrammar({ hash, sentence, articleId = null, translation = '', structure }) {
  const classes = classifyStructure(structure)
  if (!classes.length) return { collected: 0 }
  const db = getDb()
  const ins = db.prepare(
    'INSERT OR IGNORE INTO grammar_entries (sentence_hash, sentence, translation, article_id, category, sub, detail) VALUES (?,?,?,?,?,?,?)'
  )
  let n = 0
  const tx = db.transaction((rows) => {
    for (const r of rows) n += ins.run(hash, sentence, translation, articleId ?? null, r.category, r.sub, r.detail).changes
  })
  tx(classes)
  if (n) log('info', 'grammar', `语法本新收录 ${n} 条: ${String(sentence || '').slice(0, 40)}`)
  return { collected: n }
}

/** 覆盖概览: 全部叶子 + 计数 + 覆盖统计 */
export function grammarStats() {
  const db = getDb()
  const rows = db.prepare('SELECT category, sub, detail, COUNT(*) AS c FROM grammar_entries GROUP BY category, sub, detail').all()
  const key = (r) => `${r.category}\u0000${r.sub}\u0000${r.detail || ''}`
  const map = new Map(rows.map((r) => [key(r), r.c]))
  const leaves = grammarLeaves().map((l) => ({ ...l, count: map.get(key(l)) || 0 }))
  const total = rows.reduce((a, r) => a + r.c, 0)
  const covered = leaves.filter((l) => l.count > 0).length
  const groups = GRAMMAR_GROUPS.map((g) => {
    const gs = leaves.filter((l) => l.category === g.category)
    return { category: g.category, count: gs.reduce((a, l) => a + l.count, 0), leaves: gs }
  })
  return { total, covered, totalLeaves: leaves.length, groups }
}

/** 某分类下的例句列表(快照自收录时刻, 独立于句子缓存; 文章标题与解析结构 LEFT JOIN) */
export function listGrammarEntries({ category, sub, detail } = {}) {
  if (!category || !sub) return []
  const rows = getDb()
    .prepare(
      `SELECT g.*, a.title AS article_title, n.structure_json
       FROM grammar_entries g
       LEFT JOIN articles a ON a.id = g.article_id
       LEFT JOIN sentence_notes n ON n.sentence_hash = g.sentence_hash
       WHERE g.category = ? AND g.sub = ? AND g.detail = ?
       ORDER BY g.id DESC LIMIT 200`
    )
    .all(category, sub, detail || '')
  return rows.map((r) => {
    let structure = null
    if (r.structure_json) {
      try { structure = JSON.parse(r.structure_json) } catch { structure = null }
    }
    delete r.structure_json
    return { ...r, structure }
  })
}

/** 删除某条例句(不影响原文与解析记录) */
export function removeGrammarEntry(id) {
  const res = getDb().prepare('DELETE FROM grammar_entries WHERE id = ?').run(Number(id))
  return { removed: res.changes }
}

/** 批量删除例句 */
export function batchRemoveGrammarEntries(ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (!list.length) return { removed: 0 }
  const stmt = getDb().prepare('DELETE FROM grammar_entries WHERE id = ?')
  const tx = getDb().transaction((arr) => {
    let n = 0
    for (const id of arr) n += stmt.run(id).changes
    return n
  })
  return { removed: tx(list) }
}

// ---------- 术语解释(语法本知识卡片 / 工作区弹窗共用) ----------

/** 查术语解释: 用户自定义覆盖优先, 否则内置兜底 */
export function getTermExplanation(key) {
  const k = String(key || '')
  const row = getDb().prepare('SELECT * FROM grammar_terms WHERE key = ?').get(k)
  const builtin = k.startsWith('leaf:') ? LEAF_TERMS[k] : TERM_EXPLAIN[k]
  // 内置字典两种形态: 语法本 leaf 用 examples 数组, 弹窗 term 用单数 example
  const builtinExamples = builtin
    ? builtin.examples || (builtin.example ? [builtin.example] : [])
    : []
  if (row) {
    let examples = []
    try { examples = JSON.parse(row.examples_json || '[]') } catch { examples = [] }
    return {
      key: k,
      label: termLabel(k),
      short: row.short_exp != null ? row.short_exp : builtin?.short || '',
      full: row.full_exp != null ? row.full_exp : builtin?.full || '',
      examples: examples.length ? examples : builtinExamples,
      source: 'custom'
    }
  }
  if (!builtin) return { key: k, label: termLabel(k), short: '', full: '', examples: [], source: 'none' }
  return { key: k, label: termLabel(k), short: builtin.short || '', full: builtin.full || '', examples: builtinExamples, source: 'builtin' }
}

/** 保存用户自定义解释(覆盖内置; 任一字段为空字符串则回落内置) */
export function saveTermExplanation(key, { short = '', full = '', examples = [] } = {}) {
  const k = String(key || '')
  if (!k) return { ok: false, error: '缺少术语 key' }
  getDb()
    .prepare(
      `INSERT INTO grammar_terms (key, short_exp, full_exp, examples_json) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET short_exp = excluded.short_exp, full_exp = excluded.full_exp,
         examples_json = excluded.examples_json, updated_at = datetime('now','localtime')`
    )
    .run(k, String(short) || null, String(full) || null, JSON.stringify(Array.isArray(examples) ? examples : []))
  log('info', 'grammar', `术语解释已保存: ${k}`)
  return { ok: true }
}

/** 恢复内置默认解释(删除自定义行) */
export function resetTermExplanation(key) {
  const r = getDb().prepare('DELETE FROM grammar_terms WHERE key = ?').run(String(key || ''))
  return { reset: r.changes > 0 }
}

/** 语法本搜索: 分类术语(目录) + 已收录例句 */
export function searchGrammar(query) {
  const q = String(query || '').trim()
  if (!q) return { leaves: [], entries: [] }
  const lq = q.toLowerCase()
  const leaves = grammarLeaves()
    .map((l) => ({ ...l, label: `${l.sub}${l.detail ? `(${l.detail})` : ''} · ${l.category}` }))
    .filter(
      (l) =>
        l.label.toLowerCase().includes(lq) ||
        l.sub.toLowerCase().includes(lq) ||
        l.detail.toLowerCase().includes(lq) ||
        l.category.toLowerCase().includes(lq)
    )
    .slice(0, 20)
  const entries = getDb()
    .prepare(
      `SELECT id, sentence, translation, category, sub, detail FROM grammar_entries
       WHERE sentence LIKE ? OR translation LIKE ?
       ORDER BY id DESC LIMIT 10`
    )
    .all(`%${q}%`, `%${q}%`)
  return { leaves, entries }
}
