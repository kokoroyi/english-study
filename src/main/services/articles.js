import { getDb, log } from '../db/database.js'
import { nowIso } from '../utils/time.js'

/**
 * 清洗文本:
 * 1. 统一换行符 \r\n → \n
 * 2. 段内硬换行合并: 单换行(前后不是空行)视为软换行, 合并为空格
 * 3. 段落以空行分隔, 压缩多余空行为单个
 * 4. 去除行首行尾多余空格、连续空格
 */
export function cleanText(raw) {
  if (!raw) return ''
  return raw
    .replace(/\r\n/g, '\n')
    // 行尾空格
    .replace(/[ \t]+\n/g, '\n')
    // 压缩 3+ 连续空行 → 2 个换行(即一个空行段落分隔)
    .replace(/\n{3,}/g, '\n\n')
    // 段内单换行 → 空格(前后都不是空行)
    .replace(/(\S)\n(\S)/g, '$1 $2')
    // 连续空格 → 单空格
    .replace(/ {2,}/g, ' ')
    .trim()
}

function countWords(text) {
  const m = text.match(/[A-Za-z']+/g)
  return m ? m.length : 0
}

export function createArticle({ title, content, source = 'manual' }) {
  const db = getDb()
  const cleaned = cleanText(content)
  const autoTitle =
    (title && title.trim()) ||
    cleaned.split('\n')[0].slice(0, 40) ||
    '未命名文章'
  const finalTitle = autoTitle.trim()

  // 去重: 同标题同内容的文章视为重复, 复用已有记录。
  // (原实现只查 2 秒窗口, 用户读到一半退出、过几小时/隔天继续同一篇时会重复建文章,
  //  导致词的来源文章被"换新", 按文章分组的复习被拆散)
  const existing = db
    .prepare("SELECT id FROM articles WHERE title = ? AND content = ? ORDER BY id DESC LIMIT 1")
    .get(finalTitle, content)
  if (existing) {
    return { id: existing.id, title: finalTitle, cleaned_content: cleaned, duplicate: true }
  }

  const res = db
    .prepare(
      'INSERT INTO articles (title, content, cleaned_content, word_count, source) VALUES (?,?,?,?,?)'
    )
    .run(finalTitle, content, cleaned, countWords(cleaned), source)

  log('info', 'articles', `创建文章 ${finalTitle}`, { wordCount: countWords(cleaned) })
  return { id: res.lastInsertRowid, title: finalTitle, cleaned_content: cleaned, duplicate: false }
}

export function listArticles(filters = {}) {
  const db = getDb()
  let sql = `SELECT a.*,
    (SELECT COUNT(*) FROM words w WHERE w.source_article_id = a.id) as marked_word_count
    FROM articles a`
  const where = []
  const params = []
  if (filters.keyword) {
    where.push('(a.title LIKE ? OR a.content LIKE ?)')
    params.push(`%${filters.keyword}%`, `%${filters.keyword}%`)
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ')
  sql += ' ORDER BY a.created_at DESC LIMIT 300'
  return db.prepare(sql).all(...params)
}

export function getArticle(id) {
  return getDb().prepare('SELECT * FROM articles WHERE id = ?').get(id)
}

/** 最近 N 篇阅读文章(用于 AI 故事难度参考) */
export function recentArticles(n = 2) {
  return getDb()
    .prepare('SELECT id, title, cleaned_content, content, word_count, created_at FROM articles ORDER BY created_at DESC LIMIT ?')
    .all(n)
}

export function removeArticle(id) {
  const db = getDb()
  // 文章删除后, 相关词保留(来源置空)
  db.prepare('UPDATE words SET source_article_id = NULL WHERE source_article_id = ?').run(id)
  return db.prepare('DELETE FROM articles WHERE id = ?').run(id)
}

export function batchRemoveArticles(ids) {
  if (!ids || !ids.length) return { removed: 0 }
  const db = getDb()
  const placeholders = ids.map(() => '?').join(',')
  db.prepare(`UPDATE words SET source_article_id = NULL WHERE source_article_id IN (${placeholders})`).run(...ids)
  const res = db.prepare(`DELETE FROM articles WHERE id IN (${placeholders})`).run(...ids)
  return { removed: res.changes }
}
