import { getDb, log } from '../db/database.js'
import { getSetting, setReview, getScheduleSettings } from './settings.js'
import { lookupWord } from '../dict/dictionary.js'
import { nowIso, localDayStartIso } from '../utils/time.js'

/** 去掉尾部斜杠/完整端点后缀, 得到用户填写的 baseUrl */
function stripBase(url) {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '')
}

/**
 * 由用户填写的 baseUrl 推导 OpenAI 兼容端点:
 * 已带版本号(如 https://api.openai.com/v1)直接拼接; 未带(如 https://api.deepseek.com)自动补 /v1。
 * 云端服务与用户自建的本地服务(如自启的 llama-server)一视同仁。
 */
export function resolveAiEndpoints(baseUrl) {
  const base = stripBase(baseUrl)
  if (!base) return { chat: '', models: '' }
  const apiRoot = /\/v\d+$/.test(base) ? base : `${base}/v1`
  return { chat: `${apiRoot}/chat/completions`, models: `${apiRoot}/models` }
}

/** 统一 AI 配置(唯一解析点): 任意 OpenAI 兼容地址 + Key + 模型名 */
export function getAiConfig() {
  const ai = getSetting('ai') || {}
  const num = (v, dft) => (Number.isFinite(Number(v)) ? Number(v) : dft)
  return {
    baseUrl: stripBase(ai.baseUrl) || 'https://api.deepseek.com',
    apiKey: String(ai.apiKey || '').trim(),
    model: String(ai.model || '').trim() || 'deepseek-chat',
    timeoutMs: num(ai.timeoutMs, 60000) > 0 ? num(ai.timeoutMs, 60000) : 60000,
    retry: Math.max(0, Math.min(5, num(ai.retry, 2))),
    batchSize: num(ai.batchSize, 15),
    storyWordCount: num(ai.storyWordCount, 500),
    storyStyle: ai.storyStyle || '叙事,贴近日常,适合英文学习',
    consolidateRatio: ai.consolidateRatio ?? 0.25
  }
}

function requireAiConfig() {
  const cfg = getAiConfig()
  if (!cfg.baseUrl) throw new Error('未配置 AI 接口地址, 请在「设置 → AI 设置」填写 OpenAI 兼容 baseUrl')
  if (!cfg.apiKey) throw new Error('未配置 AI API Key, 请在「设置 → AI 设置」填写')
  if (!cfg.model) throw new Error('未选择 AI 模型, 请在「设置 → AI 设置」填写模型名或点「获取模型」选择')
  return cfg
}

