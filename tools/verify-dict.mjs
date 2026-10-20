// 校验 ECDICT 词典文件：能被 better-sqlite3 打开，且包含 stardict 表/记录。
// 用法: node tools/verify-dict.mjs <path-to-stardict.db>
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('dictionary path is required')
  process.exit(1)
}

let db = null
try {
  db = new Database(dbPath, { readonly: true })
  const table = db
    .prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'stardict'")
    .get()
  if (!table || !table.c) throw new Error('stardict table not found')
  const rows = db.prepare('SELECT COUNT(*) AS c FROM stardict').get()
  console.log(`dictionary OK (${rows.c} entries)`)
  db.close()
  process.exit(0)
} catch (e) {
  try { db?.close() } catch {}
  console.error(`dictionary verify failed: ${e.message}`)
  process.exit(1)
}
