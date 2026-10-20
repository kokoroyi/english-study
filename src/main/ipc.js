import { ipcMain, dialog } from 'electron'
import { lookupWord, suggestWords, resolveLemma } from './dict/dictionary.js'
import {
  markWord, batchMarkWords, listWords, removeWord, batchRemoveWords,
  updateWord, addWordManually, exportWords, resetAllProgress
} from './services/words.js'
import { createArticle, listArticles, getArticle, removeArticle, batchRemoveArticles, cleanText, recentArticles } from './services/articles.js'
import { startSession, tickSession, endSession } from './services/sessions.js'
import { submitWordResult, dueWords, dueWordsCount, dueWordsMeta, memoryOverview, forecastDue, retentionStats, postponeAllDue } from './services/review.js'
import { generateStory, adjustScheduleWithAi, shouldAdjustSchedule, getLearnerProfile, testAiConnection, listAiModels } from './services/ai.js'
import { dashboard, calendarData, calendarYearData, monthlyTrend } from './services/stats.js'
import { getSettings, getSetting, setSetting, setSettings } from './services/settings.js'
import { getDb, getDbPath } from './db/database.js'
import {
  translateSentence, analyzeSentence, askSentence, askThreadStream, getThreadChat,
  getCachedSentence, cancelCurrentTask, clearSentenceCache, getSentenceCacheStats, hashSentence,
  makeQuiz, submitQuizAnswers, runQueued
} from './services/sentenceStudio.js'
import {
  grammarStats, listGrammarEntries, removeGrammarEntry, batchRemoveGrammarEntries,
  getTermExplanation, saveTermExplanation, resetTermExplanation, searchGrammar
} from './services/grammar.js'
import { writeFile } from 'fs/promises'

/** 任务进度主→渲染推送(renderer 经 preload onProgress 订阅) */
function sendProgress(event, kind, hash, p) {
  if (!event.sender.isDestroyed()) {
    event.sender.send('sentence:progress', { kind, hash, ...(p || {}) })
  }
}

