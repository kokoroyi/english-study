import { getDb, log } from '../db/database.js'
import { resolveLemma, lookupWord } from '../dict/dictionary.js'
import { getScheduleSettings, getSetting, DEFAULT_SETTINGS } from './settings.js'
import { addDays, nowIso, localDayStartIso } from '../utils/time.js'

export const STATUS = { NEW: 'new', LEARNING: 'learning', FLUENT: 'fluent' }

/**
 * 标记一个生词(阅读时划选后点击荧光笔)。
 * 若已存在同 lemma 记录,则计数 +1、更新原文上下文;不存在则新建。
 * 若该词是熟词,自动打回生词本。
 * 返回 { word, isNew, demoted }
 */
export function markWord({ word, sourceArticleId = null, context = '', manual = false }) {
  if (!word || !String(word).trim()) return { ok: false, error: '单词不能为空' }
  word = String(word).trim()
  const lemma = resolveLemma(word)
  const dict = lookupWord(lemma) || lookupWord(word)
  const db = getDb()
  // 新词标记 / 熟词打回后的首次复习间隔(天), 与调度器共用同一张表
  // 设置里若被清空/非法, 回退到默认表, 避免 NaN 日期
  const schedule = getScheduleSettings()
  const firstInterval = Array.isArray(schedule.newbie) && schedule.newbie[0] > 0
    ? schedule.newbie[0]
    : DEFAULT_SETTINGS.review.newbie[0]

  const existing = db.prepare('SELECT * FROM words WHERE lemma = ?').get(lemma)

  if (existing) {
    const wasFluent = existing.status === STATUS.FLUENT
    // 熟词被打回 → 状态改为学习中, stage/复习间隔重置为首期, 认识次数清零
    // (之前 stage 未重置, 熟词高位 stage 直接套用到生词表会造成间隔跳档)
    const newStatus = wasFluent ? STATUS.LEARNING : existing.status
    const newDue = wasFluent ? addDays(new Date(), firstInterval) : existing.due_at
    const newKnown = wasFluent ? 0 : existing.known_count
    const newStage = wasFluent ? 0 : existing.stage
    db.prepare(
      `UPDATE words SET
        display = ?, phonetic = COALESCE(?, phonetic), definition = COALESCE(?, definition),
        translation = COALESCE(?, translation), pos = COALESCE(?, pos),
        marked_count = marked_count + 1,
        miss_count = miss_count + ?,
        status = ?,
        known_count = ?,
        stage = ?,
        is_manual = MAX(is_manual, ?),
        source_article_id = COALESCE(?, source_article_id),
        source_context = COALESCE(?, source_context),
        due_at = ?,
        updated_at = datetime('now','localtime')
      WHERE id = ?`
    ).run(
      word,
      dict?.phonetic || null,
      dict?.definition || null,
      dict?.translation || null,
      dict?.pos || null,
      wasFluent ? 1 : 0,
      newStatus,
      newKnown,
      newStage,
      manual ? 1 : 0,
      sourceArticleId,
      context,
      newDue,
      existing.id
    )
    log('info', 'words', `已存在单词 ${lemma} 标记 +1`, { wasFluent })
    return { word: { ...existing, display: word, status: newStatus, stage: newStage, known_count: newKnown, due_at: newDue }, isNew: false, demoted: wasFluent }
  }

  const now = nowIso()
  // 每日新词配额: 当天已引入的新词数达到上限时, 本词的首复顺延一天(0=不限)
  let dueOffset = firstInterval
  const dailyNewLimit = (getSetting('review') || {}).dailyNewLimit
  if (Number.isInteger(dailyNewLimit) && dailyNewLimit > 0) {
    const todayNew = db
      .prepare('SELECT COUNT(*) as c FROM words WHERE first_marked_at >= ? AND first_marked_at < ?')
      .get(localDayStartIso(0), localDayStartIso(1)).c
    if (todayNew >= dailyNewLimit) dueOffset = firstInterval + 1
  }
  const info = {
    lemma,
    display: word,
    phonetic: dict?.phonetic || '',
    definition: dict?.definition || '',
    translation: dict?.translation || '',
    pos: dict?.pos || '',
    status: STATUS.NEW,
    stage: 0,
    known_count: 0,
    miss_count: 0,
    marked_count: 1,
    first_marked_at: now,
    // 新词第一次复习 = newbie[0](默认 1 天), 而不是今天; 超配额再顺延一天
    due_at: addDays(new Date(), dueOffset),
    source_article_id: sourceArticleId,
    source_context: context,
    is_manual: manual ? 1 : 0
  }

  const res = db
    .prepare(
      `INSERT INTO words
        (lemma, display, phonetic, definition, translation, pos, status, stage, known_count,
         miss_count, marked_count, first_marked_at, due_at, source_article_id, source_context, is_manual)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      info.lemma, info.display, info.phonetic, info.definition, info.translation, info.pos,
      info.status, info.stage, info.known_count, info.miss_count, info.marked_count,
      info.first_marked_at, info.due_at, info.source_article_id, info.source_context, info.is_manual
    )

  log('info', 'words', `新增生词 ${lemma}`, { source: manual ? 'manual' : 'reading' })
  return { word: { id: res.lastInsertRowid, ...info }, isNew: true, demoted: false }
}

/** 批量标记(阅读结束自动入库)。返回新增词数组。 */
export function batchMarkWords(items, { sourceArticleId = null } = {}) {
  const results = []
  for (const item of items) {
    const r = markWord({ word: item.word, sourceArticleId, context: item.context || '', manual: false })
    results.push({ ...r, display: item.word })
  }
  return results
}

/** 词库列表。filters: { status, keyword, sourceArticleId, sortBy, order }
 *  每行附带 source_article_title(articles.title; 无来源/文章已删为 null), 供渲染层显示来源 */
export function listWords(filters = {}) {
  const db = getDb()
  const where = []
  const params = []

  if (filters.status && filters.status !== 'all') {
    where.push('w.status = ?')
    params.push(filters.status)
  }
  if (filters.keyword) {
    where.push('(w.lemma LIKE ? OR w.display LIKE ? OR w.translation LIKE ?)')
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`)
  }
  if (filters.sourceArticleId) {
    where.push('w.source_article_id = ?')
    params.push(filters.sourceArticleId)
  }

  const SORTABLE = new Set(['id', 'lemma', 'display', 'status', 'stage', 'known_count', 'miss_count', 'marked_count', 'due_at', 'created_at', 'updated_at'])
  const sortBy = SORTABLE.has(filters.sortBy) ? filters.sortBy : 'created_at'
  const order = String(filters.order || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'
  // 列名统一加 w. 前缀: words/articles 都有 created_at/updated_at 等列, 裸列名在 JOIN 后会歧义
  const sql = `SELECT w.*, a.title AS source_article_title
    FROM words w LEFT JOIN articles a ON a.id = w.source_article_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY w.${sortBy} ${order} LIMIT 5000`
  return db.prepare(sql).all(...params)
}

