import Database from 'better-sqlite3'
import { getDbPath as resolveDbPath, getDataDir } from './schema.js'

let db = null

export function getDb() {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function closeDatabase() {
  if (db) {
    try { db.close() } catch {}
    db = null
  }
}

export function initDatabase() {
  const dbPath = resolveDbPath()
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lemma TEXT NOT NULL UNIQUE,
    display TEXT NOT NULL,
    phonetic TEXT,
    definition TEXT,
    translation TEXT,
    pos TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    stage INTEGER NOT NULL DEFAULT 0,
    known_count INTEGER NOT NULL DEFAULT 0,
    miss_count INTEGER NOT NULL DEFAULT 0,
    marked_count INTEGER NOT NULL DEFAULT 0,
    first_marked_at TEXT,
    last_reviewed_at TEXT,
    due_at TEXT,
    source_article_id INTEGER,
    source_context TEXT,
    is_manual INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT NOT NULL,
    cleaned_content TEXT,
    word_count INTEGER DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS reading_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'reading',
    article_id INTEGER,
    review_flow_id TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    ended_at TEXT,
    active_seconds INTEGER NOT NULL DEFAULT 0,
    marked_words INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS review_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_id TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'original',
    article_id INTEGER,
    story TEXT,
    word_ids TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    ended_at TEXT,
    results TEXT
  );

  CREATE TABLE IF NOT EXISTS review_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    flow_id TEXT,
    session_type TEXT,
    result TEXT NOT NULL,
    -- UTC ISO 口径(与 reading_sessions.started_at / words.first_marked_at 一致):
    -- 统计用 date(...,'localtime') 聚合, 本地时间文本会被当 UTC 再偏移导致晚间复习跨日
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    module TEXT,
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS ai_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model TEXT,
    prompt_preview TEXT,
    status TEXT,
    error TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS sentence_notes (
    sentence_hash TEXT PRIMARY KEY,
    sentence TEXT NOT NULL,
    article_id INTEGER,
    translation TEXT,
    structure_json TEXT,
    chat_json TEXT,
    quiz_json TEXT,
    model TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- 按文章(或 AI 故事)的 AI 会话线程: thread_key = 'a:<articleId>' 或 't:<文章上下文哈希>'
  -- 同一线程内所有句子的提问按时间顺序累积, 提问 prompt 前缀(system + 文章)保持字节稳定以复用 KV/上下文缓存
  CREATE TABLE IF NOT EXISTS chat_threads (
    thread_key TEXT PRIMARY KEY,
    chat_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS grammar_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_hash TEXT NOT NULL,
    sentence TEXT NOT NULL,
    translation TEXT NOT NULL DEFAULT '',
    article_id INTEGER,
    category TEXT NOT NULL,
    sub TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (sentence_hash, category, sub, detail)
  );

  CREATE TABLE IF NOT EXISTS grammar_terms (
    key TEXT PRIMARY KEY,
    short_exp TEXT,
    full_exp TEXT,
    examples_json TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_words_status ON words(status);
  CREATE INDEX IF NOT EXISTS idx_words_due ON words(due_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON reading_sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_grammar_cat ON grammar_entries(category, sub, detail);
  `)

  // 迁移: 提问测试块(quiz_json)列 —— 旧库升级(建表 IF NOT EXISTS 不会补列)
  // 幂等: 并发实例同时迁移时, 后到者遇 duplicate column 直接忽略
  const snColumns = db.prepare('PRAGMA table_info(sentence_notes)').all().map((c) => c.name)
  if (!snColumns.includes('quiz_json')) {
    try {
      db.prepare('ALTER TABLE sentence_notes ADD COLUMN quiz_json TEXT').run()
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || ''))) throw e
    }
  }

  // 迁移: AI 故事标题列(故事生成要求输出标题; 旧库/旧缓存无此列)
  const rsColumns = db.prepare('PRAGMA table_info(review_sessions)').all().map((c) => c.name)
  if (!rsColumns.includes('title')) {
    try {
      db.prepare('ALTER TABLE review_sessions ADD COLUMN title TEXT').run()
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || ''))) throw e
    }
  }

  // 历史数据迁移: 旧版 review_results.created_at 为本地时间文本(无时区标记),
  // 统计按 UTC 再偏移会把 16:00 后(东八区)的复习算到次日 → 统一为 UTC ISO。幂等。
  try {
    migrateReviewResultsTimezone(db)
  } catch (e) {
    try { db.prepare("INSERT INTO logs (level, module, message) VALUES ('error','db','复习时间迁移失败: ' || ?)").run(String(e?.message || e)) } catch {}
  }

  // 迁移: 旧版「云端/本地双 provider」配置 → 统一 OpenAI 兼容配置(baseUrl/apiKey/model)
  try {
    migrateLegacyAiSettings(db)
  } catch (e) {
    try { db.prepare("INSERT INTO logs (level, module, message) VALUES ('error','db','AI 配置迁移失败: ' || ?)").run(String(e?.message || e)) } catch {}
  }

  // 崩溃恢复: 上次运行未正常结束的会话标记为已结束(此时启动阶段尚无活跃会话, 不会误伤)
  // 统一 UTC ISO 口径, 与 reading_sessions.started_at 及 endSession 写入一致
  db.prepare(
    "UPDATE reading_sessions SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE ended_at IS NULL"
  ).run()

  return db
}

/**
 * 把 review_results.created_at 的旧本地时间文本(如 '2026-01-15 22:30:00')换算为 UTC ISO。
 * 换算 = 原值减去本机时区偏移。只处理不含 'T' 的旧格式行, 幂等; 返回改动行数。
 */
export function migrateReviewResultsTimezone(dbHandle = db) {
  const changes = dbHandle
    .prepare(
      `UPDATE review_results SET created_at =
         strftime('%Y-%m-%dT%H:%M:%fZ', created_at,
           printf('%+g hours', (julianday('now') - julianday('now','localtime')) * 24))
       WHERE created_at NOT LIKE '%T%'`
    )
    .run().changes
  if (changes > 0) {
    try {
      dbHandle.prepare("INSERT INTO logs (level, module, message) VALUES ('info','db','复习时间口径迁移: ' || ? || ' 条')").run(changes)
    } catch { /* 日志失败不影响 */ }
  }
  return changes
}

/**
 * 旧版 AI 配置迁移(幂等): 移除 provider 概念, 统一为 baseUrl/apiKey/model。
 * - provider='local': 用旧 localAi.host/port 拼出 OpenAI 兼容地址(用户仍可自己启动 llama-server 并填同一地址)
 * - 其它 provider: 保留原 baseUrl(缺省 DeepSeek)
 * 迁移后删除不再使用的 localAi 设置键(旧本地服务不再由应用启停)。
 */
export function migrateLegacyAiSettings(dbHandle = db) {
  const read = (key) => {
    const row = dbHandle.prepare('SELECT value FROM settings WHERE key = ?').get(key)
    if (!row) return null
    try { return JSON.parse(row.value) } catch { return null }
  }
  const ai = read('ai')
  if (!ai || typeof ai !== 'object') return 0
  const legacy = read('localAi') || {}
  let changed = false
  if ('provider' in ai) {
    const provider = String(ai.provider || '')
    if (provider === 'local') {
      if (!ai.baseUrl || /api\.deepseek\.com/i.test(String(ai.baseUrl))) {
        ai.baseUrl = `http://${legacy.host || '127.0.0.1'}:${legacy.port || 8093}`
      }
      if (!ai.apiKey || ai.apiKey === 'x') ai.apiKey = 'local'
      if (!ai.model || ai.model === 'deepseek-chat') ai.model = 'local'
    } else if (!ai.baseUrl) {
      ai.baseUrl = 'https://api.deepseek.com'
    }
    delete ai.provider
    changed = true
  }
  if (!ai.baseUrl) { ai.baseUrl = 'https://api.deepseek.com'; changed = true }
  if (!ai.model) { ai.model = 'deepseek-chat'; changed = true }
  if (changed) {
    dbHandle.prepare("INSERT INTO settings (key, value) VALUES ('ai', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(ai))
    try { dbHandle.prepare("INSERT INTO logs (level, module, message) VALUES ('info','db','AI 配置迁移为统一 OpenAI 兼容配置')").run() } catch {}
  }
  // 本地 AI 运行时配置已不再使用
  const hadLocal = dbHandle.prepare("SELECT 1 FROM settings WHERE key = 'localAi'").get()
  if (hadLocal) {
    dbHandle.prepare("DELETE FROM settings WHERE key = 'localAi'").run()
    changed++
  }
  return changed
}

export function log(level, module, message, detail = null) {
  try {
    const stmt = getDb().prepare(
      'INSERT INTO logs (level, module, message, detail) VALUES (?, ?, ?, ?)'
    )
    stmt.run(level, module, message, detail ? JSON.stringify(detail) : null)
  } catch {
    // 日志失败不影响主流程
  }
}

export function getDataDirectory() {
  return getDataDir()
}

/** 主数据库文件路径(供备份等使用; 尊重 ES_DATA_DIR 覆盖) */
export function getDbPath() {
  return resolveDbPath()
}
