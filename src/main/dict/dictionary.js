import { join } from 'path'
import { homedir } from 'os'
import { existsSync, copyFileSync, linkSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { getDataDir } from '../db/schema.js'
import { log } from '../db/database.js'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const DICT_FILENAME = 'stardict.db'

// 词典源候选路径(依次尝试):
// 1. 环境变量 ES_DICT_SOURCE(显式指定)
// 2. 项目根目录 data/stardict.db(词典已随项目存放; dev/run.bat 的 cwd 都是项目根)
// 3. 下载目录 work/ECDICT(历史位置, 兼容老安装)
// 4. 下载目录根(历史位置, 兼容老安装)
const PROJECT_DICT = join(process.cwd(), 'data', DICT_FILENAME)
const DOWNLOADS_DICT = join(homedir(), 'Downloads', 'work', 'ECDICT', DICT_FILENAME)
const DOWNLOADS_FLAT_DICT = join(homedir(), 'Downloads', DICT_FILENAME)

/** 找到第一个存在的词典源文件; 都不存在返回 null */
export function findDictSource() {
  const candidates = [process.env.ES_DICT_SOURCE, PROJECT_DICT, DOWNLOADS_DICT, DOWNLOADS_FLAT_DICT].filter(Boolean)
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

let dict = null

// 词典副本路径:data/stardict.db
export function getDictPath() {
  return join(getDataDir(), DICT_FILENAME)
}

// 首次启动把词典源文件迁移到 data/ 目录(源文件保留)。
// 用硬链接替代完整复制: 源与 data/ 通常同盘, 秒完成且不占额外空间。
// 硬链接失败(跨盘/文件系统不支持)时回退复制。
export async function ensureDictMigrated() {
  const dest = getDictPath()
  if (existsSync(dest)) return { ok: true, path: dest, source: 'local' }

  const src = findDictSource()
  if (!src) {
    const msg = `未找到词典源文件。已尝试:\n${[
      process.env.ES_DICT_SOURCE,
      PROJECT_DICT,
      DOWNLOADS_DICT,
      DOWNLOADS_FLAT_DICT
    ]
      .filter(Boolean)
      .join('\n')}\n\n可通过环境变量 ES_DICT_SOURCE 指定路径`
    log('error', 'dict', msg)
    return { ok: false, error: msg }
  }

  mkdirSync(getDataDir(), { recursive: true })
  try {
    linkSync(src, dest)
    log('info', 'dict', `词典已通过硬链接迁移到 ${dest}`)
  } catch {
    try {
      copyFileSync(src, dest)
      log('info', 'dict', `词典已复制到 ${dest}`)
    } catch (e) {
      const msg = `词典迁移失败(硬链接与复制均失败): ${e.message}`
      log('error', 'dict', msg)
      return { ok: false, error: msg }
    }
  }
  return { ok: true, path: dest, source: 'migrated' }
}

export function initDictionary() {
  const path = getDictPath()
  if (!existsSync(path)) {
    log('error', 'dict', `词典文件不存在: ${path}`)
    return null
  }
  dict = new Database(path, { readonly: true })
  log('info', 'dict', `词典加载成功: ${path}`)
  return dict
}

function stripWord(word) {
  return word
    .split('')
    .filter((c) => /[a-zA-Z0-9]/.test(c))
    .join('')
    .toLowerCase()
}

/**
 * 查询单词。优先精确匹配 word 字段,失败则用 sw 模糊匹配前缀。
 * 返回 null 表示未找到。
 */
export function lookupWord(word) {
  if (!dict) return null
  if (!word || !word.trim()) return null
  const clean = word.trim()

  let row = null
  try {
    row = dict.prepare('SELECT * FROM stardict WHERE word = ?').get(clean)
  } catch {
    return null
  }

  if (!row) {
    const sw = stripWord(clean)
    try {
      row = dict.prepare('SELECT * FROM stardict WHERE sw = ? LIMIT 1').get(sw)
    } catch {
      return null
    }
  }

  if (!row) return null

  return {
    word: row.word,
    phonetic: row.phonetic || '',
    definition: row.definition || '',
    translation: row.translation || '',
    pos: row.pos || '',
    collins: row.collins || '',
    oxford: row.oxford || '',
    tag: row.tag || '',
    bnc: row.bnc || null,
    frq: row.frq || null,
    exchange: row.exchange || '',
    sw: row.sw || stripWord(row.word)
  }
}

/**
 * 模糊建议:输入前缀返回候选单词。
 */
export function suggestWords(word, limit = 10) {
  if (!dict) return []
  const sw = stripWord(word)
  if (!sw) return []
  try {
    const rows = dict
      .prepare('SELECT word, translation FROM stardict WHERE sw LIKE ? LIMIT ?')
      .all(sw + '%', limit)
    return rows.map((r) => ({ word: r.word, translation: (r.translation || '').split('\n')[0] }))
  } catch {
    return []
  }
}

/**
 * 通过 exchange 字段解析词的原型(lemma)。
 * 返回原型;查不到时原样返回。
 */
export function resolveLemma(word) {
  if (!word) return word
  const entry = lookupWord(word)
  if (!entry) return word.toLowerCase()

  const exchange = entry.exchange || ''
  // 形如 0:perceive 的条目代表 lemma
  const lemmaMatch = exchange.match(/(?:^|\/)0:([^/]+)/)
  if (lemmaMatch && lemmaMatch[1]) {
    const lemma = lemmaMatch[1].trim()
    if (lemma && lemma !== word.toLowerCase()) return lemma
  }
  return word.toLowerCase()
}

export function isDictReady() {
  return dict !== null
}

export function closeDictionary() {
  if (dict) {
    try { dict.close() } catch {}
    dict = null
  }
}
