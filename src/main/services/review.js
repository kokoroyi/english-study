import { getDb, log } from '../db/database.js'
import { getScheduleSettings, getSetting, DEFAULT_SETTINGS } from './settings.js'
import { addDays, localDateKey, nowIso } from '../utils/time.js'
import { STATUS } from './words.js'

/**
 * 艾宾浩斯调度核心:
 * - 生词/学习中: 按 newbie 间隔表 [1,2,4,7,15,30] 走, stage 从 0 递增
 * - 熟词: 按 fluent 间隔表 [7,15,30,60,90] 走
 * - 连续 promoteAfterKnown 次认识 → 升熟词(interval 用 fluent[0])
 * - 不认识 → 打回,间隔减半重走(见 demote)
 */

function nextDue(intervalDays) {
  return addDays(new Date(), intervalDays)
}

/**
 * 复习结果判定。
 * result: 'known' | 'fuzzy' | 'unknown' | 'skip'
 * known/fuzzy 推进, unknown 打回, skip 不改变
 */
const VALID_RESULTS = new Set(['known', 'fuzzy', 'unknown', 'skip', 'later'])

/** 复习配置(含调度表与每日限制/顺序策略) */
function getReviewConfig() {
  const review = getSetting('review') || {}
  const def = DEFAULT_SETTINGS.review
  return {
    promoteAfterKnown: Number.isInteger(review.promoteAfterKnown) ? review.promoteAfterKnown : def.promoteAfterKnown,
    dailyLimit: Number.isInteger(review.dailyLimit) && review.dailyLimit > 0 ? review.dailyLimit : 0,
    dailyNewLimit: Number.isInteger(review.dailyNewLimit) && review.dailyNewLimit > 0 ? review.dailyNewLimit : 0,
    orderStrategy: review.orderStrategy === 'newFirst' ? 'newFirst' : 'overdue'
  }
}

export function submitWordResult({ wordId, result, flowId = null, sessionType = 'review' }) {
  const db = getDb()
  const word = db.prepare('SELECT * FROM words WHERE id = ?').get(wordId)
  if (!word) return { ok: false, error: '单词不存在' }

  // 非法结果值视为 skip: 之前任何未知值都会走到"无分支"路径, 把 due_at 置空,
  // 导致单词从此不再到期、彻底从复习队列消失
  if (!VALID_RESULTS.has(result)) result = 'skip'

  const { newbie, fluent } = getScheduleSettings()
  const { promoteAfterKnown } = getReviewConfig()

  if (result === 'skip') {
    return { ok: true, word, changed: false }
  }

  let status = word.status
  let stage = word.stage
  let knownCount = word.known_count
  let missCount = word.miss_count
  let dueAt = null

  if (result === 'later') {
    // 稍后: 不改状态/计数, 只顺延到明天(而不是无限滞留在"今天")
    dueAt = nextDue(1)
  } else if (result === 'known' || result === 'fuzzy') {
    if (status === STATUS.FLUENT) {
      // 熟词: 沿 fluent 表推进(fuzzy 同样推进间隔, 与生词分支一致; 只是不计"认识"次数)
      const nextStage = Math.min(stage + 1, fluent.length - 1)
      stage = nextStage
      dueAt = nextDue(fluent[stage])
      knownCount += result === 'known' ? 1 : 0
    } else {
      // 生词/学习中: 连续认识计数(与熟词分支一致, 模糊不计入"认识"次数, 但仍推进间隔)
      knownCount += result === 'known' ? 1 : 0
      if (knownCount >= promoteAfterKnown) {
        // 升级为熟词: 从熟词表起点重新开始, 温和过渡
        status = STATUS.FLUENT
        stage = 0
        dueAt = nextDue(fluent[0])
      } else {
        // 学习中: 沿 newbie 表推进, 且 new → learning
        if (status !== STATUS.LEARNING) status = STATUS.LEARNING
        const nextStage = Math.min(stage + 1, newbie.length - 1)
        stage = nextStage
        dueAt = nextDue(newbie[stage])
      }
    }
  } else if (result === 'unknown') {
    missCount += 1
    knownCount = 0
    if (status === STATUS.FLUENT) {
      // 熟词打回: 回到学习中。间隔与"阅读中重新标记熟词"通道统一为 newbie[0](默认 1 天):
      // 两条通道都是"用户忘了这个词", 之前这里给 2 天、markWord 给 1 天, 语义不一致
      status = STATUS.LEARNING
      stage = 0
      dueAt = nextDue(newbie[0])
    } else {
      // 学习中打回: 间隔减半重走
      status = STATUS.LEARNING
      const half = Math.max(1, Math.floor(newbie[Math.max(0, stage - 1)] / 2))
      stage = 0
      dueAt = nextDue(half)
    }
  }

  db.prepare(
    `UPDATE words SET
      status = ?, stage = ?, known_count = ?, miss_count = ?,
      last_reviewed_at = datetime('now','localtime'), due_at = ?,
      updated_at = datetime('now','localtime')
     WHERE id = ?`
  ).run(status, stage, knownCount, missCount, dueAt, wordId)

  db.prepare(
    'INSERT INTO review_results (word_id, flow_id, session_type, result, created_at) VALUES (?,?,?,?,?)'
  ).run(wordId, flowId, sessionType, result, nowIso())

  log('info', 'review', `词 ${word.lemma} 复习结果: ${result}`, { status, stage, dueAt })
  return { ok: true, word: { ...word, status, stage, known_count: knownCount, miss_count: missCount, due_at: dueAt }, changed: true }
}

