import { contextBridge, ipcRenderer } from 'electron'

// API 命名空间与渲染进程调用保持一致
const api = {
  dict: {
    lookup: (word) => ipcRenderer.invoke('dict:lookup', word),
    suggest: (word, limit) => ipcRenderer.invoke('dict:suggest', word, limit),
    lemma: (word) => ipcRenderer.invoke('dict:lemma', word)
  },

  words: {
    list: (filters) => ipcRenderer.invoke('words:list', filters),
    add: (data) => ipcRenderer.invoke('words:add', data),
    mark: (data) => ipcRenderer.invoke('words:mark', data),
    batchMark: (items, opts) => ipcRenderer.invoke('words:batch-mark', items, opts),
    remove: (id) => ipcRenderer.invoke('words:remove', id),
    batchRemove: (ids) => ipcRenderer.invoke('words:batch-remove', ids),
    update: (id, data) => ipcRenderer.invoke('words:update', id, data),
    export: (ids, format) => ipcRenderer.invoke('words:export', ids, format),
    resetProgress: () => ipcRenderer.invoke('words:reset-progress')
  },

  articles: {
    list: (filters) => ipcRenderer.invoke('articles:list', filters),
    create: (data) => ipcRenderer.invoke('articles:create', data),
    get: (id) => ipcRenderer.invoke('articles:get', id),
    remove: (id) => ipcRenderer.invoke('articles:remove', id),
    batchRemove: (ids) => ipcRenderer.invoke('articles:batch-remove', ids),
    clean: (text) => ipcRenderer.invoke('articles:clean', text)
  },

  sessions: {
    start: (data) => ipcRenderer.invoke('sessions:start', data),
    tick: (id, seconds) => ipcRenderer.invoke('sessions:tick', id, seconds),
    end: (id, data) => ipcRenderer.invoke('sessions:end', id, data)
  },

  review: {
    dueToday: () => ipcRenderer.invoke('review:due-today'),
    dueCount: () => ipcRenderer.invoke('review:due-count'),
    dueMeta: () => ipcRenderer.invoke('review:due-meta'),
    postponeAll: () => ipcRenderer.invoke('review:postpone-all'),
    submitWordResult: (data) => ipcRenderer.invoke('review:submit-result', data),
    generateStory: (data) => ipcRenderer.invoke('review:generate-story', data),
    adjustSchedule: () => ipcRenderer.invoke('review:adjust-schedule'),
    scheduleInfo: () => ipcRenderer.invoke('review:schedule-info')
  },

  stats: {
    dashboard: (range) => ipcRenderer.invoke('stats:dashboard', range),
    calendar: (monthOffset) => ipcRenderer.invoke('stats:calendar', monthOffset),
    calendarYear: (year) => ipcRenderer.invoke('stats:calendar-year', year),
    monthly: (year) => ipcRenderer.invoke('stats:monthly', year),
    retention: (days) => ipcRenderer.invoke('stats:retention', days)
  },

  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    getAll: () => ipcRenderer.invoke('settings:get-all'),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    setMany: (values) => ipcRenderer.invoke('settings:set-many', values),
    exportDebug: () => ipcRenderer.invoke('settings:export-debug'),
    backup: () => ipcRenderer.invoke('settings:backup')
  },

  ai: {
    // 学习者画像(词库规模/平均词频/最近文章句长 → 故事难度自动档)
    learnerProfile: () => ipcRenderer.invoke('ai:learner-profile'),
    // 统一 OpenAI 兼容接口的连通性测试 / 可用模型列表
    testConnection: () => ipcRenderer.invoke('ai:test-connection'),
    listModels: () => ipcRenderer.invoke('ai:list-models')
  },

  logs: {
    list: (limit) => ipcRenderer.invoke('logs:list', limit),
    clear: () => ipcRenderer.invoke('logs:clear')
  },

  system: {
    isDev: () => ipcRenderer.invoke('system:is-dev')
  },

  sentence: {
    translate: (d) => ipcRenderer.invoke('sentence:translate', d),
    analyze: (d) => ipcRenderer.invoke('sentence:analyze', d),
    ask: (d) => ipcRenderer.invoke('sentence:ask', d),
    askStream: (d) => ipcRenderer.invoke('sentence:ask-stream', d),
    // 读取按文章的 AI 会话线程 { threadKey, items:[{q,a,sentence,ts}] }
    threadGet: (d) => ipcRenderer.invoke('sentence:thread-get', d),
    onAskDelta: (fn) => {
      const l = (_e, p) => fn(p)
      ipcRenderer.on('sentence:ask-delta', l)
      return () => ipcRenderer.removeListener('sentence:ask-delta', l)
    },
    // 订阅任务进度 { kind:'translate'|'analyze'|'quiz'|'ask', hash, phase:'waiting'|'running'|'retrying', progress }; 返回取消函数
    onProgress: (fn) => {
      const l = (_e, p) => fn(p)
      ipcRenderer.on('sentence:progress', l)
      return () => ipcRenderer.removeListener('sentence:progress', l)
    },
    cached: (hash) => ipcRenderer.invoke('sentence:cached', hash),
    cancel: () => ipcRenderer.invoke('sentence:cancel'),
    clearCache: () => ipcRenderer.invoke('sentence:clear-cache'),
    cacheStats: () => ipcRenderer.invoke('sentence:cache-stats'),
    hash: (text) => ipcRenderer.invoke('sentence:hash', text),
    quiz: (d) => ipcRenderer.invoke('sentence:quiz', d),
    quizSubmit: (d) => ipcRenderer.invoke('sentence:quiz-submit', d)
  },

  grammar: {
    stats: () => ipcRenderer.invoke('grammar:stats'),
    list: (f) => ipcRenderer.invoke('grammar:list', f),
    remove: (id) => ipcRenderer.invoke('grammar:remove', id),
    batchRemove: (ids) => ipcRenderer.invoke('grammar:batch-remove', ids),
    termExplain: (key) => ipcRenderer.invoke('grammar:term-explain', key),
    termSave: (key, data) => ipcRenderer.invoke('grammar:term-save', key, data),
    termReset: (key) => ipcRenderer.invoke('grammar:term-reset', key),
    search: (q) => ipcRenderer.invoke('grammar:search', q)
  }
}

contextBridge.exposeInMainWorld('api', api)
