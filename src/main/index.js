import { app, BrowserWindow, shell, dialog } from 'electron'
import { join } from 'path'
import { initDatabase } from './db/database.js'
import { initDictionary, ensureDictMigrated } from './dict/dictionary.js'
import { registerIpcHandlers } from './ipc.js'
import { isTaskRunning, cancelCurrentTask } from './services/sentenceStudio.js'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'English Study',
    backgroundColor: '#f5f7fa',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 推理任务进行中退出 → 二次确认, 防止误关丢失正在生成的回答
  win.on('close', (e) => {
    if (!isTaskRunning()) return
    e.preventDefault()
    dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'AI 任务进行中',
        message: 'AI 正在生成回答, 退出将中断当前任务。',
        detail: '已完成的翻译/解析不会丢失; 未完成的回答会中断。',
        buttons: ['继续退出', '取消'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response !== 0) return
        cancelCurrentTask()
        win.destroy() // 绕过 close 事件, 直接销毁
      })
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  try {
    initDatabase()
    await ensureDictMigrated()
    initDictionary()
    registerIpcHandlers()
  } catch (err) {
    // 数据库初始化失败时继续打开窗口只会得到所有 IPC 报错的半残界面,
    // 明确提示后退出更利于排查
    console.error('[init] 初始化失败:', err)
    dialog.showErrorBox('初始化失败', `应用数据初始化失败:\n${err?.message || err}\n\n请查看日志或导出调试包后反馈。`)
    app.quit()
    return
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