export function registerIpcHandlers() {
  // 词典
  ipcMain.handle('dict:lookup', (_e, word) => lookupWord(word))
  ipcMain.handle('dict:suggest', (_e, word, limit) => suggestWords(word, limit))
  ipcMain.handle('dict:lemma', (_e, word) => resolveLemma(word))

  // 单词
  ipcMain.handle('words:list', (_e, filters) => listWords(filters))
  ipcMain.handle('words:add', (_e, data) => addWordManually(data.word))
  ipcMain.handle('words:mark', (_e, data) => markWord(data))
  ipcMain.handle('words:batch-mark', (_e, items, opts) => batchMarkWords(items, opts))
  ipcMain.handle('words:remove', (_e, id) => removeWord(id))
  ipcMain.handle('words:batch-remove', (_e, ids) => batchRemoveWords(ids))
  ipcMain.handle('words:update', (_e, id, data) => updateWord(id, data))
  ipcMain.handle('words:reset-progress', () => resetAllProgress())
  ipcMain.handle('words:export', async (_e, ids, format) => {
    const r = exportWords(ids, format)
    if (!r.ok) return r
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: r.filename,
      filters: [{ name: '数据文件', extensions: [format] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    try {
      await writeFile(filePath, r.content, 'utf-8')
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: `写入文件失败: ${e.message}` }
    }
  })

  // 文章
  ipcMain.handle('articles:list', (_e, filters) => listArticles(filters))
  ipcMain.handle('articles:create', (_e, data) => createArticle(data))
  ipcMain.handle('articles:get', (_e, id) => getArticle(id))
  ipcMain.handle('articles:remove', (_e, id) => removeArticle(id))
  ipcMain.handle('articles:batch-remove', (_e, ids) => batchRemoveArticles(ids))
  ipcMain.handle('articles:clean', (_e, text) => cleanText(text))

  // 会话
  ipcMain.handle('sessions:start', (_e, data) => startSession(data))
  ipcMain.handle('sessions:tick', (_e, id, seconds) => tickSession(id, seconds))
  ipcMain.handle('sessions:end', (_e, id, data) => endSession(id, data))

  // 复习
  ipcMain.handle('review:due-today', () => dueWords())
  ipcMain.handle('review:due-count', () => dueWordsCount())
  ipcMain.handle('review:due-meta', () => dueWordsMeta())
  ipcMain.handle('review:postpone-all', () => postponeAllDue())
  ipcMain.handle('review:submit-result', (_e, data) => submitWordResult(data))
  ipcMain.handle('review:generate-story', async (_e, data) => {
    // 未提供来源文章时, 自动用最近 1-2 篇阅读文本作为难度参考
    let payload = data
    if (!payload.sourceArticle) {
      const recent = recentArticles(2)
      if (recent && recent.length) {
        // 拼接最近文章作为难度参考(取最长/最新的那篇)
        payload = { ...payload, sourceArticle: recent[0] }
      }
    }
    // 全局单并发队列: 故事生成与句子解析任务互斥(PLAN 决策)
    return runQueued(() => generateStory(payload))
  })
  ipcMain.handle('review:adjust-schedule', async () => {
    if (!shouldAdjustSchedule()) return { ok: false, error: '未到 15 天调整周期' }
    // 间隔调整同样走全局单并发队列(与句子任务互斥)
    return runQueued(() => adjustScheduleWithAi())
  })
  ipcMain.handle('review:schedule-info', () => ({ due: dueWords(), memory: memoryOverview(), forecast: forecastDue(14) }))

  // 统计
  ipcMain.handle('stats:dashboard', (_e, range) => dashboard(range))
  ipcMain.handle('stats:calendar', (_e, monthOffset) => calendarData(monthOffset || 0))
  ipcMain.handle('stats:calendar-year', (_e, year) => calendarYearData(year))
  ipcMain.handle('stats:monthly', (_e, year) => monthlyTrend(year))
  ipcMain.handle('stats:retention', (_e, days) => retentionStats(days || 90))

  // 设置
  ipcMain.handle('settings:get', (_e, key) => getSetting(key))
  ipcMain.handle('settings:get-all', () => getSettings())
  ipcMain.handle('settings:set', (_e, key, value) => setSetting(key, value))
  ipcMain.handle('settings:set-many', (_e, values) => setSettings(values))

  // AI: 统一 OpenAI 兼容配置的测试连接 / 获取模型列表 / 学习者画像
  ipcMain.handle('ai:learner-profile', () => getLearnerProfile())
  ipcMain.handle('ai:test-connection', async () => {
    try {
      return { ok: true, ...(await testAiConnection()) }
    } catch (e) {
      return { ok: false, error: e.message || String(e) }
    }
  })
  ipcMain.handle('ai:list-models', async () => {
    try {
      return { ok: true, ...(await listAiModels()) }
    } catch (e) {
      return { ok: false, error: e.message || String(e) }
    }
  })

  // 日志
  ipcMain.handle('logs:list', (_e, limit = 200) => {
    const rows = getDb()
      .prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?')
      .all(limit)
    return rows
  })
  ipcMain.handle('logs:clear', () => getDb().prepare('DELETE FROM logs').run())

  // 调试包导出
  ipcMain.handle('settings:export-debug', async () => {
    const db = getDb()
    const logs = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 200').all()
    const aiCalls = db.prepare('SELECT * FROM ai_calls ORDER BY id DESC LIMIT 100').all()
    const settings = getSettings()
    // API key 打码
    if (settings.ai?.apiKey) settings.ai.apiKey = '***' + settings.ai.apiKey.slice(-4)
    const words = db.prepare('SELECT * FROM words ORDER BY id DESC LIMIT 500').all()
    const content = JSON.stringify({ exportedAt: new Date().toISOString(), settings, logs, aiCalls, words }, null, 2)
    const name = `english-study-debug-${Date.now()}.json`
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: name,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    await writeFile(filePath, content, 'utf-8')
    return { ok: true, path: filePath }
  })

  ipcMain.handle('settings:backup', async () => {
    // 原实现写死 %APPDATA% 路径: 非 Windows / 使用 ES_DATA_DIR 覆盖时会备份错文件甚至崩溃
    const src = getDbPath()
    const { copyFile } = await import('fs/promises')
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `english-study-backup-${Date.now()}.db`,
      filters: [{ name: 'SQLite 数据库', extensions: ['db'] }]
    })
    if (canceled || !filePath) return { ok: false, canceled: true }
    // 先 checkpoint WAL 确保数据完整
    try { getDb().pragma('wal_checkpoint(TRUNCATE)') } catch {}
    try {
      await copyFile(src, filePath)
      return { ok: true, path: filePath }
    } catch (e) {
      return { ok: false, error: `备份失败: ${e.message}` }
    }
  })

  ipcMain.handle('system:is-dev', () => !!process.env['ELECTRON_RENDERER_URL'])

  // 句子解析
  ipcMain.handle('sentence:translate', (event, d) => {
    const hash = d?.sentence ? hashSentence(d.sentence) : null
    return translateSentence({ ...(d || {}), onProgress: (p) => sendProgress(event, 'translate', hash, p) })
  })
  ipcMain.handle('sentence:analyze', (event, d) => {
    const hash = d?.sentence ? hashSentence(d.sentence) : null
    return analyzeSentence({ ...(d || {}), onProgress: (p) => sendProgress(event, 'analyze', hash, p) })
  })
  ipcMain.handle('sentence:ask', (_e, d) => (d?.threadKey ? askThreadStream(d) : askSentence(d)))
  ipcMain.handle('sentence:ask-stream', async (event, d) => {
    return askThreadStream({
      ...(d || {}),
      onProgress: (p) => sendProgress(event, 'ask', d?.threadKey || null, p),
      onDelta: (delta) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('sentence:ask-delta', { threadKey: d?.threadKey || null, delta })
        }
      }
    })
  })
  ipcMain.handle('sentence:thread-get', (_e, d) => getThreadChat(d?.threadKey, { articleTitle: d?.articleTitle || '', articleText: d?.articleText || '' }))
  ipcMain.handle('sentence:cached', (_e, hash) => getCachedSentence(hash))
  ipcMain.handle('sentence:cancel', () => cancelCurrentTask())
  ipcMain.handle('sentence:clear-cache', () => clearSentenceCache())
  ipcMain.handle('sentence:cache-stats', () => getSentenceCacheStats())
  ipcMain.handle('sentence:hash', (_e, text) => hashSentence(text))
  ipcMain.handle('sentence:quiz', (event, d) => {
    const hash = d?.sentence ? hashSentence(d.sentence) : null
    return makeQuiz({ ...(d || {}), onProgress: (p) => sendProgress(event, 'quiz', hash, p) })
  })
  ipcMain.handle('sentence:quiz-submit', (_e, d) => submitQuizAnswers(d))

  // 语法本
  ipcMain.handle('grammar:stats', () => grammarStats())
  ipcMain.handle('grammar:list', (_e, f) => listGrammarEntries(f || {}))
  ipcMain.handle('grammar:remove', (_e, id) => removeGrammarEntry(id))
  ipcMain.handle('grammar:batch-remove', (_e, ids) => batchRemoveGrammarEntries(ids))
  // 术语解释(语法本知识卡片 + 工作区弹窗)
  ipcMain.handle('grammar:term-explain', (_e, key) => getTermExplanation(key))
  ipcMain.handle('grammar:term-save', (_e, key, data) => saveTermExplanation(key, data))
  ipcMain.handle('grammar:term-reset', (_e, key) => resetTermExplanation(key))
  // 语法本搜索(分类术语 + 例句)
  ipcMain.handle('grammar:search', (_e, q) => searchGrammar(q))
}
