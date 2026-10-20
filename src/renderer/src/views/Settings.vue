<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { store } from '../store'
import { toast } from '../lib/toast'
import { plain } from '../lib/ipcSafe'
import { alert, confirm, confirmDanger } from '../lib/modal'
import { getAdhdMode, withAdhdMode, ADHD_MODE_LABEL, ADHD_MODE_DESC } from '../lib/adhdMode'

const s = reactive({
  ai: {},
  review: {},
  appearance: {},
  behavior: {},
  quiz: {}
})

const activeSection = ref('ai')
const saving = ref(false)
const saved = ref(false)
const logs = ref([])
const adjustResult = ref(null)
const adjustLoading = ref(false)
const aiTesting = ref(false)
const aiTestResult = ref(null)
const aiModels = ref([])
const aiModelsLoading = ref(false)
const sentenceCache = ref(null) // 句子解析缓存统计
const learnerProfile = ref(null) // 学习者画像(词库/词频/句长 → 故事难度自动档)

async function refreshLearnerProfile() {
  try {
    learnerProfile.value = await window.api.ai?.learnerProfile?.()
  } catch {
    learnerProfile.value = null
  }
}

async function loadSentenceCache() {
  try {
    sentenceCache.value = await window.api.sentence.cacheStats()
  } catch {
    sentenceCache.value = null
  }
}
function fmtCacheSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
async function clearSentenceCache() {
  const ok = await confirmDanger(
    '清空句子解析缓存',
    `将删除 ${sentenceCache.value?.count ?? 0} 条已解析句子(翻译/成分拆分/提问测试)与 ${sentenceCache.value?.threadCount ?? 0} 个「按文章 AI 会话」记录。\n\n之后重新选中这些句子时需要重新解析(重新调用 AI), 文章提问历史也会清空; 语法本已收录的例句不受影响。`
  )
  if (!ok) return
  try {
    const r = await window.api.sentence.clearCache()
    toast(`已清空 ${r.cleared} 条句子缓存${r.threads ? ` / ${r.threads} 个文章会话` : ''}`, 'info')
    await loadSentenceCache()
  } catch (e) {
    toast('清空失败: ' + (e.message || String(e)), 'error')
  }
}

const sections = [
  { key: 'ai', label: 'AI 设置', icon: 'sparkles' },
  { key: 'review', label: '复习参数', icon: 'calendar' },
  { key: 'appearance', label: '外观', icon: 'palette' },
  { key: 'behavior', label: '行为', icon: 'settings' },
  { key: 'quiz', label: '提问测试', icon: 'help' },
  { key: 'data', label: '数据管理', icon: 'database' },
  { key: 'logs', label: '日志', icon: 'terminal' }
]

// 历史数据可能缺少 adhd 子对象/字段, 补齐后模板里的 v-model 才不会访问 undefined 崩溃
const DEFAULT_ADHD = {
  mode: 'bionic',
  bionicEnabled: true,
  splitRatio: 0.35,
  leadScale: 1.12,
  letterSpacing: 0.04,
  wordSpacing: 0.1,
  baseScale: 1.08,
  semanticEnabled: false,
  semanticDensity: 0.25
}
const DEFAULT_QUIZ = { questionsPerBatch: 3, difficulty: 2, judgeMode: 'immediate' }

function loadSettings() {
  const all = store.settings
  if (!all) return
  // 用纯对象拷贝, 避免 reactive 代理进入 IPC
  s.ai = plain(all.ai || {})
  delete s.ai.provider // 旧版字段, 统一接口后不再使用
  s.review = plain(all.review || {})
  s.appearance = plain(all.appearance || {})
  if (!s.appearance.adhd || typeof s.appearance.adhd !== 'object') s.appearance.adhd = {}
  s.appearance.adhd = withAdhdMode({ ...DEFAULT_ADHD, ...plain(s.appearance.adhd) }, getAdhdMode({ adhd: { ...DEFAULT_ADHD, ...plain(s.appearance.adhd) } }))
  s.behavior = plain(all.behavior || {})
  s.quiz = { ...DEFAULT_QUIZ, ...plain(all.quiz || {}) }
  if (Array.isArray(s.review.newbie)) s.review.newbie = s.review.newbie.join(', ')
  if (Array.isArray(s.review.fluent)) s.review.fluent = s.review.fluent.join(', ')
}

