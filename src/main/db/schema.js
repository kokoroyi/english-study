import { join } from 'path'
import { mkdirSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// 数据目录解析。
// 优先: ES_DATA_DIR 环境变量(测试/调试用)
// 其次: Electron userData 目录(正常应用)
export function getDataDir() {
  const override = process.env.ES_DATA_DIR
  if (override) {
    mkdirSync(join(override, 'data'), { recursive: true })
    return join(override, 'data')
  }
  let userData
  try {
    const { app } = require('electron')
    userData = app.getPath('userData')
  } catch {
    userData = process.cwd()
  }
  const dir = join(userData, 'data')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getDbPath() {
  return join(getDataDir(), 'english-study.db')
}

export const DEFAULT_EBBINGHAUS = {
  newbie: [1, 2, 4, 7, 15, 30], // 生词阶段间隔(天)
  fluent: [7, 15, 30, 60, 90] // 熟词阶段间隔(天)
}

export const WORD_STATUS = {
  NEW: 'new', // 生词(刚标记)
  LEARNING: 'learning', // 学习中
  FLUENT: 'fluent' // 熟词
}