/** 记忆保持率: 按"距上次复习的间隔"分桶统计正确率(近 N 天的事件) */
export function retentionStats(days = 90) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT r.word_id, r.result, r.created_at AS t, w.first_marked_at AS first
       FROM review_results r JOIN words w ON w.id = r.word_id
       ORDER BY r.word_id ASC, r.id ASC`
    )
    .all()
  const buckets = [
    { min: 0, max: 1, label: '1 天' },
    { min: 2, max: 3, label: '2-3 天' },
    { min: 4, max: 7, label: '4-7 天' },
    { min: 8, max: 14, label: '8-14 天' },
    { min: 15, max: 30, label: '15-30 天' },
    { min: 31, max: 90, label: '31-90 天' },
    { min: 91, max: Infinity, label: '90 天以上' }
  ]
  const stats = buckets.map((b) => ({ ...b, known: 0, fuzzy: 0, unknown: 0 }))
  // created_at 为本地时间文本, first_marked_at 为 ISO(带 T/Z); 统一按本地墙钟时间解析
  const parse = (s) => new Date(String(s).includes('T') ? String(s) : String(s).replace(' ', 'T')).getTime()
  const windowStart = Date.now() - days * 86400000
  const prevByWord = new Map()

  for (const r of rows) {
    const t = parse(r.t)
    if (Number.isNaN(t)) continue
    const prev = prevByWord.get(r.word_id)
    let intervalDays = 0
    if (prev) intervalDays = (t - prev) / 86400000
    else if (r.first) {
      const firstT = parse(r.first)
      if (!Number.isNaN(firstT)) intervalDays = Math.max(0, (t - firstT) / 86400000)
    }
    prevByWord.set(r.word_id, t)
    if (t < windowStart) continue // 窗口外的事件仅作间隔锚点
    if (r.result === 'later' || r.result === 'skip') continue // 非判定结果不计入正确率
    const bucket = buckets.find((b) => intervalDays >= b.min && intervalDays <= b.max) || buckets[buckets.length - 1]
    const s = stats.find((x) => x.label === bucket.label)
    if (r.result === 'known') s.known++
    else if (r.result === 'fuzzy') s.fuzzy++
    else if (r.result === 'unknown') s.unknown++
  }

  return stats.map((s) => {
    const total = s.known + s.fuzzy + s.unknown
    // retention = (认识 + 0.5×模糊) / 总数(模糊算半个正确)
    const retention = total ? Math.round(((s.known + s.fuzzy * 0.5) / total) * 100) : null
    return { ...s, total, retention }
  })
}

/** 今日到期词列表(按本地日期判定"今天"; 受每日上限限制, 逾期最久优先)
 *  每行附带 source_article_title(articles.title; 无来源/文章已删为 null), 供渲染层显示来源 */
export function dueWords(limit = 1000) {
  const cfg = getReviewConfig()
  const effectiveLimit = cfg.dailyLimit > 0 ? Math.min(limit, cfg.dailyLimit) : limit
  const orderBy = cfg.orderStrategy === 'newFirst'
    ? "ORDER BY CASE WHEN w.status = 'new' THEN 0 ELSE 1 END ASC, w.due_at ASC"
    : 'ORDER BY w.due_at ASC'
  return getDb()
    .prepare(`SELECT w.*, a.title AS source_article_title ${dueSqlBase()} ${orderBy} LIMIT ?`)
    .all(localTomorrowStartIso(), effectiveLimit)
}

/** 今日到期词总数(不受列表 LIMIT 截断, 供徽标/KPI 计数) */
export function dueWordsCount() {
  return getDb()
    .prepare(`SELECT COUNT(*) as c ${dueSqlBase()}`)
    .get(localTomorrowStartIso()).c
}

/** 今日复习元信息: 总到期数 / 每日上限 / 实际展示数 / 最大逾期天数 */
export function dueWordsMeta() {
  const cfg = getReviewConfig()
  const total = dueWordsCount()
  const limit = cfg.dailyLimit
  const overdue = getDb()
    .prepare(
      `SELECT MAX(CAST(julianday(datetime('now','localtime')) - julianday(due_at) AS INTEGER)) as maxOverdue
       FROM words WHERE status IN ('new','learning','fluent') AND due_at IS NOT NULL AND due_at < ?`
    )
    .get(localTomorrowStartIso())
  return { total, limit, shown: limit > 0 ? Math.min(total, limit) : total, maxOverdueDays: overdue?.maxOverdue || 0 }
}

/** 一键把今日全部到期词顺延到明天(网络故障/今天实在没空时的逃生阀) */
export function postponeAllDue() {
  const db = getDb()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const res = db
    .prepare(
      `UPDATE words SET due_at = ?, updated_at = datetime('now','localtime')
       WHERE status IN ('new','learning','fluent') AND due_at IS NOT NULL AND due_at < ?`
    )
    .run(tomorrow.toISOString(), localTomorrowStartIso())
  log('info', 'review', `全部到期词顺延到明天: ${res.changes} 个`)
  return { postponed: res.changes }
}

// 只含 FROM/JOIN/WHERE 片段: 列表与计数共用, 避免 COUNT 依赖对 "SELECT *" 的字符串替换
function dueSqlBase() {
  return `FROM words w
       LEFT JOIN articles a ON a.id = w.source_article_id
       WHERE w.status IN ('new','learning','fluent')
         AND w.due_at IS NOT NULL
         AND w.due_at < ?`
}

// due_at 为 UTC ISO 字符串。用"本地明天 00:00"作为上界:
// 本地日期 ≤ 今天的词全部到期(东八区用户早上 0-8 点也能看到当天到期词, 修复 UTC 日界偏移)
function localTomorrowStartIso() {
  const boundary = new Date()
  boundary.setDate(boundary.getDate() + 1)
  boundary.setHours(0, 0, 0, 0)
  return boundary.toISOString()
}

/** 记忆强度概览: 用于控制台遗忘风险曲线 */
export function memoryOverview() {
  const db = getDb()
  const words = db.prepare("SELECT status, stage, due_at FROM words WHERE status IN ('new','learning','fluent')").all()
  return {
    total: words.length,
    new: words.filter((w) => w.status === STATUS.NEW).length,
    learning: words.filter((w) => w.status === STATUS.LEARNING).length,
    fluent: words.filter((w) => w.status === STATUS.FLUENT).length,
    dueToday: dueWords().length
  }
}

/** 预测未来 N 天的到期量(用于遗忘风险曲线) */
export function forecastDue(days = 14) {
  const db = getDb()
  const words = db.prepare("SELECT status, stage, due_at FROM words WHERE status IN ('new','learning','fluent')").all()
  const { newbie, fluent } = getScheduleSettings()

  // 本地日边界(与用户感知的"今天"一致)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dayKey = (d) => localDateKey(d)

  const counts = new Map()
  for (const w of words) {
    const table = w.status === STATUS.FLUENT ? fluent : newbie
    const stage = Math.min(w.stage, table.length - 1)
    const interval = table[stage]
    if (!interval) continue

    // 只预测"下一次"到期(避免未来 N 个周期重复累计造成过估)
    const dueDate = w.due_at ? new Date(w.due_at) : null
    const dueKey = dueDate && !isNaN(dueDate.getTime()) ? dayKey(dueDate) : dayKey(today)
    if (!dueKey) continue
    if (dueDate && dueDate >= today) {
      counts.set(dueKey, (counts.get(dueKey) || 0) + 1)
    } else {
      // 今天已到期(含负值) → 压在今天
      counts.set(dayKey(today), (counts.get(dayKey(today)) || 0) + 1)
    }
  }

  const out = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime())
    d.setDate(d.getDate() + i)
    const key = dayKey(d)
    out.push({ date: key, count: counts.get(key) || 0 })
  }
  return out
}