// 选择风格模板 → 写入自定义风格字段
function onStylePreset() {
  if (s.ai.stylePreset) {
    s.ai.storyStyle = s.ai.stylePreset
  }
}

// ADHD 阅读模式: 单一 mode(语义/Bionic/普通), 与阅读页右上角按钮同一口径
const adhdModeKey = computed(() => getAdhdMode({ adhd: s.appearance.adhd }))
function setAdhdMode(mode) {
  s.appearance.adhd = withAdhdMode(s.appearance.adhd, mode)
}

onMounted(async () => {
  await store.init()
  loadSettings()
  refreshLearnerProfile() // 首屏(默认 AI 分区)就要显示画像, 不能只在切分区时加载
  loadLogs()
  loadSentenceCache()
})

async function loadLogs() {
  try {
    logs.value = await window.api.logs.list(100)
  } catch (e) {
    console.error('日志加载失败', e)
    logs.value = []
  }
}

// AI 分区激活时刷新学习者画像(词频/句长统计随词库与文章变化)
watch(activeSection, (sec) => {
  if (sec === 'ai') refreshLearnerProfile()
})
async function save() {
  saving.value = true
  saved.value = false
  try {
    const review = { ...s.review }
    review.newbie = parseIntervals(review.newbie)
    review.fluent = parseIntervals(review.fluent)
    // 清空/非法间隔表会导致 due_at 变成 NaN 日期、单词永远不再到期, 保存前必须拦截
    if (!review.newbie.length) {
      throw new Error('生词阶段间隔不能为空, 请填写如 1, 2, 4, 7, 15, 30')
    }
    if (!review.fluent.length) {
      throw new Error('熟词阶段间隔不能为空, 请填写如 7, 15, 30, 60, 90')
    }
    if (!Number.isInteger(review.promoteAfterKnown) || review.promoteAfterKnown < 1 || review.promoteAfterKnown > 30) {
      throw new Error('连续认识升熟词次数需为 1~30 的整数')
    }
    if (!Number.isInteger(review.dailyLimit) || review.dailyLimit < 0 || review.dailyLimit > 5000) {
      throw new Error('每日复习上限需为 0~5000 的整数(0=不限)')
    }
    if (!Number.isInteger(review.dailyNewLimit) || review.dailyNewLimit < 0 || review.dailyNewLimit > 1000) {
      throw new Error('每日新词配额需为 0~1000 的整数(0=不限)')
    }
    if (!['overdue', 'newFirst'].includes(review.orderStrategy)) {
      throw new Error('复习顺序策略无效')
    }

    const qz = s.quiz || {}
    if (![3, 4, 5].includes(qz.questionsPerBatch)) {
      throw new Error('每批题数需为 3/4/5')
    }
    if (![1, 2, 3].includes(qz.difficulty)) {
      throw new Error('难度需为 基础/标准/挑战')
    }
    if (!['immediate', 'afterAll'].includes(qz.judgeMode)) {
      throw new Error('判分方式需为 即时判分/交卷后判分')
    }
    await window.api.settings.setMany(
      plain({
        ai: s.ai,
        review,
        appearance: s.appearance,
        behavior: s.behavior,
        quiz: s.quiz
      })
    )
    await store.refreshSettings()
    saved.value = true
    toast('设置已保存')
    setTimeout(() => (saved.value = false), 2000)
    return true
  } catch (e) {
    console.error('保存失败', e)
    toast('保存失败: ' + (e.message || String(e)), 'error')
    return false
  } finally {
    saving.value = false
  }
}

function parseIntervals(str) {
  if (Array.isArray(str)) return str
  return (str || '')
    .split(/[,，\s]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 365)
}

/** 只保存 AI 配置: 测试连接/获取模型不应被其他分区未保存或非法表单值阻塞 */
async function saveAiOnly() {
  try {
    await window.api.settings.set('ai', plain(s.ai))
    await store.refreshSettings()
    return true
  } catch (e) {
    toast('AI 配置保存失败: ' + (e.message || String(e)), 'error')
    return false
  }
}