/** 手动添加生词 */
export function addWordManually(word) {
  return markWord({ word, manual: true })
}

/** 删除单个词 */
export function removeWord(id) {
  return getDb().prepare('DELETE FROM words WHERE id = ?').run(id)
}

/** 批量删除 */
export function batchRemoveWords(ids) {
  if (!ids || !ids.length) return { deleted: 0 }
  const placeholders = ids.map(() => '?').join(',')
  const res = getDb().prepare(`DELETE FROM words WHERE id IN (${placeholders})`).run(...ids)
  return { deleted: res.changes }
}

/**
 * 重置全部词的学习进度(词条与标记次数保留):
 * 状态回 new、计数清零、首复统一安排到明天。适合"停学很久想重新来过"。
 */
export function resetAllProgress() {
  const db = getDb()
  const tomorrow = addDays(new Date(), 1)
  const res = db
    .prepare(
      `UPDATE words SET
        status = 'new', stage = 0, known_count = 0, miss_count = 0,
        last_reviewed_at = NULL, due_at = ?, updated_at = datetime('now','localtime')`
    )
    .run(tomorrow)
  db.prepare('DELETE FROM review_results').run()
  log('info', 'words', `重置学习进度: ${res.changes} 个词`)
  return { reset: res.changes }
}

/** 更新词字段(词库页手动操作) */
export function updateWord(id, data) {
  const allowed = ['display', 'status', 'stage', 'due_at', 'source_context', 'source_article_id']
  const sets = []
  const params = []
  for (const k of allowed) {
    if (k in data) {
      sets.push(`${k} = ?`)
      params.push(data[k])
    }
  }
  if (!sets.length) return { ok: false, error: '无更新字段' }
  sets.push("updated_at = datetime('now','localtime')")
  params.push(id)
  getDb().prepare(`UPDATE words SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  return { ok: true }
}

/** 导出词到文件 */
export function exportWords(ids, format = 'csv') {
  const db = getDb()
  const sql = ids && ids.length
    ? `SELECT * FROM words WHERE id IN (${ids.map(() => '?').join(',')})`
    : 'SELECT * FROM words'
  const rows = ids && ids.length ? db.prepare(sql).all(...ids) : db.prepare(sql).all()

  if (format === 'json') {
    return { ok: true, content: JSON.stringify(rows, null, 2), filename: 'words.json' }
  }

  const header = 'lemma,display,phonetic,translation,definition,status,stage,known_count,miss_count,due_at'
  const lines = rows.map((r) =>
    [r.lemma, r.display, r.phonetic, (r.translation || '').replace(/\n/g, '\\n'), (r.definition || '').replace(/\n/g, '\\n'), r.status, r.stage, r.known_count, r.miss_count, r.due_at]
      .map((v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`)
      .join(',')
  )
  return { ok: true, content: [header, ...lines].join('\n'), filename: 'words.csv' }
}
