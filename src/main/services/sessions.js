import { getDb, log } from '../db/database.js'
import { nowIso } from '../utils/time.js'

/**
 * 活跃会话计时模型:
 * 会话开始时记录 start, 每次心跳累加 active_seconds。
 * 前端在焦点在页面时周期上报心跳; 失焦/闲置则暂停。
 */

const activeSessions = new Map()

export function startSession({ type = 'reading', articleId = null, reviewFlowId = null }) {
  const db = getDb()
  const res = db
    .prepare(
      'INSERT INTO reading_sessions (type, article_id, review_flow_id, started_at) VALUES (?,?,?,?)'
    )
    .run(type, articleId, reviewFlowId, nowIso())
  const id = Number(res.lastInsertRowid)
  activeSessions.set(id, { id, lastTick: Date.now(), activeSeconds: 0 })
  return { id }
}

export function tickSession(id, seconds) {
  if (!id) return { ok: false }
  const s = activeSessions.get(id)
  if (!s) return { ok: false }
  // 负数/NaN 防护: 渲染层异常上报负数会倒扣学习时长
  const n = Number(seconds)
  const addSeconds = Number.isFinite(n) ? Math.min(Math.max(n, 0), 10) : 1
  s.activeSeconds += addSeconds
  s.lastTick = Date.now()
  return { ok: true }
}

export function endSession(id, data = {}) {
  if (!id) return { ok: false, error: '无会话' }
  const s = activeSessions.get(id)
  if (!s) {
    // 重复结束/未知会话: 原实现会用 active_seconds=0 覆盖已落库记录, 直接返回而不是清空
    return { ok: false, error: '会话不存在或已结束' }
  }
  const seconds = s.activeSeconds
  const markedWords = data.markedWords ?? 0
  getDb()
    .prepare(
      `UPDATE reading_sessions
       SET ended_at = ?, active_seconds = ?, marked_words = ?
       WHERE id = ?`
    )
    .run(nowIso(), seconds, markedWords, id)
  activeSessions.delete(id)
  log('info', 'sessions', `会话结束 ${id}`, { seconds, markedWords })
  return { ok: true, seconds, markedWords }
}