/** 拉取可用模型列表(GET {base}/models); 供设置页「获取模型」下拉 */
export async function listAiModels() {
  const cfg = requireAiConfigBaseUrlKey()
  // 候选端点: 先按统一规则; 若 baseUrl 带版本号其次尝试去掉版本号(部分服务只暴露根路径 /models, 如 DeepSeek 文档口径)
  const base = stripBase(cfg.baseUrl)
  const candidates = [resolveAiEndpoints(cfg.baseUrl).models]
  if (/\/v\d+$/i.test(base)) candidates.push(`${base.replace(/\/v\d+$/i, '')}/models`)
  let lastErr = null
  for (const endpoint of [...new Set(candidates)]) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 30000))
    try {
      const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: controller.signal })
      const text = await res.text().catch(() => '')
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
      let data = null
      try { data = JSON.parse(text) } catch { throw new Error('模型列表返回不是 JSON: ' + text.slice(0, 120)) }
      const raw = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : []
      const models = raw.map((m) => (typeof m === 'string' ? m : m?.id || m?.name || '')).filter(Boolean)
      if (!models.length) throw new Error('接口未返回可用模型')
      return { ok: true, models, baseUrl: cfg.baseUrl, endpoint }
    } catch (e) {
      const timeout = /aborted|abort/i.test(String(e?.name || '') + String(e?.message || ''))
      lastErr = new Error(timeout ? '请求超时' : (e.message || String(e)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`获取模型列表失败: ${lastErr?.message || '未知错误'}`)
}

/** 只校验地址+Key(模型列表/连接测试不需要已选模型) */
function requireAiConfigBaseUrlKey() {
  const cfg = getAiConfig()
  if (!cfg.baseUrl) throw new Error('未配置 AI 接口地址')
  if (!cfg.apiKey) throw new Error('未配置 AI API Key')
  return cfg
}

/** 连接测试: 优先 /models(免费); 端点不可用时退化为最小对话请求(max_tokens=1) */
export async function testAiConnection() {
  const cfg = requireAiConfigBaseUrlKey()
  let modelsErr = null
  try {
    const r = await listAiModels()
    return { ok: true, mode: 'models', models: r.models, message: `连接成功, 可用模型 ${r.models.length} 个` }
  } catch (e) {
    modelsErr = e
  }
  try {
    const sample = await callChat({ messages: [{ role: 'user', content: 'ping' }], temperature: 0, maxTokens: 1 })
    return { ok: true, mode: 'chat', models: [], model: cfg.model, sample: String(sample).slice(0, 40), message: `连接成功(模型 ${cfg.model} 可响应)` }
  } catch (e) {
    throw new Error(`${modelsErr.message}；对话测试也失败: ${e.message || e}`)
  }
}

export async function callChat({ messages, temperature = 0.8, json = false, signal = null, maxTokens = null }) {
  const cfg = requireAiConfig()
  const { chat: endpoint } = resolveAiEndpoints(cfg.baseUrl)
  const maxAttempts = Math.max(1, Math.min(5, Number.isInteger(cfg.retry) ? cfg.retry + 1 : 1))
  const started = Date.now()
  const preview = messages[0].content.slice(0, 200)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
    const onExternalAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`
        },
        body: JSON.stringify({
          model: cfg.model,
          messages,
          temperature,
          stream: false,
          ...(maxTokens ? { max_tokens: maxTokens } : {}),
          ...(json ? { response_format: { type: 'json_object' } } : {})
        }),
        signal: controller.signal
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`)
      }

      const data = await res.json()
      recordCall({ model: cfg.model, promptPreview: preview, status: 'ok', error: null, durationMs: Date.now() - started })
      return data.choices?.[0]?.message?.content ?? ''
    } catch (e) {
      if (attempt < maxAttempts) continue
      recordCall({ model: cfg.model, promptPreview: preview, status: 'error', error: e.message || String(e), durationMs: Date.now() - started })
      throw e
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onExternalAbort)
    }
  }
}

function recordCall({ model, promptPreview, status, error, durationMs }) {
  try {
    getDb()
      .prepare(
        'INSERT INTO ai_calls (model, prompt_preview, status, error, duration_ms) VALUES (?,?,?,?,?)'
      )
      .run(model, promptPreview, status, error, durationMs)
  } catch {
    /* 记录失败忽略 */
  }
}

/**
 * 流式对话: SSE 增量经 onDelta(deltaText) 推送; 服务端不支持流式(application/json)时
 * 回退为一次性整段推送。返回完整文本。不重试(流中途重试会重复输出)。
 */
