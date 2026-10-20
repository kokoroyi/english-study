import { getDb } from '../db/database.js'
import { addDays, localDayStartIso, localDayEndIso } from '../utils/time.js'
import { STATUS } from './words.js'

export const DEFAULT_SETTINGS = {
  ai: {
    // 统一 OpenAI 兼容接口: 任意服务地址 + Key + 模型(云端/用户自建本地服务一视同仁)
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'deepseek-chat',
    timeoutMs: 60000,
    retry: 2,
    batchSize: 15,
    storyWordCount: 500,
    stylePreset: '',
    storyStyle: '叙事,贴近日常,适合英文学习',
    storyTemplates: ['冒险', '悬疑', '科幻', '日常', '科普', '童话'],
    consolidateRatio: 0.25, // 巩固词混入比例
    storyDifficulty: 'auto' // 故事难度策略: auto(按学习者画像) | basic | standard | advanced
  },
  review: {
    newbie: [1, 2, 4, 7, 15, 30],
    fluent: [7, 15, 30, 60, 90],
    promoteAfterKnown: 3, // 连续认识几次升熟词
    lastAiAdjust: null,
    dailyLimit: 0, // 每日复习上限(0=不限), 超出部分顺延
    dailyNewLimit: 0, // 每日新词配额(0=不限), 超配额的当天新词首复顺延一天
    orderStrategy: 'overdue' // overdue=最逾期优先 | newFirst=新词优先
  },
  appearance: {
    theme: 'light',
    fontScale: 1,
    lineHeight: 1.7,
    highlightColor: '#fef3c7', // 淡黄
    adhd: {
      // 单一模式: 'semantic' 语义增强 | 'bionic' 仿生阅读 | 'off' 普通阅读
      // (历史数据只有 semanticEnabled/bionicEnabled 两个布尔, getSettings 会归一化并回填 mode)
      mode: 'bionic',
      bionicEnabled: true,
      splitRatio: 0.35,
      leadScale: 1.12,
      letterSpacing: 0.04,
      wordSpacing: 0.1,
      baseScale: 1.08,
      semanticEnabled: false, // 兼容旧字段, 由 mode 同步(不再作为独立开关)
      semanticDensity: 0.25
    }
  },
  dict: {
    path: '',
    definitionLang: 'both' // both | en | zh
  },
  behavior: {
    sessionMinSeconds: 30, // 有效会话阈值
    idleTimeoutSeconds: 300, // 闲置多少秒暂停计时
    dailyReminder: true
  },
  quiz: {
    questionsPerBatch: 3, // 每批题数(3/4/5)
    difficulty: 2, // 1 基础 | 2 标准 | 3 挑战
    judgeMode: 'immediate' // immediate 即时判分 | afterAll 交卷后判分
  }
}

export function getSettings() {
  const db = getDb()
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const merged = structuredClone(DEFAULT_SETTINGS)
  let storedAppearance = null
  for (const r of rows) {
    try {
      const val = JSON.parse(r.value)
      if (r.key === 'appearance' && val && typeof val === 'object') storedAppearance = val
      if (typeof val === 'object' && val !== null) {
        merged[r.key] = deepMerge(merged[r.key] || {}, val)
      } else {
        merged[r.key] = val
      }
    } catch {
      merged[r.key] = r.value
    }
  }
  // 防御: 历史数据可能只存了 appearance 的局部(如仅有 theme), 或 adhd 子对象被部分覆盖
  merged.appearance = deepMerge(structuredClone(DEFAULT_SETTINGS.appearance), merged.appearance)
  // 关键: 默认值里已有 mode, 不能仅凭合并结果判断; 必须看库里是否真的存过 mode,
  // 否则旧数据(只有 semanticEnabled/bionicEnabled)会被默认 mode 覆盖, 选中的语义模式失效。
  normalizeAdhdMode(merged.appearance, storedAppearance?.adhd || null)
  return merged
}

/** ADHD 阅读模式归一化: 统一为单一 mode, 并同步旧布尔字段(兼容旧数据与旧渲染路径) */
export function normalizeAdhdMode(appearance, storedAdhd = null) {
  const adhd = appearance?.adhd
  if (!adhd || typeof adhd !== 'object') return appearance
  const legacy = storedAdhd && typeof storedAdhd === 'object'
  const storedHasMode = legacy && ['semantic', 'bionic', 'off'].includes(storedAdhd.mode)
  const storedHasLegacyBooleans = legacy && ('semanticEnabled' in storedAdhd || 'bionicEnabled' in storedAdhd)
  if (!storedHasMode && storedHasLegacyBooleans) {
    // 旧库只有两个布尔: 以此为准(语义优先), 而不是默认的 bionic
    adhd.mode = storedAdhd.semanticEnabled ? 'semantic' : (storedAdhd.bionicEnabled ? 'bionic' : 'off')
  } else if (!['semantic', 'bionic', 'off'].includes(adhd.mode)) {
    adhd.mode = adhd.semanticEnabled ? 'semantic' : (adhd.bionicEnabled ? 'bionic' : 'off')
  }
  adhd.semanticEnabled = adhd.mode === 'semantic'
  adhd.bionicEnabled = adhd.mode === 'bionic'
  return appearance
}