async function testAi() {
  // 先保存当前 AI 配置, 再测试(保证测的就是即将使用的配置)
  const ok = await saveAiOnly()
  if (!ok) return
  aiTesting.value = true
  aiTestResult.value = null
  try {
    const res = await window.api.ai.testConnection()
    aiTestResult.value = res
    if (res?.ok) {
      toast(res.message || '连接成功')
      if (Array.isArray(res.models) && res.models.length) aiModels.value = res.models
    } else {
      toast('连接失败: ' + (res?.error || '未知错误'), 'error')
    }
  } catch (e) {
    aiTestResult.value = { ok: false, error: e.message || String(e) }
    toast('连接测试失败: ' + (e.message || e), 'error')
  } finally {
    aiTesting.value = false
  }
}

/** 从 OpenAI 兼容接口拉取可用模型(GET {base}/models), 供下拉选择 */
async function fetchModels() {
  // 先保存地址/Key, 否则主进程读到的还是旧配置
  const ok = await saveAiOnly()
  if (!ok) return
  aiModelsLoading.value = true
  try {
    const res = await window.api.ai.listModels()
    if (!res?.ok) throw new Error(res?.error || '获取模型失败')
    aiModels.value = res.models || []
    if (!aiModels.value.length) throw new Error('接口未返回可用模型')
    if (!aiModels.value.includes(s.ai.model)) s.ai.model = aiModels.value[0]
    toast(`已获取 ${aiModels.value.length} 个模型, 当前选择: ${s.ai.model}`)
  } catch (e) {
    toast('获取模型失败: ' + (e.message || String(e)), 'error')
  } finally {
    aiModelsLoading.value = false
  }
}

async function runAdjust() {
  adjustLoading.value = true
  adjustResult.value = null
  try {
    const res = await window.api.review.adjustSchedule()
    if (res.ok) {
      adjustResult.value = { ok: true, ...res }
    } else {
      adjustResult.value = { ok: false, error: res.error }
    }
  } catch (e) {
    adjustResult.value = { ok: false, error: e.message }
  } finally {
    adjustLoading.value = false
  }
}

async function applyAdjust() {
  if (!adjustResult.value?.newbie) return
  s.review.newbie = adjustResult.value.newbie.join(', ')
  s.review.fluent = adjustResult.value.fluent.join(', ')
  await save()
}

async function exportDebug() {
  const res = await window.api.settings.exportDebug()
  if (res.ok) await alert('导出成功', `调试包已导出到:\n${res.path}`)
}

async function backup() {
  const res = await window.api.settings.backup()
  if (res.ok) await alert('备份成功', `数据备份已保存到:\n${res.path}`)
}

async function clearLogs() {
  const ok = await confirm('清空日志', '确定清空全部日志吗?')
  if (!ok) return
  await window.api.logs.clear()
  loadLogs()
}

function fmtTime(iso) {
  if (!iso) return ''
  return iso.replace('T', ' ').slice(0, 19)
}

function levelClass(l) {
  return { error: 'critical', warn: 'warning', info: 'info' }[l] || 'info'
}
</script>

