// 句子解析服务: 翻译 / 完整解析(结构·时态·语态) / 多轮提问 / 提问测试 + 单任务队列 + 分块缓存
import { createHash } from 'crypto'
import { getDb, log } from '../db/database.js'
import { getSetting } from './settings.js'
import { callChat, callChatStream } from './ai.js'
import { collectGrammar } from './grammar.js'
import { LEAF_TERMS, termLabel } from './grammarTerms.js'

const SYSTEM_ROLE = `你是一名耐心的英语语法教师。你只分析给定的英文句子, 使用简体中文解释。
输出分类法(必须严格使用这些取值):
- type(片段类型): 主句 | 定语从句 | 状语从句(时间|原因|条件|让步|目的|结果|方式) | 宾语从句 | 主语从句 | 表语从句 | 同位语从句 | 名词短语 | 介词短语 | 非谓语结构(不定式|现在分词|过去分词|动名词)
- role(句子成分, 可组合): 主语 | 谓语 | 宾语 | 表语 | 补语 | 定语 | 状语 | 同位语
- tense(时态): 一般现在时 | 一般过去时 | 一般将来时 | 现在进行时 | 过去进行时 | 现在完成时 | 过去完成时 | 现在完成进行时 | 过去完成进行时 | 将来进行时 | 将来完成时
- voice(语态): 主动 | 被动
- mood(语气): 陈述 | 祈使 | 虚拟`

/** 句子哈希(标准化后) */
export function hashSentence(text) {
  return createHash('sha256').update(String(text || '').trim().replace(/\s+/g, ' ')).digest('hex')
}

function currentModelName() {
  return (getSetting('ai') || {}).model || 'deepseek-chat'
}

function normalizeSentence(text) {
  return String(text || '').trim().replace(/\s+/g, ' ')
}

function getCachedRow(hash) {
  return getDb().prepare('SELECT * FROM sentence_notes WHERE sentence_hash = ?').get(hash)
}

// 语法术语标签 → 叶子 key(模型输出标签时规范化; 覆盖语法本全部 44 叶)
const LABEL_TO_LEAF = new Map()
for (const key of Object.keys(LEAF_TERMS)) LABEL_TO_LEAF.set(termLabel(key), key)
// 术语清单(出题指令用: 让模型从已知术语中选, 保证考察点可点气泡/深链)
const LEAF_LABELS = [...new Set(Object.keys(LEAF_TERMS).map((k) => termLabel(k)))]