/** 深合并(仅普通对象; 数组直接替换)。用于保证嵌套默认值不因局部存储而丢失 */
function deepMerge(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v)
    } else {
      out[k] = v
    }
  }
  return out
}

export function getSetting(key) {
  return getSettings()[key]
}

/** 校验间隔表: 非空数组、每项 1..365 的有限数 */
export function isValidIntervalTable(arr) {
  return Array.isArray(arr) && arr.length > 0 && arr.every((n) => Number.isFinite(n) && n >= 1 && n <= 365)
}

export function setSetting(key, value) {
  const existing = getSettings()
  let next
  if (typeof existing[key] === 'object' && existing[key] !== null) {
    next = { ...existing[key], ...value }
  } else {
    next = value
  }
  // 复习间隔表是核心数据结构: 空表/非法值会让 due_at 变成 NaN 日期、词永远不出现
  if (key === 'review') {
    if (!isValidIntervalTable(next.newbie)) throw new Error('生词阶段间隔表无效: 需为 1~365 天的数字列表(如 1, 2, 4, 7, 15, 30)')
    if (!isValidIntervalTable(next.fluent)) throw new Error('熟词阶段间隔表无效: 需为 1~365 天的数字列表(如 7, 15, 30, 60, 90)')
    // promoteAfterKnown 为 0/空时 knownCount >= 0 恒真, 首次认识就跳过整个生词阶段直升熟词
    if (!Number.isInteger(next.promoteAfterKnown) || next.promoteAfterKnown < 1 || next.promoteAfterKnown > 30) {
      throw new Error('连续认识升熟词次数无效: 需为 1~30 的整数')
    }
    if (!Number.isInteger(next.dailyLimit) || next.dailyLimit < 0 || next.dailyLimit > 5000) {
      throw new Error('每日复习上限无效: 需为 0~5000 的整数(0=不限)')
    }
    if (!Number.isInteger(next.dailyNewLimit) || next.dailyNewLimit < 0 || next.dailyNewLimit > 1000) {
      throw new Error('每日新词配额无效: 需为 0~1000 的整数(0=不限)')
    }
    if (!['overdue', 'newFirst'].includes(next.orderStrategy)) {
      throw new Error('复习顺序策略无效: 需为 overdue 或 newFirst')
    }
  }
  if (key === 'ai') {
    if (typeof next.baseUrl !== 'string' || !next.baseUrl.trim()) throw new Error('AI 接口地址不能为空(如 https://api.deepseek.com 或 https://api.openai.com/v1)')
    try { new URL(next.baseUrl.trim()); } catch { throw new Error('AI 接口地址格式无效, 需以 http:// 或 https:// 开头') }
    if (typeof next.apiKey !== 'string') throw new Error('API Key 格式无效')
    if (!String(next.model || '').trim()) throw new Error('模型名不能为空, 可点「获取模型」从接口读取或手动填写')
    if (!Number.isInteger(next.timeoutMs) || next.timeoutMs < 1000 || next.timeoutMs > 600000) {
      throw new Error('超时时间无效: 需为 1000~600000 的整数(毫秒)')
    }
    if (!Number.isInteger(next.retry) || next.retry < 0 || next.retry > 5) {
      throw new Error('重试次数无效: 需为 0~5 的整数')
    }
  }
  if (key === 'quiz') {
    if (![3, 4, 5].includes(next.questionsPerBatch)) throw new Error('每批题数无效: 需为 3/4/5')
    if (![1, 2, 3].includes(next.difficulty)) throw new Error('难度无效: 需为 1(基础)/2(标准)/3(挑战)')
    if (!['immediate', 'afterAll'].includes(next.judgeMode)) throw new Error('判分方式无效: 需为 immediate 或 afterAll')
  }
  if (key === 'appearance') {
    // 旧调用方可能只改 semanticEnabled/bionicEnabled 两个布尔: 先折算成单一 mode 再归一化
    const patchAdhd = value?.adhd
    if (next.adhd && patchAdhd && !('mode' in patchAdhd)) {
      if (patchAdhd.semanticEnabled === true) next.adhd.mode = 'semantic'
      else if (patchAdhd.bionicEnabled === true) next.adhd.mode = 'bionic'
      else if (patchAdhd.semanticEnabled === false && patchAdhd.bionicEnabled === false) next.adhd.mode = 'off'
    }
    normalizeAdhdMode(next)
  }
  upsertSetting(key, next)

  // 间隔表变更 → 重算所有词的 due_at, 避免"改长间隔后旧词提前到期"
  // 表未变时 recomputeDueFromSchedule 内部提前返回, 零成本
  if (key === 'review') {
    recomputeDueFromSchedule(existing[key] || {}, next)
  }
  return next
}

