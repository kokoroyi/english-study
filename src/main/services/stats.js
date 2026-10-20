import { getDb } from '../db/database.js'
import { memoryOverview, forecastDue, dueWordsCount, dueWordsMeta } from './review.js'
import { getSetting } from './settings.js'

/** 有效会话最小秒数(低于此值的会话不计入学习时长) */
function minSessionSeconds() {
  return getSetting('behavior')?.sessionMinSeconds ?? 30
}

/** 本地日期字符串 YYYY-MM-DD */
function localDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 活跃度分级(score = 阅读分钟 + 标记词×3 + 复习×1.5)。
 * 分档锚点贴合学习量级: 5≈几分钟/两三个生词, 15≈一刻钟, 35≈半小时, 70≈一小时以上。
 * 原饱和公式(1-e^(-score/25))过快逼近满格, 中档几乎用不上且深浅区分度差。
 */
export function activityLevel(score) {
  const s = Number(score) || 0
  if (s <= 0) return 0
  if (s < 5) return 0.15
  if (s < 15) return 0.35
  if (s < 35) return 0.55
  if (s < 70) return 0.78
  return 0.95
}

/** 每日活跃数据(阅读会话/标记词/复习)在指定时间范围内的聚合 */
function dailyActivityMaps(startIso, endIso) {
  const db = getDb()
  const minSec = minSessionSeconds()
  const sessions = db
    .prepare(
      `SELECT date(started_at,'localtime') as day,
              COUNT(*) as sessions,
              SUM(active_seconds) as seconds,
              SUM(marked_words) as words
       FROM reading_sessions
       WHERE started_at >= ? AND started_at <= ? AND active_seconds >= ?
       GROUP BY day`
    )
    .all(startIso, endIso, minSec)
  const markedByDay = db
    .prepare(
      `SELECT date(first_marked_at,'localtime') as day, COUNT(*) as cnt
       FROM words WHERE first_marked_at >= ? AND first_marked_at <= ?
       GROUP BY day`
    )
    .all(startIso, endIso)
  const reviewByDay = db
    .prepare(
      `SELECT date(created_at,'localtime') as day, COUNT(*) as cnt
       FROM review_results WHERE created_at >= ? AND created_at <= ?
       GROUP BY day`
    )
    .all(startIso, endIso)

  const secMap = new Map()
  const sessMap = new Map()
  for (const s of sessions) {
    secMap.set(s.day, (secMap.get(s.day) || 0) + (s.seconds || 0))
    sessMap.set(s.day, (sessMap.get(s.day) || 0) + s.sessions)
  }
  const markedMap = new Map()
  for (const m of markedByDay) markedMap.set(m.day, m.cnt)
  const reviewMap = new Map()
  for (const r of reviewByDay) reviewMap.set(r.day, r.cnt)

  const score = (day) => {
    const minutes = (secMap.get(day) || 0) / 60
    const words = markedMap.get(day) || 0
    const reviews = reviewMap.get(day) || 0
    return minutes * 1 + words * 3 + reviews * 1.5
  }
  const rowFor = (day) => ({
    sessions: sessMap.get(day) || 0,
    seconds: secMap.get(day) || 0,
    words: markedMap.get(day) || 0,
    reviews: reviewMap.get(day) || 0,
    score: score(day)
  })
  return { rowFor }
}

/** 日历数据: 指定月份每天的活跃数据 + 综合活跃度评分 */
export function calendarData(monthOffset = 0) {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + monthOffset
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const start = firstDay
  start.setHours(0, 0, 0, 0)
  const end = new Date(year, month + 1, 0, 23, 59, 59)

  const { rowFor } = dailyActivityMaps(start.toISOString(), end.toISOString())

  const out = []
  for (let day = 1; day <= daysInMonth; day++) {
    // 用实际 Date 回读年月生成 key: 跨年导航(1 月看上月 / 12 月看下月)时
    // 原实现用未滚动过的 year/month 拼 key(如 "2026-0-xx"), 与前端日历格子永远对不上 → 整月空白
    const d = new Date(year, month, day)
    const key = localDateStr(d)
    const row = rowFor(key)
    out.push({
      date: key,
      ...row,
      level: activityLevel(row.score)
    })
  }
  return out
}