export async function callChatStream({ messages, temperature = 0.8, signal = null, onDelta }) {
  const cfg = requireAiConfig()
  const { chat: endpoint } = resolveAiEndpoints(cfg.baseUrl)
  const started = Date.now()
  const preview = messages[0].content.slice(0, 200)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)
  const onExternalAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, messages, temperature, stream: true }),
      signal: controller.signal
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 500)}`)
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('application/json')) {
      // 非流式响应(测试 mock 等): 整段一次性推送
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content ?? ''
      if (onDelta && content) onDelta(content)
      recordCall({ model: cfg.model, promptPreview: preview, status: 'ok', error: null, durationMs: Date.now() - started })
      return content
    }

    // SSE: data: {...} 行, delta 字段增量拼接; [DONE] 结束
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const obj = JSON.parse(payload)
          const delta = obj.choices?.[0]?.delta?.content
          if (delta) {
            full += delta
            onDelta?.(delta)
          }
        } catch { /* 忽略损坏行 */ }
      }
    }
    recordCall({ model: cfg.model, promptPreview: preview, status: 'ok', error: null, durationMs: Date.now() - started })
    return full
  } catch (e) {
    recordCall({ model: cfg.model, promptPreview: preview, status: 'error', error: e.message || String(e), durationMs: Date.now() - started })
    throw e
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onExternalAbort)
  }
}

/** 词条难度分级(基于 ECDICT 词频) */
function difficultyHint(word) {
  const entry = lookupWord(word)
  if (!entry) return '普通词汇'
  const { bnc, frq, tag, collins } = entry
  if (collins && collins >= 5) return '高频基础词'
  if (bnc && bnc < 3000) return 'BNC高频词'
  if (frq && frq < 3000) return '当代高频词'
  if (tag && /cet[46]|ky|gk|zk/i.test(tag)) return '中高考/四六级词汇'
  return '中低频词'
}

/**
 * 解析词典 exchange 字段得到词的常见词形变化
 * (如 perceive → perceived/perceives/perceiving), 用于校验 AI 故事是否真的写入了目标词。
 */
function wordForms(w) {
  const forms = new Set()
  const base = String(w.lemma || w.word || '').toLowerCase().trim()
  if (base) forms.add(base)
  const entry = lookupWord(w.lemma || w.word)
  const exchange = entry?.exchange || ''
  for (const part of exchange.split('/')) {
    const m = part.match(/^[a-z0-9]+:(.+)$/i)
    if (m && m[1]) forms.add(m[1].toLowerCase().trim())
  }
  // 太短的词形(如复数 "s")误报率太高, 丢弃; 保留原型长度 ≥3 的
  return [...forms].filter((f) => f.length >= 3)
}

/** 校验故事内容是否包含目标词(任一词形); 返回 { included, missing } */
export function verifyStoryCoverage(content, targetWords) {
  const body = String(content || '').toLowerCase()
  const included = []
  const missing = []
  for (const w of targetWords) {
    const forms = wordForms(w)
    const hit = forms.some((f) => body.includes(f))
    if (hit) included.push(w)
    else missing.push(w)
  }
  return { included, missing }
}

/**
 * 解析模型输出的故事文本: 提取首行 `# 标题`, 并清洗 Markdown 标记(双星号加粗/下划线/删除线/反引号/单星号)。
 * 阅读区为纯文本渲染: 星号包裹的词既显示难看, 又会把目标词包裹成标点块导致复习高亮(下划线+色块底)失效。
 */