<template>
  <div class="ca-page settings-page">
    <div class="ca-page-header">
      <div>
        <h1 class="ca-page-title">设置</h1>
        <p class="ca-page-desc">AI、复习、外观与数据管理</p>
      </div>
      <div class="flex">
        <span v-if="saved" class="save-hint">✓ 已保存</span>
        <button class="ca-btn ca-btn--primary" @click="save" :disabled="saving">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </div>

    <div class="settings-layout">
      <div class="settings-nav ca-card">
        <button
          v-for="sec in sections"
          :key="sec.key"
          class="settings-nav-item"
          :class="{ active: activeSection === sec.key }"
          @click="activeSection = sec.key"
        >
          <span class="sn-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <template v-if="sec.icon === 'sparkles'"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></template>
              <template v-else-if="sec.icon === 'calendar'"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></template>
              <template v-else-if="sec.icon === 'palette'"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></template>
              <template v-else-if="sec.icon === 'database'"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></template>
              <template v-else-if="sec.icon === 'cpu'"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="2" x2="9" y2="5"/><line x1="15" y1="2" x2="15" y2="5"/><line x1="9" y1="19" x2="9" y2="22"/><line x1="15" y1="19" x2="15" y2="22"/><line x1="2" y1="9" x2="5" y2="9"/><line x1="2" y1="15" x2="5" y2="15"/><line x1="19" y1="9" x2="22" y2="9"/><line x1="19" y1="15" x2="22" y2="15"/></template>
              <template v-else-if="sec.icon === 'terminal'"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></template>
              <template v-else-if="sec.icon === 'help'"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.4-3 4"/><line x1="12" y1="17" x2="12.01" y2="17"/></template>
              <template v-else><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></template>
            </svg>
          </span>
          {{ sec.label }}
        </button>
      </div>

      <div class="settings-content ca-card">
        <!-- AI -->
        <div v-if="activeSection === 'ai'" class="settings-pane">
          <h3>AI 设置</h3>
          <p class="pane-desc">任意 OpenAI 兼容接口(云端服务或自建本地服务均可), 全文翻译/解析/提问/故事共用同一套配置</p>

          <div class="form-row">
            <label>接口地址</label>
            <input v-model="s.ai.baseUrl" class="ca-input" placeholder="https://api.deepseek.com 或 https://api.openai.com/v1" />
            <span class="hint">填 OpenAI 兼容 Base URL; 未带版本号时自动补 /v1(如 https://api.deepseek.com → /v1/chat/completions)</span>
          </div>
          <div class="form-row">
            <label>API Key</label>
            <input v-model="s.ai.apiKey" class="ca-input" type="password" placeholder="sk-…" />
            <span class="hint">本地自建服务通常不校验 Key, 可填任意非空值(如 local)</span>
          </div>
          <div class="form-row">
            <label>模型</label>
            <div class="flex ai-model-row">
              <input v-model="s.ai.model" class="ca-input" list="ai-model-options" placeholder="deepseek-chat" />
              <button class="ca-btn" @click="fetchModels" :disabled="aiModelsLoading">{{ aiModelsLoading ? '获取中…' : '获取模型' }}</button>
            </div>
            <datalist id="ai-model-options">
              <option v-for="m in aiModels" :key="m" :value="m" />
            </datalist>
            <span class="hint">{{ aiModels.length ? `接口返回 ${aiModels.length} 个模型, 可在输入框下拉中选择` : '填好接口地址与 Key 后可点「获取模型」; 也可手动填写模型名' }}</span>
          </div>
          <div class="form-row">
            <label>每批生词数</label>
            <input v-model.number="s.ai.batchSize" class="ca-input" type="number" min="5" max="40" />
          </div>
          <div class="form-row">
            <label>故事目标长度(词)</label>
            <input v-model.number="s.ai.storyWordCount" class="ca-input" type="number" min="100" max="1000" />
          </div>
          <div class="form-row">
            <label>故事风格</label>
            <select v-model="s.ai.stylePreset" class="ca-select" @change="onStylePreset">
              <option value="">选择模板…</option>
              <option v-for="t in (s.ai.storyTemplates || [])" :key="t" :value="t">{{ t }}</option>
            </select>
            <span class="hint">可选模板或自定义</span>
          </div>
          <div class="form-row">
            <label>自定义风格</label>
            <input v-model="s.ai.storyStyle" class="ca-input" placeholder="例: 科幻冒险, 悬疑推理, 温暖日常…" />
          </div>
          <div class="form-row">
            <label>巩固词混入比例</label>
            <input v-model.number="s.ai.consolidateRatio" class="ca-input" type="number" min="0" max="0.5" step="0.05" />
            <span class="hint">0.25 = 25%</span>
          </div>
          <div class="form-row">
            <label>故事难度策略</label>
            <select v-model="s.ai.storyDifficulty" class="ca-select story-diff-select">
              <option value="auto">自动(根据词库与最近文章)</option>
              <option value="basic">基础(词频前 3000)</option>
              <option value="standard">标准(词频前 5000)</option>
              <option value="advanced">进阶(词频前 8000)</option>
            </select>
            <span class="hint">生成故事时按档位约束词汇难度与平均句长; 「自动」按学习者画像动态推断</span>
          </div>
          <div class="form-row">
            <label>学习者画像</label>
            <div v-if="learnerProfile" class="profile-line">
              词库 {{ learnerProfile.wordCount }} 词 · 平均词频排名 {{ learnerProfile.avgFrq ?? '—' }} · 最近文章平均句长 {{ learnerProfile.avgSentLen ?? '—' }} 词
              → 自动档: {{ learnerProfile.bandLabel }}(词频前 {{ learnerProfile.cap }}, 句长 ≤{{ learnerProfile.maxSentLen }} 词)
            </div>
            <div v-else class="profile-line muted">暂无学习数据, 自动档回退「基础」</div>
            <button class="ca-btn small" @click="refreshLearnerProfile">重新评估</button>
          </div>
          <div class="form-row">
            <label>超时时间(ms)</label>
            <input v-model.number="s.ai.timeoutMs" class="ca-input" type="number" />
          </div>
          <div class="form-row">
            <label>重试次数</label>
            <input v-model.number="s.ai.retry" class="ca-input" type="number" min="0" max="5" />
          </div>

          <div class="ai-test-block">
            <div class="flex">
              <button class="ca-btn ca-btn--primary" @click="testAi" :disabled="aiTesting">
                {{ aiTesting ? '测试中…' : '测试连接' }}
              </button>
              <button class="ca-btn" @click="fetchModels" :disabled="aiModelsLoading">{{ aiModelsLoading ? '获取中…' : '获取模型' }}</button>
            </div>
            <div v-if="aiTestResult" class="ai-test-result" :class="aiTestResult.ok ? 'ok' : 'err'">
              <template v-if="aiTestResult.ok">✓ {{ aiTestResult.message || '连接成功' }}</template>
              <template v-else>✗ 连接失败: {{ aiTestResult.error }}</template>
            </div>
            <p v-if="aiTestResult?.ok && aiTestResult.models?.length" class="hint">
              可用模型({{ aiTestResult.models.length }}): {{ aiTestResult.models.slice(0, 8).join(', ') }}{{ aiTestResult.models.length > 8 ? ' …' : '' }}
            </p>
          </div>
        </div>

        <!-- 复习 -->
        <div v-else-if="activeSection === 'review'" class="settings-pane">
          <h3>复习参数</h3>
          <p class="pane-desc">艾宾浩斯遗忘曲线间隔表(天)</p>

          <div class="form-row">
            <label>生词阶段间隔</label>
            <input v-model="s.review.newbie" class="ca-input" placeholder="1, 2, 4, 7, 15, 30" />
          </div>
          <div class="form-row">
            <label>熟词阶段间隔</label>
            <input v-model="s.review.fluent" class="ca-input" placeholder="7, 15, 30, 60, 90" />
          </div>
          <div class="form-row">
            <label>连续认识升熟词</label>
            <input v-model.number="s.review.promoteAfterKnown" class="ca-input" type="number" min="1" max="10" />
            <span class="hint">次</span>
          </div>
          <div class="form-row">
            <label>每日复习上限</label>
            <input v-model.number="s.review.dailyLimit" class="ca-input" type="number" min="0" max="5000" />
            <span class="hint">0 = 不限; 超出部分明天继续</span>
          </div>
          <div class="form-row">
            <label>每日新词配额</label>
            <input v-model.number="s.review.dailyNewLimit" class="ca-input" type="number" min="0" max="1000" />
            <span class="hint">0 = 不限; 超配额的当天新词首复顺延一天</span>
          </div>
          <div class="form-row">
            <label>复习顺序</label>
            <select v-model="s.review.orderStrategy" class="ca-select">
              <option value="overdue">最逾期优先(默认)</option>
              <option value="newFirst">新词优先</option>
            </select>
          </div>

          <div class="ai-adjust-block">
            <div class="ai-adjust-title">AI 智能调整</div>
            <p class="hint">每约 15 天, 软件汇总你的学习数据, 由 AI 建议调整间隔表。建议需你确认后生效。</p>
            <div class="flex">
              <button class="ca-btn ca-btn--ai" @click="runAdjust" :disabled="adjustLoading">
                {{ adjustLoading ? 'AI 分析中…' : '运行 AI 调整' }}
              </button>
            </div>
            <div v-if="adjustResult" class="ai-adjust-result">
              <div v-if="adjustResult.ok">
                <div class="flex" style="flex-wrap:wrap;gap:16px">
                  <div>
                    <div class="hint">生词间隔</div>
                    <strong>{{ adjustResult.newbie.join(' / ') }} 天</strong>
                  </div>
                  <div>
                    <div class="hint">熟词间隔</div>
                    <strong>{{ adjustResult.fluent.join(' / ') }} 天</strong>
                  </div>
                </div>
                <p class="mt-2" style="color:var(--ca-ink-2);font-size:13px">{{ adjustResult.reason }}</p>
                <div class="flex mt-2">
                  <button class="ca-btn ca-btn--primary" @click="applyAdjust">应用此建议</button>
                </div>
              </div>
              <div v-else class="ai-adjust-error">{{ adjustResult.error }}</div>
            </div>
          </div>
        </div>

        <!-- 外观 -->
        <div v-else-if="activeSection === 'appearance'" class="settings-pane">
          <h3>外观</h3>
          <p class="pane-desc">主题与 ADHD 阅读模式参数</p>

          <div class="form-row">
            <label>主题</label>
            <select v-model="s.appearance.theme" class="ca-select">
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <div class="form-row">
            <label>荧光笔颜色</label>
            <input v-model="s.appearance.highlightColor" class="ca-input" type="color" style="width:60px;height:32px;padding:2px" />
            <span class="hint">{{ s.appearance.highlightColor }}</span>
          </div>
          <div class="form-row">
            <label>行距</label>
            <input v-model.number="s.appearance.lineHeight" class="ca-input" type="number" min="1.2" max="2.5" step="0.1" />
          </div>

          <div class="sub-section">
            <div class="sub-title">ADHD 阅读模式</div>
            <div class="form-row">
              <label>阅读增强</label>
              <div class="seg-group">
                <button
                  v-for="m in ['off', 'semantic', 'bionic']"
                  :key="m"
                  class="seg-btn"
                  :class="{ active: adhdModeKey === m }"
                  @click="setAdhdMode(m)"
                >{{ ADHD_MODE_LABEL[m] }}</button>
              </div>
              <span class="hint">{{ ADHD_MODE_DESC[adhdModeKey] }}; 阅读页右上角按钮可按 语义 → Bionic → 普通 循环切换</span>
            </div>
            <div v-if="adhdModeKey === 'semantic'" class="form-row">
              <label>关键词密度</label>
              <input v-model.number="s.appearance.adhd.semanticDensity" class="ca-input" type="number" min="0.1" max="0.5" step="0.05" />
              <span class="hint">0.25 = 25% 的词被增强; 数值越大视觉提示越强</span>
            </div>
            <template v-else-if="adhdModeKey === 'bionic'">
              <div class="form-row">
                <label>加粗比例</label>
                <input v-model.number="s.appearance.adhd.splitRatio" class="ca-input" type="number" min="0.1" max="0.6" step="0.05" />
                <span class="hint">每个词前部加粗的字母占比(0.35 为常用值)</span>
              </div>
              <div class="form-row">
                <label>词首放大</label>
                <input v-model.number="s.appearance.adhd.leadScale" class="ca-input" type="number" min="1" max="1.4" step="0.02" />
                <span class="hint">1.12 = 词首字号比正文大 12%</span>
              </div>
            </template>
            <div class="form-row">
              <label>字号</label>
              <input v-model.number="s.appearance.fontScale" class="ca-input" type="number" min="0.85" max="1.6" step="0.05" />
              <span class="hint">1 = 默认; 1.1~1.2 更适合长时间阅读</span>
            </div>
            <div class="form-row">
              <label>字距</label>
              <input v-model.number="s.appearance.adhd.letterSpacing" class="ca-input" type="number" min="0" max="0.2" step="0.01" />
              <span class="hint">0.04em = 轻微加宽, 有助区分单词边界</span>
            </div>
            <div class="form-row">
              <label>词距</label>
              <input v-model.number="s.appearance.adhd.wordSpacing" class="ca-input" type="number" min="0" max="0.3" step="0.01" />
            </div>
          </div>
        </div>

        <!-- 行为 -->
        <div v-else-if="activeSection === 'behavior'" class="settings-pane">
          <h3>行为</h3>
          <p class="pane-desc">计时与会话行为</p>
          <div class="form-row">
            <label>有效会话阈值(秒)</label>
            <input v-model.number="s.behavior.sessionMinSeconds" class="ca-input" type="number" min="10" />
          </div>
          <div class="form-row">
            <label>闲置暂停(秒)</label>
            <input v-model.number="s.behavior.idleTimeoutSeconds" class="ca-input" type="number" min="30" />
          </div>
          <div class="form-row">
            <label>每日提醒</label>
            <input type="checkbox" v-model="s.behavior.dailyReminder" class="ca-check" />
          </div>
        </div>

        <!-- 提问测试 -->
        <div v-else-if="activeSection === 'quiz'" class="settings-pane">
          <h3>提问测试</h3>
          <p class="pane-desc">工作区「提问测试」模板的出题参数(保存后对之后生成的题组生效, 已缓存的题组不变)</p>
          <div class="form-row">
            <label>每批题数</label>
            <div class="seg-group">
              <button v-for="n in [3, 4, 5]" :key="n" class="seg-btn" :class="{ active: s.quiz.questionsPerBatch === n }" @click="s.quiz.questionsPerBatch = n">{{ n }} 题</button>
            </div>
          </div>
          <div class="form-row">
            <label>难度</label>
            <div class="seg-group">
              <button class="seg-btn" :class="{ active: s.quiz.difficulty === 1 }" @click="s.quiz.difficulty = 1">基础</button>
              <button class="seg-btn" :class="{ active: s.quiz.difficulty === 2 }" @click="s.quiz.difficulty = 2">标准</button>
              <button class="seg-btn" :class="{ active: s.quiz.difficulty === 3 }" @click="s.quiz.difficulty = 3">挑战</button>
            </div>
            <span class="hint">基础: 明显错误干扰项 · 标准: 常见典型错误 · 挑战: 细微差异/易混淆辨析</span>
          </div>
          <div class="form-row">
            <label>判分方式</label>
            <div class="seg-group">
              <button class="seg-btn" :class="{ active: s.quiz.judgeMode === 'immediate' }" @click="s.quiz.judgeMode = 'immediate'">即时判分</button>
              <button class="seg-btn" :class="{ active: s.quiz.judgeMode === 'afterAll' }" @click="s.quiz.judgeMode = 'afterAll'">交卷后判分</button>
            </div>
            <span class="hint">即时: 点选项立即反馈并锁定 · 交卷后: 可改选, 点「交卷」统一判分</span>
          </div>
        </div>

        <!-- 数据 -->
        <div v-else-if="activeSection === 'data'" class="settings-pane">
          <h3>数据管理</h3>
          <p class="pane-desc">备份、导出与调试</p>
          <div class="data-actions">
            <button class="ca-btn" @click="backup">备份数据</button>
            <button class="ca-btn" @click="exportDebug">导出调试包</button>
          </div>
          <p class="hint mt-4">调试包包含最近日志、AI 调用记录、配置(API Key 已打码)和近期单词数据, 可发给 AI 协助排查问题。</p>

          <div class="sub-section">
            <div class="sub-title">句子解析缓存(AI 工作区)</div>
            <div v-if="sentenceCache" class="sentence-cache-row">
              <span class="sc-stat">{{ sentenceCache.sentenceCount ?? sentenceCache.count }} 条已解析句子</span>
              <span class="sc-stat">{{ sentenceCache.threadCount ?? 0 }} 个文章会话</span>
              <span class="sc-stat">占用约 {{ fmtCacheSize(sentenceCache.bytes) }}</span>
              <span v-if="sentenceCache.latest" class="sc-stat">最近使用: {{ sentenceCache.latest }}</span>
            </div>
            <div v-else class="hint">加载中…</div>
            <div class="data-actions mt-4">
              <button class="ca-btn ca-btn--danger-text" :disabled="!sentenceCache || sentenceCache.count === 0" @click="clearSentenceCache">清空句子缓存</button>
            </div>
            <p class="hint">缓存用于"选中句子秒显历史解析"; 文章会话保存整篇文章的提问历史(切换句子不丢, 重启后仍在), 均不会自动过期。清空后需重新解析; 语法本已收录例句不受影响。</p>
          </div>
        </div>

        <!-- 日志 -->
        <div v-else-if="activeSection === 'logs'" class="settings-pane">
          <div class="flex" style="justify-content:space-between;margin-bottom:12px">
            <h3 style="margin:0">系统日志</h3>
            <div class="flex">
              <button class="ca-btn" @click="loadLogs">刷新</button>
              <button class="ca-btn ca-btn--danger-text" @click="clearLogs">清空</button>
            </div>
          </div>
          <div class="log-list">
            <div v-if="!logs.length" class="ca-empty">暂无日志</div>
            <div v-for="l in logs" :key="l.id" class="log-row">
              <span class="log-time">{{ fmtTime(l.created_at) }}</span>
              <span class="ca-badge" :class="levelClass(l.level)">{{ l.level }}</span>
              <span class="log-module">{{ l.module }}</span>
              <span class="log-msg">{{ l.message }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ca-btn--ai { color: #fff; background: var(--ca-ai); border-color: transparent; }
.ca-btn--ai:hover { opacity: 0.9; }
.ca-btn--danger-text { color: var(--ca-critical); border-color: var(--ca-critical-soft); background: var(--ca-critical-soft); }

.save-hint { color: var(--ca-success); font-weight: 600; font-size: 13px; }

.settings-layout { display: grid; grid-template-columns: 200px 1fr; gap: 16px; align-items: start; }

.settings-nav { padding: 8px; }
.settings-nav-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; height: 38px; padding: 0 10px;
  border: none; border-radius: 8px;
  background: transparent; color: var(--ca-ink-2);
  font-size: 13px; font-weight: 500; cursor: pointer;
  text-align: left;
}
.settings-nav-item:hover { background: var(--ca-surface-subtle); }
.settings-nav-item.active { background: var(--ca-primary-soft); color: var(--ca-primary); font-weight: 600; }
.sn-icon { display: grid; place-items: center; }

.settings-content { padding: 24px; }
.settings-pane { max-width: 780px; }
.settings-pane h3 { margin: 0 0 4px; font-size: 17px; }
.pane-desc { color: var(--ca-ink-3); font-size: 13px; margin: 0 0 20px; }

.form-row {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px;
  margin-bottom: 14px;
}
/* 说明文字过长时换行到控件下方(标签右对齐缩进), 避免把输入框挤窄 */
.form-row > .hint { flex: 1 1 100%; margin: -6px 0 0 162px; }
.form-row label { width: 150px; flex: 0 0 150px; font-size: 13px; font-weight: 500; color: var(--ca-ink-2); }
.form-row .ca-input { flex: 1; }
.form-row .ca-select { flex: 1; }
.form-row .hint { font-size: 12px; color: var(--ca-ink-3); }
.ca-check { width: 18px; height: 18px; }

.seg-group { display: flex; gap: 4px; padding: 2px; border-radius: 8px; background: var(--ca-surface-subtle); border: 1px solid var(--ca-line); flex: 0 0 auto; }
.seg-btn { height: 26px; padding: 0 12px; border: none; border-radius: 6px; background: transparent; font-size: 12px; font-weight: 600; color: var(--ca-ink-3); cursor: pointer; white-space: nowrap; flex: 0 0 auto; line-height: 1; }
.seg-btn.active { background: var(--ca-surface); color: var(--ca-primary); box-shadow: var(--ca-shadow-card); }

.sub-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--ca-line); }
.sub-title { font-size: 14px; font-weight: 700; margin-bottom: 14px; }