function upsertSetting(key, value) {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, JSON.stringify(value))
}

export function setSettings(values) {
  // 先整体校验 review, 避免"ai/appearance 已写入、review 抛错"的半保存状态
  if (values.review && typeof values.review === 'object') {
    const mergedReview = { ...(getSetting('review') || {}), ...values.review }
    if (!isValidIntervalTable(mergedReview.newbie)) {
      throw new Error('生词阶段间隔表无效: 需为 1~365 天的数字列表(如 1, 2, 4, 7, 15, 30)')
    }
    if (!isValidIntervalTable(mergedReview.fluent)) {
      throw new Error('熟词阶段间隔表无效: 需为 1~365 天的数字列表(如 7, 15, 30, 60, 90)')
    }
    if (!Number.isInteger(mergedReview.promoteAfterKnown) || mergedReview.promoteAfterKnown < 1 || mergedReview.promoteAfterKnown > 30) {
      throw new Error('连续认识升熟词次数无效: 需为 1~30 的整数')
    }
  }
  const out = {}
  for (const [k, v] of Object.entries(values)) {
    out[k] = setSetting(k, v)
  }
  return out
}

/** 获取艾宾浩斯间隔表(非法/缺失时回退默认表, 防止调用方拿到空数组) */
export function getScheduleSettings() {
  const review = getSetting('review') || {}
  const newbie = isValidIntervalTable(review.newbie) ? review.newbie : DEFAULT_SETTINGS.review.newbie
  const fluent = isValidIntervalTable(review.fluent) ? review.fluent : DEFAULT_SETTINGS.review.fluent
  return { newbie, fluent }
}

/** 覆盖式设置 review 键(用于 AI 间隔调整落库, 不触发 interval-change 重算) */
export function setReview(value) {
  upsertSetting('review', value)
  return value
}

/**
 * 间隔表变更后重算所有词的 due_at(迁移自 review.js, 打破 settings↔review 模块环)。
 * 只重算未来日期(已到期词保持今天到期, 避免"改完设置今日待复习清零"的突兀感)。
 * 上次复习/标记事件时刻 ≈ due_at - 旧间隔, 新 due = 事件时刻 + 新间隔。
 * oldSchedule/newSchedule: 变更前后的 { newbie, fluent }。
 */
export function recomputeDueFromSchedule(oldSchedule, newSchedule) {
  // 防御: 变更前的表缺失时回退默认表(否则旧间隔视为 undefined, 事件时刻推算错误, due 会被多加一个周期)
  const fallback = DEFAULT_SETTINGS.review
  const oldN = isValidIntervalTable(oldSchedule?.newbie) ? oldSchedule.newbie : fallback.newbie
  const oldF = isValidIntervalTable(oldSchedule?.fluent) ? oldSchedule.fluent : fallback.fluent
  const newN = newSchedule?.newbie
  const newF = newSchedule?.fluent
  // 表未变 → 无需重算
  if (newN && newF && oldN.join() === newN.join() && oldF.join() === newF.join()) {
    return { updated: 0 }
  }

  const db = getDb()
  const { newbie, fluent } = getScheduleSettings()
  const words = db
    .prepare("SELECT id, status, stage, due_at FROM words WHERE status IN ('new','learning','fluent')")
    .all()
  const todayStart = new Date(localDayStartIso())
  const todayEnd = new Date(localDayEndIso())
  const update = db.prepare("UPDATE words SET due_at = ?, updated_at = datetime('now','localtime') WHERE id = ?")
  let updated = 0

  for (const w of words) {
    const oldTable = w.status === STATUS.FLUENT ? oldF : oldN
    const newTable = w.status === STATUS.FLUENT ? fluent : newbie
    const stage = Math.min(Math.max(0, w.stage), newTable.length - 1)
    const newInterval = newTable[stage]
    if (!newInterval) continue
    // 已到期词不动
    if (w.due_at && new Date(w.due_at) <= todayEnd) continue

    let base = w.due_at ? new Date(w.due_at) : null
    if (base && !isNaN(base.getTime())) {
      const oldInterval = oldTable?.[Math.min(Math.max(0, w.stage), oldTable.length - 1)]
      if (oldInterval) base = new Date(addDays(base, -oldInterval))
    } else {
      base = new Date(todayStart)
    }
    if (base < todayStart) base = new Date(todayStart)

    const next = addDays(base, newInterval)
    if (next !== w.due_at) {
      update.run(next, w.id)
      updated++
    }
  }

  return { updated }
}