export function parseStoryOutput(raw) {
  let t = String(raw || '').trim()
  let title = null
  const m = t.match(/^\s*#\s*(.+?)\s*$/m)
  if (m) {
    title = m[1].replace(/[*_`#]/g, '').trim() || null
    t = t.replace(/^\s*#\s*.+?$/m, '')
  }
  const body = t
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/~~/g, '')
    .replace(/`/g, '')
    .replace(/(?<!\*)\*(?!\*)/g, '')
    .trim()
  return { title, body }
}

/** 句界裁剪到 maxWords 内(至少保留首句); 模型不服从词数约束时的兜底 */
export function trimStoryToLimit(text, maxWords) {
  const parts = String(text).match(/[^.!?]+[.!?]*/g) || []
  const count = (t) => (String(t).match(/[A-Za-z''-]+/g) || []).length
  let out = ''
  for (const p of parts) {
    if (count((out + p).trim()) > maxWords) break
    out += p
  }
  const trimmed = out.trim()
  return count(trimmed) > 0 ? trimmed : (parts[0]?.trim() || String(text))
}

/**
 * 逐词补写遗漏词: 给模型故事结尾上下文, 要求顺着同一故事续写一小段(60-120 词)。
 * 此前只给"补充故事"指令且无上下文, 模型会另起炉灶写一篇新故事, 拼进正文形成两个独立片段。
 * 返回更新后的 { storyText, included, missing }。
 */
async function fillMissingWords({ storyText, missing, included }) {
  const missList = missing.map((w) => w.lemma || w.word).join(', ')
  const tail = String(storyText).slice(-500)
  const fillPrompt = `下面是已生成故事的结尾:\n<STORY_END>\n${tail}\n</STORY_END>\n\n上面的故事遗漏了以下单词: ${missList}。\n请顺着故事结尾续写一小段(60-120 词), 自然地延续同一故事的情节与人物; 必须包含上面列出的每个单词(每个至少出现 1 次, 允许词形变化)。\n只输出续写段落正文, 不要另起炉灶写新故事, 不要任何解释, 不要 Markdown 格式标记。`
  try {
    const extra = await callChat({ messages: [{ role: 'user', content: fillPrompt }], temperature: 0.85 })
    const extraText = parseStoryOutput(extra).body
    const { included: inc2, missing: miss2 } = verifyStoryCoverage(extraText, missing)
    if (inc2.length) {
      const nextText = storyText + '\n\n' + extraText
      const nextIncluded = [...included, ...inc2]
      log('info', 'ai', `AI 故事续写补词成功: 补上 ${inc2.length} 个遗漏词`)
      return { storyText: nextText, included: nextIncluded, missing: miss2 }
    }
  } catch (e) {
    log('warn', 'ai', '续写补词失败, 保持当前结果', { error: e.message })
  }
  return { storyText, included, missing }
}

/**
 * AI 生成复习故事。
 * words: 目标生词数组; sourceArticle: 来源原文(难度参考); style: 风格描述; difficulty: 难度档位
 */
export async function generateStory({ words = [], sourceArticle, style, difficulty, consolidateWords = [], force = false }) {
  const cfg = getAiConfig()
  if (!Array.isArray(words) || !words.length) {
    throw new Error('没有可生成故事的单词')
  }
  const target = words.slice(0, cfg.batchSize)
  const db = getDb()

  // 巩固词: 未显式提供时按 consolidateRatio 从熟词池自动抽取(间隔复习的新旧混编原则)
  if (!consolidateWords || !consolidateWords.length) {
    const ratio = Math.max(0, Math.min(0.5, Number(cfg.consolidateRatio) || 0))
    const n = Math.max(0, Math.min(10, Math.round(target.length * ratio)))
    if (n > 0) {
      const targetLemmas = new Set(target.map((w) => String(w.lemma || w.word || '').toLowerCase()))
      consolidateWords = db
        .prepare("SELECT id, lemma, display FROM words WHERE status = 'fluent' ORDER BY RANDOM() LIMIT ?")
        .all(Math.min(60, n * 4))
        .filter((w) => !targetLemmas.has(String(w.lemma || '').toLowerCase()))
        .slice(0, n)
    }
  }

  // 故事缓存: 同一批词 7 天内不重复生成(避免中途退出/重进反复付费调用)。
  // 指纹 = 请求词集(flow_id 与查询键一致, 否则遗漏词场景永远打不中缓存);
  // 命中后用 word_ids 还原实际写入的词, 遗漏词因下轮请求集不同自然重新生成。
  // force=true(用户手动「重新生成」)绕过缓存强制重推理。
  const wordKey = target.map((w) => String(w.id ?? w.lemma ?? w.word)).sort().join('|')
  if (!force) {
    const cached = db
      .prepare(
        `SELECT story, word_ids, title FROM review_sessions
         WHERE type = 'story' AND flow_id = ?
           AND started_at >= datetime('now','localtime','-7 days')
         ORDER BY id DESC LIMIT 1`
      )
      .get(wordKey)
    if (cached && cached.story) {
      let ids = []
      try { ids = JSON.parse(cached.word_ids || '[]') } catch { ids = [] }
      const idSet = new Set(ids.map(String))
      const included = target.filter((w) => idSet.has(String(w.id ?? w.lemma ?? w.word)))
      const missing = target.filter((w) => !idSet.has(String(w.id ?? w.lemma ?? w.word)))
      // 旧缓存(无 title 列/带 Markdown 标记)命中时清洗, 与新生成口径一致
      const cleaned = parseStoryOutput(cached.story)
      log('info', 'ai', `AI 故事命中缓存: ${included.length}/${target.length} 词`)
      return { title: cached.title || cleaned.title || null, content: cleaned.body, words: included, missing, cached: true }
    }
  }

  const targetList = target
    .map((w) => {
      const hint = difficultyHint(w.lemma || w.word)
      return `- ${w.lemma || w.word}(${hint})`
    })
    .join('\n')

  const consolidates =
    consolidateWords && consolidateWords.length
      ? consolidateWords.map((w) => w.lemma || w.word).join(', ')
      : ''

  // 难度参考: 显式难度档位 或 来源原文 或 动态学习档位(设置 ai.storyDifficulty)
  const storyBand = resolveStoryBand()
  const storyProfile = (getSetting('ai') || {}).storyDifficulty === 'auto' ? getLearnerProfile() : null
  const bandDirective = storyDifficultyDirective(storyBand, storyProfile)
  const difficultyPart = (() => {
    if (difficulty) {
      return `\n故事难度设为: ${difficulty}。${bandDirective}`
    }
    const sourceText = sourceArticle
      ? sourceArticle.cleaned_content || sourceArticle.content
      : ''
    if (sourceText) {
      const excerpt = sourceText.slice(0, 1500)
      return `\n请参考下面这篇来源文章的风格与词汇难度(不要比它明显更难或更简单):\n<SOURCE>\n${excerpt}\n</SOURCE>\n${bandDirective}`
    }
    return `\n请使用与目标词汇量相匹配的难度。${bandDirective}`
  })()

  // 风格: 参数优先, 其次设置里配置的风格
  const styleDesc = style || cfg.storyStyle || '叙事,贴近日常,适合英文学习'
  // 长度硬上限: 设置目标词数 ±30%, 超限触发整体重写(模型对"约 N 词"软约束经常超写)
  const maxWords = Math.max(100, Math.round((Number(cfg.storyWordCount) || 500) * 1.3))
  // 分段词数预算: 给模型可数的小单位(约 N/50 段 × 每段 N/段数 词), 显著提升长度服从率
  const paraCount = Math.max(2, Math.round((Number(cfg.storyWordCount) || 500) / 50))
  const perPara = Math.round((Number(cfg.storyWordCount) || 500) / paraCount)

  const prompt = `你是一名英语学习内容创作者。请根据给定词汇生成一篇英文小故事, 用于英语学习者复习单词。

要求:
1. 必须自然地包含下面列出的每个目标单词(每个至少出现 1 次, 允许出现其词形变化)。写完故事后, 请逐词对照目标词汇表自查一遍, 确保一个都不少; 遗漏任何一个都会被判定为不合格。
2. 故事长度严格控制在约 ${cfg.storyWordCount} 词(硬性上限 ${maxWords} 词, 超过即不合格)。${cfg.storyWordCount} 词 ≈ ${paraCount} 个短段落(每段约 ${perPara} 词); 写完数一遍词数, 超过上限必须删减到上限以内。情节需在此长度内完整收尾。
3. 语言地道、情节完整、有读下去的趣味性, 适合作为每日阅读。
4. 第一行输出故事标题(以 # 开头, 标题与正文都不要加粗), 其后输出故事正文; 不要输出任何解释或额外说明; 全文不要使用 Markdown 格式标记(如 ** 加粗)。
5. 使用原句/真实语境呈现单词, 不要机械罗列单词。
6. 故事风格: ${styleDesc}。
${consolidates ? `7. 可以顺带自然地融入这些巩固词汇(它们已学过, 出现即可): ${consolidates}` : ''}
${difficultyPart}

目标词汇:
${targetList}
`

  const content = await callChat({ messages: [{ role: 'user', content: prompt }], temperature: 0.85 })
  // 提取标题 + 清洗 Markdown: 正文用于覆盖校验、缓存与纯文本阅读区展示
  const { title: storyTitle, body } = parseStoryOutput(content)
  let storyText = body
  // 校验 AI 是否真的把目标词写进了故事: 遗漏的词保持到期留待下轮,
  // 否则读完判定会把这些"根本没出现"的词白记一次认识
  let { included, missing } = verifyStoryCoverage(storyText, target)
  if (!included.length) {
    throw new Error('AI 返回的内容没有包含任何目标词汇, 请重试')
  }
  // 遗漏修复(理想状态: 全部目标词写入故事):
  // 1) 遗漏 > 60% → 整篇以更严格指令重生成一次(逐词补写会支离破碎, 重生成更连贯);
  // 2) 仍有遗漏 → 顺着故事结尾续写补词(带结尾上下文, 禁止另起炉灶);
  // 3) 仍无法写入的词留待下轮复习(不白记认识)。
  if (missing.length && missing.length / target.length > 0.6) {
    const missList = missing.map((w) => w.lemma || w.word).join(', ')
    const retryPrompt = prompt + `\n\n注意: 上一次生成遗漏了这些单词: ${missList}。请重新生成完整故事, 并在输出前逐词对照目标词汇表自查, 确保上面每个单词都至少出现 1 次。`
    try {
      const again = await callChat({ messages: [{ role: 'user', content: retryPrompt }], temperature: 0.85 })
      const retried = parseStoryOutput(again)
      const cov = verifyStoryCoverage(retried.body, target)
      // 仅在覆盖不劣于首次时采用重生成结果
      if (cov.included.length >= included.length) {
        storyText = retried.body
        included = cov.included
        missing = cov.missing
        log('info', 'ai', `AI 故事整体重生成: 覆盖 ${included.length}/${target.length} 词`)
      }
    } catch (e) {
      log('warn', 'ai', '故事整体重生成失败, 保持首次结果', { error: e.message })
    }
  }
  // 长度约束(先于补词解决: 重写指令本身要求保留全部目标词):
  // 超硬上限 → 逐步加严重写(≤2 次); 仍超限则句界裁剪兜底(硬保证设置生效)。
  const lenOf = (t) => (String(t).match(/[A-Za-z''-]+/g) || []).length
  if (lenOf(storyText) > maxWords) {
    let lenAttempts = 0
    while (lenOf(storyText) > maxWords && lenAttempts < 2) {
      lenAttempts++
      const strict = lenAttempts === 2 ? '宁可更短不可更长, 超出即删减。' : ''
      const lenRetryPrompt = prompt + `\n\n注意: 你上一次输出的故事约 ${lenOf(storyText)} 词, 远超 ${maxWords} 词的硬性上限。请重写整个故事: ${strict}严格控制在 ${cfg.storyWordCount} 词左右(不超过 ${maxWords} 词), 情节完整收尾, 并且上面列出的每个目标单词仍必须出现。`
      try {
        const again = await callChat({ messages: [{ role: 'user', content: lenRetryPrompt }], temperature: 0.85 })
        const retried = parseStoryOutput(again)
        const cov = verifyStoryCoverage(retried.body, target)
        // 仅在长度合规且覆盖不劣于当前时采用重写结果
        if (lenOf(retried.body) <= maxWords && cov.included.length >= included.length) {
          storyText = retried.body
          if (retried.title) storyTitle = retried.title
          included = cov.included
          missing = cov.missing
          log('info', 'ai', `AI 故事长度超限重写(第 ${lenAttempts} 次): ${lenOf(storyText)} 词`)
          break
        }
      } catch (e) {
        log('warn', 'ai', '故事长度重写失败, 保持当前结果', { error: e.message })
        break
      }
    }
    if (lenOf(storyText) > maxWords) {
      // 兜底: 模型不服从词数约束时按句界裁剪到上限内(至少保留首句), 覆盖随裁剪结果重算
      const trimmed = trimStoryToLimit(storyText, maxWords)
      if (trimmed !== storyText) {
        storyText = trimmed
        const cov = verifyStoryCoverage(storyText, target)
        included = cov.included
        missing = cov.missing
        log('info', 'ai', `AI 故事超长兜底裁剪: ${lenOf(storyText)} 词`)
      }
    }
  }
  // 补词: 在长度已合规的文本上续写(60-120 词); 续写后终裁一次——此前续写发生在长度闸之后且不再裁剪, 是超长复发的根因
  if (missing.length) {
    const filled = await fillMissingWords({ storyText, missing, included })
    storyText = filled.storyText
    included = filled.included
    missing = filled.missing
  }
  if (lenOf(storyText) > maxWords) {
    const trimmed = trimStoryToLimit(storyText, maxWords)
    if (trimmed !== storyText) {
      storyText = trimmed
      const cov = verifyStoryCoverage(storyText, target)
      included = cov.included
      missing = cov.missing
      log('info', 'ai', `AI 故事续写后终裁: ${lenOf(storyText)} 词`)
    }
  }
  // 缓存落库: flow_id 统一存请求词集(与查询键一致, 遗漏词场景才能命中缓存);
  // word_ids 只记录实际写进故事的词, 命中时据此还原 included/missing; title 独立列供工具栏显示
  const includedIds = included.map((w) => String(w.id ?? w.lemma ?? w.word)).sort()
  try {
    db.prepare(
      `INSERT INTO review_sessions (flow_id, type, story, word_ids, title, started_at, ended_at)
       VALUES (?, 'story', ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))`
    ).run(wordKey, storyText, JSON.stringify(includedIds), storyTitle)
  } catch (e) {
    log('warn', 'ai', '故事缓存写入失败(不影响使用)', { error: e.message })
  }
  return { title: storyTitle, content: storyText, words: included, missing, cached: false }
}

// ---------- 动态难度策略(设置页可调: 按学习者画像优化提示词) ----------

/** 难度档位: 词汇上限(词频排名, 越小越常用) + 平均句长上限 */
export const STORY_DIFFICULTY_BANDS = {
  basic: { key: 'basic', label: '基础', cap: 3000, maxSentLen: 12 },
  standard: { key: 'standard', label: '标准', cap: 5000, maxSentLen: 16 },
  advanced: { key: 'advanced', label: '进阶', cap: 8000, maxSentLen: 20 }
}

/** 由学习者平均词频(越小越常用)推断档位: <4000 基础; <12000 标准; 其余进阶 */
export function bandForLearner(avgFrq) {
  if (!Number.isFinite(avgFrq) || avgFrq <= 0) return 'basic'
  if (avgFrq < 4000) return 'basic'
  if (avgFrq < 12000) return 'standard'
  return 'advanced'
}

/**
 * 学习者画像: 词库规模 + 平均词频排名 + 最近文章平均句长 → 用于「自动」档提示词优化。
 * 词典不可用/无数据时返回 null 字段, 自动档回退 basic。
 */
export function getLearnerProfile() {
  const db = getDb()
  const rows = db
    .prepare("SELECT lemma FROM words WHERE status IN ('new','learning','fluent') ORDER BY updated_at DESC LIMIT 500")
    .all()
  const frqs = []
  for (const w of rows) {
    const f = Number(lookupWord(w.lemma)?.frq) || 0
    if (f > 0) frqs.push(f)
  }
  const avgFrq = frqs.length ? Math.round(frqs.reduce((a, b) => a + b, 0) / frqs.length) : null
  const recent = db
    .prepare('SELECT cleaned_content, content FROM articles ORDER BY id DESC LIMIT 5')
    .all()
  const lens = []
  for (const a of recent) {
    const text = a.cleaned_content || a.content || ''
    for (const s of text.split(/[.!?]+/)) {
      const n = (s.match(/[A-Za-z''-]+/g) || []).length
      if (n > 0) lens.push(n)
    }
  }
  const avgSentLen = lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : null
  const bandKey = bandForLearner(avgFrq)
  const band = STORY_DIFFICULTY_BANDS[bandKey]
  return {
    wordCount: rows.length,
    sampledWords: rows.length,
    avgFrq,
    avgSentLen,
    band: bandKey,
    bandLabel: band.label,
    cap: band.cap,
    maxSentLen: band.maxSentLen
  }
}

/** 当前生效的难度档位(设置 storyDifficulty: auto 时按画像推断) */
function resolveStoryBand() {
  const mode = (getSetting('ai') || {}).storyDifficulty || 'auto'
  if (mode !== 'auto' && STORY_DIFFICULTY_BANDS[mode]) return STORY_DIFFICULTY_BANDS[mode]
  const prof = getLearnerProfile()
  return STORY_DIFFICULTY_BANDS[bandForLearner(prof.avgFrq)]
}

/** 难度约束指令(注入故事提示词; 覆盖静态"3000 词"文案, 随档位/画像动态变化) */
function storyDifficultyDirective(band, profile) {
  const note = profile && profile.avgFrq != null
    ? `(学习者画像: 词库 ${profile.wordCount} 词, 平均词频排名 ${profile.avgFrq}; 最近文章平均句长 ${profile.avgSentLen ?? '—'} 词)`
    : ''
  return `词汇难度约束(${band.label}档): 除目标词和巩固词外, 其余词汇必须控制在词频前 ${band.cap} 的常用词以内, 严禁生僻词、低频词; 句子以简单清晰的短句为主, 平均句长不超过 ${band.maxSentLen} 词。${note}`
}

/**
 * AI 基于近 15 天学习数据调整艾宾浩斯间隔表。
 * 返回建议, 不自动应用。
 */
export async function adjustScheduleWithAi() {
  const db = getDb()
  const days = 15
  const { newbie, fluent } = getScheduleSettings()

  // 汇总学习数据
  // review_results.created_at 为 UTC ISO(统计口径统一后), 用 UTC 边界;
  // words.updated_at 仍为本地时间文本, 其查询继续用 datetime('now','localtime') 边界
  const results = db
    .prepare(
      `SELECT result, COUNT(*) as cnt FROM review_results WHERE created_at >= datetime('now','-15 days') GROUP BY result`
    )
    .all()
  const stats = {}
  for (const r of results) stats[r.result] = r.cnt

  const wordStats = db
    .prepare(
      `SELECT status, COUNT(*) as cnt FROM words WHERE updated_at >= datetime('now','localtime','-15 days') GROUP BY status`
    )
    .all()

  const summary = {
    period: `${days} 天`,
    reviewResults: stats,
    wordStatus: wordStats,
    totalWords: db.prepare('SELECT COUNT(*) as c FROM words').get().c,
    // 本地日界: 与 dueWords 判定保持一致
    dueToday: db.prepare("SELECT COUNT(*) as c FROM words WHERE status IN ('new','learning','fluent') AND due_at IS NOT NULL AND due_at < ?").get(localDayStartIso(1)).c
  }

  const prompt = `你是一名认知科学专家。以下是某英语学习软件近 15 天的复习数据:

${JSON.stringify(summary, null, 2)}

当前使用的艾宾浩斯间隔表:
- 生词阶段(天): ${JSON.stringify(newbie)}
- 熟词阶段(天): ${JSON.stringify(fluent)}

请根据学习者的实际掌握情况, 给出调整建议。只输出 JSON, 格式如下:
{
  "newbie": ${JSON.stringify(newbie)},
  "fluent": ${JSON.stringify(fluent)},
  "reason": "一句话说明调整理由(中文)"
}
原则: 复习正确率高且稳定 → 适当延长间隔; 正确率低/频繁打回 → 缩短间隔; 不要剧烈变化(每档 ±1~3 天)。`

  const content = await callChat({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, json: true })
  // AI 偶尔会用 ```json 围栏包裹, 直接 JSON.parse 会失败
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const parsed = JSON.parse(cleaned)
  // fluent 默认表只有 5 档, 原校验写死 length===6 会把 AI 原样返回的合法熟词表判为非法
  const validate = (arr) =>
    Array.isArray(arr) &&
    arr.length >= 3 &&
    arr.length <= 12 &&
    arr.every((n, i) => Number.isInteger(n) && n >= 1 && n <= 365 && (i === 0 || n >= arr[i - 1]))
  if (!validate(parsed.newbie) || !validate(parsed.fluent)) {
    throw new Error('AI 返回的间隔表格式不合法')
  }

  // 建议不自动应用; 记录 lastAiAdjust 供 shouldAdjustSchedule 判定周期
  const review = getSetting('review') || {}
  setReview({
    ...review,
    newbie: review.newbie || newbie,
    fluent: review.fluent || fluent,
    lastAiAdjust: nowIso()
  })

  log('info', 'ai', 'AI 间隔调整建议已生成')
  return {
    ok: true, // 渲染层 runAdjust 依赖 ok 字段判定成功(此前缺失 → 建议被当失败处理, 应用按钮不显示)
    newbie: parsed.newbie,
    fluent: parsed.fluent,
    reason: parsed.reason || ''
  }
}

/** 15 天周期的 AI 调整检查 */
export function shouldAdjustSchedule() {
  const review = getSetting('review') || {}
  const last = review.lastAiAdjust ? new Date(review.lastAiAdjust) : null
  // 从未调整过 → 允许(首次可用); 否则按 15 天周期
  if (!last || isNaN(last.getTime())) return true
  return Date.now() - last.getTime() >= 15 * 24 * 60 * 60 * 1000
}