.ai-adjust-block { margin-top: 24px; padding: 16px; border-radius: 12px; background: var(--ca-ai-soft); border: 1px solid #e5e0ff; }
.ai-adjust-title { font-size: 14px; font-weight: 700; color: var(--ca-ai-ink); margin-bottom: 4px; }
.ai-adjust-result { margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--ca-surface); }
.ai-adjust-error { color: var(--ca-critical); font-size: 13px; }

.ai-model-row { flex: 1; gap: 8px; align-items: center; }
.ai-model-row .ca-input { flex: 1; min-width: 0; }
.ai-test-block { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--ca-line); }
.ai-test-result { margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; }
.ai-test-result.ok { background: var(--ca-success-soft); color: var(--ca-success-ink); }
.ai-test-result.err { background: var(--ca-critical-soft); color: var(--ca-critical-ink); }

.hint { color: var(--ca-ink-3); font-size: 12px; }
.profile-line { font-size: 12px; color: var(--ca-ink-2); line-height: 1.7; word-break: break-word; }
.profile-line.muted { color: var(--ca-ink-3); }
/* 画像文案较长时不要把「重新评估」按钮压成两行(实测窄列会折成「重新评/估」) */
.profile-line + .ca-btn { white-space: nowrap; flex: 0 0 auto; }
.sentence-cache-row { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 8px; }
.sc-stat { font-size: 12.5px; color: var(--ca-ink-2); }
.sc-stat:first-child { font-weight: 600; }

.data-actions { display: flex; gap: 12px; }

.log-list { display: flex; flex-direction: column; }
.log-row {
  display: flex; align-items: center; gap: 10px;
  padding: 7px 0; border-bottom: 1px solid var(--ca-line);
  font-size: 12px;
}
.log-time { color: var(--ca-ink-3); font-variant-numeric: tabular-nums; flex: 0 0 130px; }
.log-module { color: var(--ca-primary); flex: 0 0 80px; font-weight: 600; }
.log-msg { flex: 1; color: var(--ca-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