/** 年度日历数据(GitHub 风格年视图): 指定年份每天一条, 共 365/366 条 */
export function calendarYearData(year = null) {
  const y = Number(year) || new Date().getFullYear()
  const start = new Date(y, 0, 1, 0, 0, 0)
  const end = new Date(y, 11, 31, 23, 59, 59)
  const { rowFor } = dailyActivityMaps(start.toISOString(), end.toISOString())

  const out = []
  const d = new Date(y, 0, 1)
  while (d.getFullYear() === y) {
    const key = localDateStr(d)
    const row = rowFor(key)
    out.push({
      date: key,
      ...row,
      level: activityLevel(row.score)
    })
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** 年度趋势: 指定年份的 1-12 月汇总(默认今年, 可查任意年份) */
export function monthlyTrend(year = null) {
  const db = getDb()
  const targetYear = year ?? new Date().getFullYear()
  const months = []
  const start = new Date(targetYear, 0, 1)
  const end = new Date(targetYear, 11, 31, 23, 59, 59)
  const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  // 会话时长按天聚合后按月归并
  const minSec = minSessionSeconds()
  const sessions = db
    .prepare(
      `SELECT date(started_at,'localtime') as day, SUM(active_seconds) as seconds, SUM(marked_words) as words
       FROM reading_sessions WHERE started_at >= ? AND started_at <= ? AND active_seconds >= ?
       GROUP BY day`
    )
    .all(start.toISOString(), end.toISOString(), minSec)

  const markedByDay = db
    .prepare(
      `SELECT date(first_marked_at,'localtime') as day, COUNT(*) as cnt
       FROM words WHERE first_marked_at >= ? AND first_marked_at <= ? GROUP BY day`
    )
    .all(start.toISOString(), end.toISOString())

  const secMap = new Map()
  for (const s of sessions) {
    const key = (s.day || '').slice(0, 7)
    secMap.set(key, (secMap.get(key) || 0) + (s.seconds || 0))
  }
  const wordMap = new Map()
  for (const m of markedByDay) {
    const key = (m.day || '').slice(0, 7)
    wordMap.set(key, (wordMap.get(key) || 0) + m.cnt)
  }

  for (let i = 0; i < 12; i++) {
    const d = new Date(targetYear, i, 1)
    const key = monthKey(d)
    months.push({
      month: key,
      label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
      seconds: secMap.get(key) || 0,
      marked: wordMap.get(key) || 0
    })
  }
  return months
}

/** 控制台 KPI + 图表数据 */
export function dashboard(range = 7) {
  const db = getDb()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (range - 1))

  // 近期学习时长(排除低于有效阈值的会话)
  const minSec = minSessionSeconds()
  const sessions = db
    .prepare(
      `SELECT date(started_at,'localtime') as day,
              type,
              SUM(active_seconds) as seconds,
              SUM(marked_words) as words
       FROM reading_sessions
       WHERE started_at >= ? AND active_seconds >= ?
       GROUP BY day, type`
    )
    .all(start.toISOString(), minSec)

  // 近期标记/复习词数
  const markedByDay = db
    .prepare(
      `SELECT date(first_marked_at,'localtime') as day, COUNT(*) as cnt
       FROM words WHERE first_marked_at >= ?
       GROUP BY day`
    )
    .all(start.toISOString())

  const reviewByDay = db
    .prepare(
      `SELECT date(created_at,'localtime') as day, COUNT(*) as cnt, result
       FROM review_results WHERE created_at >= ?
       GROUP BY day, result`
    )
    .all(start.toISOString())

  // 累计学习量(总时长与日历/日报口径一致, 排除低于有效阈值的会话)
  const totals = {
    totalWords: db.prepare('SELECT COUNT(*) as c FROM words').get().c,
    totalArticles: db.prepare('SELECT COUNT(*) as c FROM articles').get().c,
    totalReview: db.prepare('SELECT COUNT(*) as c FROM review_results').get().c,
    totalSeconds: db.prepare('SELECT SUM(active_seconds) as s FROM reading_sessions WHERE active_seconds >= ?').get(minSec).s || 0,
    totalMarked: db.prepare('SELECT SUM(marked_count) as s FROM words').get().s || 0
  }

  return {
    memory: memoryOverview(),
    forecast: forecastDue(14),
    calendar: calendarData(),
    daily: {
      sessions,
      marked: markedByDay,
      review: reviewByDay
    },
    totals,
    today: {
      seconds: sessions
        .filter((s) => s.day === localDateStr())
        .reduce((a, s) => a + (s.seconds || 0), 0),
      markedWords: markedByDay
        .filter((s) => s.day === localDateStr())
        .reduce((a, s) => a + s.cnt, 0),
      due: dueWordsCount(),
      maxOverdueDays: dueWordsMeta().maxOverdueDays
    }
  }
}