function saveCache(hash, sentence, articleId, fields) {
  const db = getDb()
  const row = getCachedRow(hash)
  const model = currentModelName()
  if (row) {
    db.prepare(
      `UPDATE sentence_notes SET translation = COALESCE(?, translation), structure_json = COALESCE(?, structure_json),
       chat_json = COALESCE(?, chat_json), quiz_json = COALESCE(?, quiz_json), article_id = COALESCE(?, article_id),
       model = ?, updated_at = datetime('now','localtime')
       WHERE sentence_hash = ?`
    ).run(fields.translation ?? null, fields.structure ?? null, fields.chat ?? null, fields.quiz ?? null, articleId ?? null, model, hash)
  } else {
    db.prepare(
      `INSERT INTO sentence_notes (sentence_hash, sentence, article_id, translation, structure_json, chat_json, quiz_json, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(hash, sentence, articleId ?? null, fields.translation ?? null, fields.structure ?? null, fields.chat ?? null, fields.quiz ?? null, model)
  }
}

/** 读取某句的缓存(选中句时静默显示) */
export function getCachedSentence(hash) {
  const row = getCachedRow(hash)
  if (!row) return { hash, translation: null, structure: null, chat: [], quiz: null }
  let structure = null
  if (row.structure_json) {
    try { structure = JSON.parse(row.structure_json) } catch { structure = null }
  }
  let chat = []
  if (row.chat_json) {
    try { chat = JSON.parse(row.chat_json) } catch { chat = [] }
  }
  let quiz = null
  if (row.quiz_json) {
    try { quiz = JSON.parse(row.quiz_json) } catch { quiz = null }
  }
  return { hash, translation: row.translation || null, structure, chat, quiz, articleId: row.article_id }
}

// ---------- 单任务队列 ----------
let taskChain = Promise.resolve()
let currentAbort = null
let activeTask = false
// 取消代际: cancelCurrentTask 递增。排队中的任务轮到执行时若代际已过期 → 直接取消,
// 不调用 AI、不写缓存(此前只 abort 正在执行的任务, 排队任务取消后仍会执行)
let cancelGeneration = 0

function enqueue(fn) {
  const generation = cancelGeneration
  const run = taskChain.then(async () => {
    if (generation !== cancelGeneration) throw new Error('任务已取消')
    activeTask = true
    currentAbort = new AbortController()
    const sig = currentAbort.signal
    try {
      return await fn(sig)
    } catch (e) {
      // 取消统一以「任务已取消」失败: 各 HTTP 客户端/服务的 abort 错误文案不一致
      if (sig.aborted) throw new Error('任务已取消')
      throw e
    }
  })
  // 队列自身吞掉错误, 由调用方从返回值取 err
  taskChain = run.catch(() => {})
  // 任务结束时复位运行标志(与任务成败无关; 两分支处理避免派生 Promise 再抛未捕获拒绝)
  run.then(
    () => { activeTask = false },
    () => { activeTask = false }
  )
  return run
}

/** 是否有推理任务进行中(退出确认用) */
export function isTaskRunning() {
  return activeTask
}

export function cancelCurrentTask() {
  // 先递增代际: 排队中尚未开始的任务轮到时会发现已过期并被取消
  cancelGeneration++
  if (currentAbort) {
    try { currentAbort.abort() } catch { /* 已结束 */ }
  }
  return { ok: true }
}

/** 通用 AI 任务入队(故事生成/间隔调表等非句子任务共用单并发队列; PLAN 决策: 全局单并发) */
export function runQueued(fn) {
  return enqueue(fn)
}

// ---------- 底层调用(可注入测试) ----------
let chatImpl = null
export function setChatImplForTest(fn) {
  chatImpl = fn
}

async function callChatRaw({ messages, temperature, json = false, signal = null }) {
  return callChat({ messages, temperature, json, signal })
}

// ---------- 翻译任务 ----------
export async function translateSentence({ sentence, articleId = null, signal = null, force = false, onProgress = null }) {
  const s = normalizeSentence(sentence)
  const hash = hashSentence(s)
  if (!force) {
    const cached = getCachedRow(hash)
    if (cached?.translation) {
      return { ok: true, cached: true, hash, translation: cached.translation }
    }
  }

  const run = (sig) => {
    onProgress?.({ phase: 'running' })
    return (chatImpl || callChatRaw)({
      messages: [
        { role: 'system', content: SYSTEM_ROLE },
        { role: 'user', content: `请把下面的英文句子翻译成自然的中文, 只输出翻译, 不要任何解释:\n\n${s}` }
      ],
      temperature: 0.2,
      signal: sig
    })
  }
  const translation = String(await enqueue(run)).trim()
  if (!translation) throw new Error('AI 返回了空翻译')
  saveCache(hash, s, articleId, { translation })
  log('info', 'sentence', `句子翻译完成: ${s.slice(0, 40)}`)
  return { ok: true, cached: false, hash, translation }
}

// ---------- 完整解析任务(翻译+结构一次推理, 分块缓存) ----------
function parseJsonLoose(text) {
  let t = String(text || '').trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first >= 0 && last > first) t = t.slice(first, last + 1)
  return JSON.parse(t)
}

function clampSegments(segments, len) {
  if (!Array.isArray(segments)) return []
  const out = []
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue
    let start = Number(seg.start)
    let end = Number(seg.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    start = Math.max(0, Math.min(len, Math.round(start)))
    end = Math.max(0, Math.min(len, Math.round(end)))
    if (end <= start) continue
    out.push({ ...seg, start, end })
  }
  return out
}

export async function analyzeSentence({ sentence, articleId = null, signal = null, force = false, onProgress = null }) {
  const s = normalizeSentence(sentence)
  const hash = hashSentence(s)
  const cached = getCachedRow(hash)
  if (!force && cached?.structure_json) {
    // 缓存破损容错: 坏 JSON 视为未命中, 不把解析异常抛给渲染层; 重新推理成功后 saveCache 覆盖坏数据
    let structure = null
    try {
      structure = JSON.parse(cached.structure_json)
    } catch (e) {
      log('warn', 'sentence', `句子缓存损坏, 忽略并重新解析: ${e.message}`)
    }
    if (structure && typeof structure === 'object' && !Array.isArray(structure)) {
      // 缓存命中同样触发归类(历史解析也收录进语法本; INSERT OR IGNORE 幂等)
      try {
        collectGrammar({ hash, sentence: s, articleId: articleId ?? cached.article_id ?? null, translation: cached.translation || '', structure })
      } catch (e) {
        log('warn', 'grammar', `语法本收录失败: ${e.message}`)
      }
      return { ok: true, cached: true, hash, ...structure, translation: cached.translation || null }
    }
  }

  // 提示词分层(PLAN 5.4): 层1 系统角色字节固定放 system 槽(KV cache 前缀复用), 层2 任务全放 user
  const prompt = `请分析下面的英文句子, 输出严格 JSON(不要代码围栏、不要多余文字):
{
  "translation": "中文翻译",
  "segments": [
    {"id":0,"text":"片段原文","type":"主句","role":"主语+谓语","tense":"一般过去时","voice":"主动","mood":"陈述","start":0,"end":10,"parent":null}
  ],
  "notes": ["语法要点"],
  "followups": ["追问1", "追问2"]
}
规则:
1. segments 按原文顺序平铺, 嵌套用 parent 引用父片段 id; start/end 是该片段在原句中的字符下标(含首不含尾), 必须精确对应原文。
2. 每个片段填 type/role/tense/voice/mood; 短语类片段(如介词短语) tense/voice/mood 填 "-"。
3. 主句本身是一个片段; 从句挂在其修饰的主句或短语片段下。
4. 所有片段必须完整覆盖原句: 第一个片段从 0 开始, 相邻片段首尾相接, 一直覆盖到原句最后一个字符, 不允许留空隙或重叠。
5. notes 1-3 条; followups 2-3 个自然的中文追问。

原句:
${s}`

  const raw = await enqueue(async (sig) => {
    const call = (p) => (chatImpl || callChatRaw)({ messages: [{ role: 'system', content: SYSTEM_ROLE }, { role: 'user', content: p }], temperature: 0.2, json: true, signal: sig })
    onProgress?.({ phase: 'running' })
    const first = await call(prompt)
    // 覆盖度检查: 首次解析成功但片段空隙过大(>25%)时, 用更明确的覆盖要求重试一次
    try {
      const st = parseJsonLoose(first)
      const segs = Array.isArray(st.segments) ? st.segments : []
      if (segs.length) {
        const iv = clampSegments(segs, s.length).map((g) => [g.start, g.end]).sort((a, b) => a[0] - b[0])
        let covered = 0
        let cur = null
        for (const [a, b] of iv) {
          if (!cur) cur = [a, b]
          else if (a <= cur[1]) cur[1] = Math.max(cur[1], b)
          else { covered += cur[1] - cur[0]; cur = [a, b] }
        }
        if (cur) covered += cur[1] - cur[0]
        if (covered < s.length * 0.75) {
          log('info', 'sentence', `片段覆盖不足(${Math.round((covered / s.length) * 100)}%), 以完整覆盖要求重试一次`)
          onProgress?.({ phase: 'retrying' })
          return await call(
            prompt +
              '\n\n注意: 你上一次的分段没有覆盖整个原句。必须让所有片段首尾相接, 从第 0 个字符一直覆盖到原句最后一个字符, 不留任何空隙。'
          )
        }
      }
    } catch { /* 首次解析失败: 保持原样, 走外层容错 */ }
    return first
  })
  let parsed = null
  let parseError = null
  try {
    parsed = parseJsonLoose(raw)
  } catch (e) {
    parseError = e.message
  }
  if (parsed) {
    const segments = clampSegments(parsed.segments, s.length)
    const result = {
      translation: String(parsed.translation || '').trim(),
      segments,
      notes: Array.isArray(parsed.notes) ? parsed.notes.map(String) : [],
      followups: Array.isArray(parsed.followups) ? parsed.followups.map(String).filter(Boolean).slice(0, 3) : []
    }
    saveCache(hash, s, articleId, { structure: JSON.stringify(result), translation: result.translation || undefined })
    log('info', 'sentence', `句子解析完成(${segments.length} 片段): ${s.slice(0, 40)}`)
    try {
      collectGrammar({ hash, sentence: s, articleId, translation: result.translation, structure: result })
    } catch (e) {
      log('warn', 'grammar', `语法本收录失败: ${e.message}`)
    }
    return { ok: true, cached: false, hash, ...result }
  }
  // 容错: JSON 失败 → 以纯文本返回, 翻译/结构至少保证原始内容可展示
  log('warn', 'sentence', `解析 JSON 失败(${parseError}), 以纯文本返回`)
  return { ok: true, cached: false, hash, translation: '', segments: [], notes: [], followups: [], rawText: String(raw).trim(), parseError }
}

// ---------- 提问测试(基于句子语法出四选一) ----------
const QUIZ_DIFFICULTY_TEXT = {
  1: '干扰项为明显语法错误(一看即错的低级错误), 题干为基础辨识题。',
  2: '干扰项为英语学习者常见典型错误(高频易错点)。',
  3: '干扰项为细微差异或易混淆结构(近义结构辨析, 需要仔细判断), 可以考察语义上的细微差别。'
}

/** 出题提示词(纯函数, 可单测): 题数/难度来自设置, 已缓存解析作为上下文, 上一批题干用于换一批去重 */
export function buildQuizPrompt({ sentence, n = 3, difficulty = 2, translation = null, structure = null, prevStems = [] }) {
  const ctx = [`原句: ${sentence}`]
  if (translation) ctx.push(`该句翻译: ${translation}`)
  if (structure?.segments?.length) {
    ctx.push(`该句结构: ${structure.segments.map((g) => `${g.text}[${g.type}/${g.role}/${g.tense}/${g.voice}]`).join('; ')}`)
  }
  const rules = [
    `1. 恰好 ${n} 题; 每题恰好 4 个选项, 仅 1 个正确; answer 是正确选项下标(0-3)。`,
    `2. ${QUIZ_DIFFICULTY_TEXT[difficulty] || QUIZ_DIFFICULTY_TEXT[2]}`,
    `3. grammar 从以下术语清单中选一个最贴切的名称(必须逐字一致, 不要自创): ${LEAF_LABELS.join('、')}`,
    `4. 题目之间尽量覆盖不同语法点, 不要重复考察同一现象。`
  ]
  if (Array.isArray(prevStems) && prevStems.length) {
    rules.push(`5. 上一批题目(题干)为:\n${prevStems.map((x, i) => `${i + 1}. ${x}`).join('\n')}\n请避免重复这些题干与考点组合, 变换提问角度与选项措辞。`)
  }
  return `请基于下面句子的语法知识, 出 ${n} 道四选一选择题, 考察该句涉及的语法点。
输出严格 JSON(不要代码围栏、不要多余文字):
{
  "questions": [
    {"stem": "题干(中文, 引用原句中的相关部分)", "options": ["选项A", "选项B", "选项C", "选项D"], "answer": 0, "explain": "讲解(中文, 说明正确答案与理由, 点出语法术语)", "grammar": "考察的语法术语名称"}
  ]
}
规则:
${rules.join('\n')}

${ctx.join('\n')}`
}

/** 语法字段规范化: 模型可能输出叶子 key 或术语标签; 归一为叶子 key, 无匹配返回 null */
export function normalizeQuizGrammar(raw) {
  const v = String(raw || '').trim().replace(/（/g, '(').replace(/）/g, ')') // 全角括号归一, 提高清单匹配率
  if (!v) return null
  if (LEAF_TERMS[v]) return v
  return LABEL_TO_LEAF.get(v) || null
}

/** 模型输出 → 题组(校验失败抛错, 触发上层重试) */
export function normalizeQuiz(raw) {
  const obj = parseJsonLoose(raw)
  const qs = Array.isArray(obj?.questions) ? obj.questions : null
  if (!qs || !qs.length) throw new Error('出题结果不含 questions')
  const items = []
  for (const q of qs.slice(0, 8)) {
    if (!q || typeof q !== 'object') continue
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o ?? '').trim())
    const answer = Number(q.answer)
    const stem = String(q.stem || '').trim()
    const explain = String(q.explain || '').trim()
    if (options.length !== 4 || options.some((o) => !o)) throw new Error('每题必须恰好 4 个选项(非空)')
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) throw new Error('answer 需为 0~3 的整数')
    if (!stem || !explain) throw new Error('题干与讲解不能为空')
    const key = normalizeQuizGrammar(q.grammar)
    items.push({ id: items.length, stem, options, answer, explain, grammar: key, grammarLabel: key ? termLabel(key) : (String(q.grammar || '').trim() || null) })
  }
  if (!items.length) throw new Error('出题结果无有效题目')
  return { items, answers: items.map(() => null), finished: false }
}

/** 生成提问测试题组(缓存优先; force 重新生成) */
export async function makeQuiz({ sentence, articleId = null, signal = null, force = false, onProgress = null }) {
  const s = normalizeSentence(sentence)
  if (!s) throw new Error('缺少句子内容')
  const hash = hashSentence(s)
  const cached = getCachedRow(hash)
  if (!force && cached?.quiz_json) {
    try {
      const quiz = JSON.parse(cached.quiz_json)
      if (quiz?.items?.length) return { ok: true, cached: true, hash, quiz }
    } catch { /* 损坏缓存, 重新生成 */ }
  }

  const cfg = getSetting('quiz') || {}
  const n = [3, 4, 5].includes(cfg.questionsPerBatch) ? cfg.questionsPerBatch : 3
  const difficulty = [1, 2, 3].includes(cfg.difficulty) ? cfg.difficulty : 2
  let structure = null
  let prevStems = []
  if (cached?.structure_json) {
    try { structure = JSON.parse(cached.structure_json) } catch { /* 忽略损坏缓存 */ }
  }
  if (cached?.quiz_json) {
    try {
      const old = JSON.parse(cached.quiz_json)
      prevStems = (Array.isArray(old.items) ? old.items : []).map((i) => i?.stem).filter(Boolean).slice(0, 8)
    } catch { /* 忽略损坏缓存 */ }
  }
  const prompt = buildQuizPrompt({ sentence: s, n, difficulty, translation: cached?.translation || null, structure, prevStems })
  const raw = await enqueue(async (sig) => {
    const call = (p) => (chatImpl || callChatRaw)({ messages: [{ role: 'system', content: SYSTEM_ROLE }, { role: 'user', content: p }], temperature: 0.7, json: true, signal: sig })
    onProgress?.({ phase: 'running' })
    const first = await call(prompt)
    try {
      normalizeQuiz(first)
      return first
    } catch {
      log('warn', 'sentence', '出题结果校验失败, 以更严格指令重试一次')
      onProgress?.({ phase: 'retrying' })
      return await call(prompt + `\n\n注意: 你上一次的输出不符合要求。必须恰好输出 ${n} 道题, 每题恰好 4 个选项, answer 为 0-3 的正确下标。只输出 JSON, 不要任何多余文字。`)
    }
  })
  const quiz = normalizeQuiz(raw)
  saveCache(hash, s, articleId, { quiz: JSON.stringify(quiz) })
  log('info', 'sentence', `出题完成(${quiz.items.length} 题): ${s.slice(0, 40)}`)
  return { ok: true, cached: false, hash, quiz }
}

/** 保存作答进度(answers: 各题所选下标或 null; finished: 全部答完) */
export function submitQuizAnswers({ hash, answers, finished = false }) {
  const row = getCachedRow(String(hash || ''))
  if (!row?.quiz_json) return { ok: false, error: '题组不存在, 请先生成' }
  let quiz
  try { quiz = JSON.parse(row.quiz_json) } catch { return { ok: false, error: '题组缓存损坏, 请换一批' } }
  const items = Array.isArray(quiz.items) ? quiz.items : []
  if (!items.length) return { ok: false, error: '题组缓存损坏, 请换一批' }
  const cleaned = (Array.isArray(answers) ? answers : []).slice(0, items.length).map((a) => (Number.isInteger(a) && a >= 0 && a <= 3 ? a : null))
  while (cleaned.length < items.length) cleaned.push(null)
  quiz.answers = cleaned
  quiz.finished = finished === true && cleaned.every((a) => a != null)
  saveCache(row.sentence_hash, row.sentence, row.article_id, { quiz: JSON.stringify(quiz) })
  return { ok: true, quiz }
}

// ---------- 按文章的 AI 会话线程(多轮提问) ----------
// 设计: 一篇文章(或一篇 AI 复习故事) = 一个会话线程; 同一线程内所有句子的提问按时间累积。
// 提示词分层(缓存友好): system(固定) → 文章标题+全文(线程内固定) → 历史(追加) → 本轮问题;
// 这样云端上下文缓存/本地 llama KV 前缀都能命中文章与历史部分, 而不是每句一个窗口、每次只命中 system。
const ASK_SYSTEM = `${SYSTEM_ROLE}\n\n回答用户关于这篇文章的追问, 用中文, 简明清楚; 若要求给出例句, 给出 3 个并标注结构。回答末尾另起一行输出 2-3 个追问, 每个以 [追问] 开头。`

const THREAD_MAX_ITEMS = 200 // 单线程最多持久化的问答条数
const ARTICLE_PROMPT_MAX = 6000 // 文章上下文最大字符数(超出截断, 防长文撑爆本地 ctx)

/** 文章上下文串(与渲染层 SentenceWorkspace.articleContext 保持一致, 用于迁移旧版全文模式会话) */
function articleContextString(title, text) {
  return `标题: ${String(title || '').trim() || '未命名文章'}\n\n${String(text || '')}`
}

function parseChatItems(json) {
  try {
    const arr = JSON.parse(json)
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.q === 'string') : []
  } catch {
    return []
  }
}

function getThreadRow(threadKey) {
  return getDb().prepare('SELECT chat_json, updated_at FROM chat_threads WHERE thread_key = ?').get(String(threadKey || ''))
}

function saveThreadItems(threadKey, items) {
  const next = (Array.isArray(items) ? items : []).slice(-THREAD_MAX_ITEMS)
  getDb()
    .prepare(
      `INSERT INTO chat_threads (thread_key, chat_json, updated_at)
       VALUES (?, ?, datetime('now','localtime'))
       ON CONFLICT(thread_key) DO UPDATE SET chat_json = excluded.chat_json, updated_at = excluded.updated_at`
    )
    .run(String(threadKey), JSON.stringify(next))
  return next
}

/** 旧版数据迁移: 逐句 chat_json(sentence_notes) + 旧版全文模式伪会话 → 合并进文章线程(首次读取时一次性) */
function legacyThreadItems(threadKey, articleTitle = '', articleText = '') {
  const db = getDb()
  const out = []
  const addRows = (rows, withSentence) => {
    for (const r of rows) {
      for (const it of parseChatItems(r.chat_json)) {
        out.push({
          q: String(it.q),
          a: it.a == null ? '' : String(it.a),
          sentence: withSentence ? r.sentence : null,
          ts: it.ts || null,
          legacy: true
        })
      }
    }
  }
  const m = /^a:(\d+)$/.exec(String(threadKey || ''))
  if (m) {
    const rows = db
      .prepare('SELECT sentence, chat_json FROM sentence_notes WHERE article_id = ? AND chat_json IS NOT NULL ORDER BY updated_at ASC')
      .all(Number(m[1]))
    // 旧版提问可能没带 article_id(仅提问过的句子): 用「句子文本出现在文章正文中」兜底归并
    if (articleText) {
      const content = String(articleText).replace(/\s+/g, ' ')
      const orphans = db.prepare('SELECT sentence, chat_json FROM sentence_notes WHERE article_id IS NULL AND chat_json IS NOT NULL').all()
      for (const r of orphans) {
        const s = String(r.sentence || '').replace(/\s+/g, ' ')
        if (s && s.length <= 400 && content.includes(s) && !rows.some((x) => x.sentence === r.sentence)) rows.push(r)
      }
    }
    addRows(rows, true)
    // 旧版全文模式: key 为「标题: ...\n\n全文」的哈希, 属于文章级会话(无句子归属)
    if (articleText) {
      const legacyHash = hashSentence(articleContextString(articleTitle, articleText))
      const row = db.prepare('SELECT chat_json FROM sentence_notes WHERE sentence_hash = ?').get(legacyHash)
      if (row) addRows([row], false)
    }
  } else if (String(threadKey).startsWith('t:')) {
    const row = db.prepare('SELECT chat_json FROM sentence_notes WHERE sentence_hash = ?').get(String(threadKey).slice(2))
    if (row) addRows([row], false)
  }
  out.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')))
  return out
}

/** 读取文章会话线程; 首次读取时自动迁移旧版逐句会话, 并写回 chat_threads */
export function getThreadChat(threadKey, { articleTitle = '', articleText = '' } = {}) {
  const key = String(threadKey || '').trim()
  if (!key) return { threadKey: '', items: [] }
  const row = getThreadRow(key)
  if (row) return { threadKey: key, items: parseChatItems(row.chat_json) }
  const legacy = legacyThreadItems(key, articleTitle, articleText)
  if (legacy.length) saveThreadItems(key, legacy)
  return { threadKey: key, items: legacy }
}

/** 构造按文章会话的提问消息: system/文章前缀字节稳定, 历史追加, 本轮问题最后 —— 缓存命中率最大化 */
export function buildThreadAskMessages({ articleTitle, articleText, history, sentence, question }) {
  const title = String(articleTitle || '').trim() || '未命名文章'
  let text = String(articleText || '').replace(/\s+/g, ' ').trim()
  if (text.length > ARTICLE_PROMPT_MAX) text = text.slice(0, ARTICLE_PROMPT_MAX) + '\n…(文章过长, 已截断)'
  const messages = [
    { role: 'system', content: ASK_SYSTEM },
    { role: 'user', content: `文章标题: ${title}\n\n文章全文:\n${text}` }
  ]
  // 历史仅取最近 6 轮; 按「当时实际发送的 user 内容」逐字重放(sent), 保证多轮前缀字节一致 → 缓存可复用
  const recent = (Array.isArray(history) ? history : []).filter((h) => h && String(h.q || '').trim()).slice(-6)
  for (const h of recent) {
    const q = String(h.q).trim()
    const content = h.sent ? String(h.sent) : (h.sentence ? `[针对句子: ${String(h.sentence).trim()}]\n` : '') + q
    messages.push({ role: 'user', content })
    const a = String(h.a || '').trim()
    if (a) messages.push({ role: 'assistant', content: a })
  }
  // 当前关注句子 + 已缓存译文/结构放在历史之后(前缀仍稳定): 保持按句提问的精度
  const focus = []
  const s = normalizeSentence(sentence)
  if (s) {
    focus.push(`当前关注句子: ${s}`)
    const cached = getCachedRow(hashSentence(s))
    if (cached?.translation) focus.push(`该句参考翻译: ${cached.translation}`)
    if (cached?.structure_json) {
      try {
        const st = JSON.parse(cached.structure_json)
        if (Array.isArray(st?.segments) && st.segments.length) {
          focus.push(`该句结构: ${st.segments.map((g) => `${g.text}[${g.type}/${g.role}/${g.tense}/${g.voice}]`).join('; ')}`)
        }
      } catch { /* 忽略损坏缓存 */ }
    }
  }
  const latestUser = `${focus.length ? focus.join('\n') + '\n\n' : ''}问题: ${String(question || '').trim()}`
  messages.push({ role: 'user', content: latestUser })
  return { title, messages, latestUser }
}

/**
 * 按文章线程流式提问: 增量经 onDelta 推送; 结束时把 {q,a,sentence,ts} 追加进线程并持久化。
 * 同一篇文章内所有句子的提问共享一个线程(跨句可见、跨会话保留), 提示词前缀稳定以复用缓存。
 */
export async function askThreadStream({ threadKey, articleTitle = '', articleText = '', sentence = null, question, onDelta, signal = null, onProgress = null }) {
  const key = String(threadKey || '').trim()
  const q = String(question || '').trim()
  if (!key) throw new Error('缺少会话标识, 请先打开一篇文章')
  if (!q) throw new Error('问题不能为空')
  const { items } = getThreadChat(key, { articleTitle, articleText })
  const { messages, latestUser } = buildThreadAskMessages({ articleTitle, articleText, history: items, sentence, question: q })

  let raw = ''
  if (chatImpl) {
    // 测试注入: 一次性整段(模拟"一个 chunk"的流)
    raw = String(await enqueue(() => chatImpl({ messages, temperature: 0.7, signal })))
    if (onDelta && raw) onDelta(raw)
  } else {
    raw = await enqueue((sig) => callChatStream({ messages, temperature: 0.7, signal: sig, onDelta }))
  }
  const answer = String(raw).trim()
  if (!answer) throw new Error('AI 返回了空回答')
  // 追问解析: [追问] xxx
  const followups = [...answer.matchAll(/\[追问\]\s*([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean).slice(0, 3)
  const cleanAnswer = answer.replace(/\n*\[追问\][\s\S]*$/, '').trim()
  const item = { q, a: cleanAnswer, sentence: normalizeSentence(sentence) || null, ts: new Date().toISOString(), sent: latestUser }
  saveThreadItems(key, [...items, item])
  log('info', 'sentence', `文章会话提问(${key}): ${q.slice(0, 30)}`)
  return { ok: true, threadKey: key, answer: cleanAnswer, followups, item }
}

/** 兼容旧调用: 单句提问按句子哈希建一个会话线程(不再写 sentence_notes.chat_json) */
export async function askSentenceStream({ sentence, question, onDelta, signal = null, onProgress = null }) {
  return askThreadStream({
    threadKey: `t:${hashSentence(normalizeSentence(sentence))}`,
    articleTitle: '',
    articleText: normalizeSentence(sentence),
    sentence: null,
    question,
    onDelta,
    signal,
    onProgress
  })
}

/** 非流式提问(委托流式实现; 测试与既有调用保持兼容) */
export async function askSentence(args) {
  return askSentenceStream(args)
}

export function clearSentenceCache() {
  const res = getDb().prepare('DELETE FROM sentence_notes').run()
  const threads = getDb().prepare('DELETE FROM chat_threads').run()
  log('info', 'sentence', `清空句子缓存: ${res.changes} 条; 清空 AI 会话线程: ${threads.changes} 条`)
  return { cleared: res.changes, threads: threads.changes }
}

/** 句子解析缓存 + 文章会话线程统计(设置页数据管理展示) */
export function getSentenceCacheStats() {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(LENGTH(COALESCE(sentence,'')) + LENGTH(COALESCE(translation,'')) + LENGTH(COALESCE(structure_json,'')) + LENGTH(COALESCE(chat_json,'')) + LENGTH(COALESCE(quiz_json,''))), 0) AS bytes,
              MAX(updated_at) AS latest,
              MIN(updated_at) AS oldest
       FROM sentence_notes`
    )
    .get()
  const threads = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(chat_json)), 0) AS bytes, MAX(updated_at) AS latest FROM chat_threads')
    .get()
  const latest = [row.latest, threads.latest].filter(Boolean).sort().pop() || null
  return {
    count: (row.count || 0) + (threads.count || 0),
    bytes: (row.bytes || 0) + (threads.bytes || 0),
    latest,
    oldest: row.oldest || null,
    sentenceCount: row.count || 0,
    threadCount: threads.count || 0
  }
}
