<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const data = ref(null)
const monthly = ref([])
const calData = ref([])
const retention = ref([])
const loading = ref(true)
const loadError = ref('')
const calMonth = ref(0) // 0 = 当月, -1 = 上个月...
const trendYear = ref(new Date().getFullYear()) // 年度趋势的年份
const calView = ref('month') // month | year
const calYear = ref(new Date().getFullYear())
const yearData = ref([])

async function load() {
  if (!window.api) return
  loading.value = true
  loadError.value = ''
  try {
    data.value = await window.api.stats.dashboard(30)
    monthly.value = await window.api.stats.monthly(trendYear.value)
    calData.value = await window.api.stats.calendar(calMonth.value)
    yearData.value = await window.api.stats.calendarYear(calYear.value)
    retention.value = await window.api.stats.retention(90)
  } catch (e) {
    console.error('控制台数据加载失败', e)
    loadError.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
}

async function changeCalMonth() {
  try {
    calData.value = await window.api.stats.calendar(calMonth.value)
  } catch (e) {
    console.error('日历数据加载失败', e)
  }
}

async function changeCalYear() {
  try {
    yearData.value = await window.api.stats.calendarYear(calYear.value)
  } catch (e) {
    console.error('年度日历加载失败', e)
  }
}

function switchCalView(v) {
  calView.value = v
}

async function changeTrendYear() {
  try {
    monthly.value = await window.api.stats.monthly(trendYear.value)
  } catch (e) {
    console.error('年度趋势加载失败', e)
  }
}

onMounted(load)

const dueToday = computed(() => data.value?.today?.due ?? 0)
const secondsToday = computed(() => fmtDuration(data.value?.today?.seconds ?? 0))
const totalWords = computed(() => data.value?.totals?.totalWords ?? 0)
const totalSeconds = computed(() => fmtDuration(data.value?.totals?.totalSeconds ?? 0))

function fmtDuration(sec) {
  if (!sec) return '0 分'
  if (sec < 60) return `${sec} 秒`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  return `${h} 小时 ${min % 60} 分`
}

// ============ 真实月历 ============
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六']

// 当月每天的学习数据 map: 'YYYY-MM-DD' -> 完整数据
const calDataMap = computed(() => {
  const m = new Map()
  for (const d of calData.value ?? []) {
    m.set(d.date, d)
  }
  return m
})

// 生成一个月的日历格子(含前导空位)
const calMonthTitle = computed(() => {
  const d = new Date()
  d.setMonth(d.getMonth() + calMonth.value)
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`
})

const calCells = computed(() => {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() + calMonth.value, 1)
  const year = d.getFullYear()
  const month = d.getMonth()
  const firstWeekday = d.getDay() // 0=周日
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells = []
  // 前导空位
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ empty: true, key: `pad-${i}` })
  }
  // 日期格
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const info = calDataMap.value.get(dateKey)
    cells.push({
      day,
      dateKey,
      empty: false,
      isToday: year === now.getFullYear() && month === now.getMonth() && day === now.getDate(),
      sessions: info?.sessions || 0,
      words: info?.words || 0,
      reviews: info?.reviews || 0,
      seconds: info?.seconds || 0,
      level: info?.level || 0
    })
  }
  return cells
})

// 综合活跃度: 使用后端计算的 level(饱和值 0~1), 非简单计数
function calColor(c) {
  const lv = c.level
  if (!lv) return 'var(--ca-surface-subtle)'
  if (lv < 0.2) return '#e8eefe'
  if (lv < 0.4) return '#c3d2fa'
  if (lv < 0.6) return '#9db8f5'
  if (lv < 0.8) return '#6a87e6'
  return 'var(--ca-primary)'
}

function calLevelClass(c) {
  const lv = c.level
  if (!lv) return ''
  if (lv < 0.2) return 'c1'
  if (lv < 0.4) return 'c2'
  if (lv < 0.6) return 'c3'
  if (lv < 0.8) return 'c4'
  return 'c5'
}

// ============ GitHub 风格年视图 ============
const yearDataMap = computed(() => {
  const m = new Map()
  for (const d of yearData.value ?? []) m.set(d.date, d)
  return m
})

const yearCells = computed(() => {
  const cells = []
  const firstWeekday = new Date(calYear.value, 0, 1).getDay()
  for (let i = 0; i < firstWeekday; i++) cells.push({ empty: true, key: `yp-${i}` })
  const now = new Date()
  const d = new Date(calYear.value, 0, 1)
  while (d.getFullYear() === calYear.value) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const info = yearDataMap.value.get(key)
    cells.push({
      empty: false,
      dateKey: key,
      isToday: d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate(),
      sessions: info?.sessions || 0,
      words: info?.words || 0,
      reviews: info?.reviews || 0,
      seconds: info?.seconds || 0,
      level: info?.level || 0
    })
    d.setDate(d.getDate() + 1)
  }
  return cells
})

// 每月 1 日所在的周列(月标签定位)
const yearMonthLabels = computed(() => {
  const labels = []
  const firstWeekday = new Date(calYear.value, 0, 1).getDay()
  for (let m = 0; m < 12; m++) {
    const dayOfYear = Math.floor((Date.UTC(calYear.value, m, 1) - Date.UTC(calYear.value, 0, 1)) / 86400000)
    labels.push({ label: `${m + 1}月`, col: Math.floor((dayOfYear + firstWeekday) / 7) })
  }
  return labels
})

function fmtMinutes(sec) {
  if (!sec) return '0 分钟'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分`
}

// ============ 日历悬浮提示(单实例 + 视口钳制, 无堆叠) ============
const hoverCell = ref(null)
const tipPos = ref({ x: 0, y: 0 })
function showCalTip(c, el) {
  hoverCell.value = c
  const TIP_W = 176
  const TIP_H = 150
  const r = el.getBoundingClientRect()
  let x = Math.round(r.left + r.width / 2 - TIP_W / 2)
  x = Math.max(8, Math.min(x, window.innerWidth - TIP_W - 8))
  let y = Math.round(r.top - TIP_H - 8)
  if (y < 8) y = Math.round(r.bottom + 8) // 顶部行放不下 → 下方
  y = Math.max(8, Math.min(y, window.innerHeight - TIP_H - 8))
  tipPos.value = { x, y }
}
function hideCalTip() {
  hoverCell.value = null
}

// ============ 记忆保持率 ============
function retentionClass(r) {
  if (r == null) return 'none'
  if (r >= 80) return 'good'
  if (r >= 60) return 'mid'
  return 'bad'
}

// ============ 年度趋势(按月) ============
const monthlyMaxSec = computed(() => Math.max(1, ...monthly.value.map((m) => m.seconds)))
const monthlyMaxMarked = computed(() => Math.max(1, ...monthly.value.map((m) => m.marked)))

// ============ 遗忘风险折线 ============
// 坐标系与 viewBox 一致(100 × 32), 且 plot 用 aspect-ratio 匹配, 保证缩放均匀不变形
const forecast = computed(() => data.value?.forecast ?? [])
const forecastMax = computed(() => Math.max(1, ...forecast.value.map((f) => f.count)))
const fcHover = ref(null)
const FC = { W: 100, H: 32, PAD_X: 5, PAD_TOP: 5, PAD_BOT: 5 }

function fcPoint(i) {
  const f = forecast.value
  const n = Math.max(1, f.length - 1)
  const x = FC.PAD_X + (i / n) * (FC.W - FC.PAD_X * 2)
  const y = FC.H - FC.PAD_BOT - (f[i].count / forecastMax.value) * (FC.H - FC.PAD_TOP - FC.PAD_BOT)
  return { x, y }
}

const forecastPoints = computed(() =>
  forecast.value.map((_, i) => { const p = fcPoint(i); return `${p.x.toFixed(2)},${p.y.toFixed(2)}` }).join(' ')
)
const forecastArea = computed(() => {
  const f = forecast.value
  if (!f.length) return ''
  const last = fcPoint(f.length - 1)
  const first = fcPoint(0)
  return `${forecastPoints.value} ${last.x.toFixed(2)},${FC.H - FC.PAD_BOT} ${first.x.toFixed(2)},${FC.H - FC.PAD_BOT}`
})
const forecastDots = computed(() =>
  forecast.value.map((d, i) => {
    const p = fcPoint(i)
    return { ...p, count: d.count, date: d.date }
  })
)
const forecastLabels = computed(() =>
  forecast.value.map((d, i) => (i % 2 === 0 ? d.date.slice(5) : ''))
)
const forecastGridLines = computed(() =>
  forecast.value.map((_, i) => (i % 2 === 0 ? fcPoint(i).x : null))
)

// ============ 饼图 ============
const pie = computed(() => {
  const m = data.value?.memory
  if (!m) return []
  // 柔和协调的配色(主蓝/青/绿的语义对应)
  return [
    { name: '生词', value: m.new, color: 'var(--ca-chart-blue-2)' },
    { name: '学习中', value: m.learning, color: 'var(--ca-chart-3)' },
    { name: '熟词', value: m.fluent, color: 'var(--ca-success)' }
  ]
})
const pieTotal = computed(() => pie.value.reduce((a, p) => a + p.value, 0))
const pieCumulative = computed(() => {
  let acc = 0
  return pie.value.map((p) => {
    const start = acc
    acc += p.value
    return { ...p, start, end: acc }
  })
})

function pieArc(p) {
  const total = Math.max(1, pieTotal.value)
  const start = (p.start / total) * 2 * Math.PI - Math.PI / 2
  const end = (p.end / total) * 2 * Math.PI - Math.PI / 2
  const r = 54
  const x1 = 60 + r * Math.cos(start)
  const y1 = 60 + r * Math.sin(start)
  const x2 = 60 + r * Math.cos(end)
  const y2 = 60 + r * Math.sin(end)
  const large = end - start > Math.PI ? 1 : 0
  return `M 60 60 L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}
</script>

<template>
  <div class="ca-page">
    <div class="ca-page-header">
      <div>
        <h1 class="ca-page-title">控制台</h1>
        <p class="ca-page-desc">今日概览、学习节奏与记忆状态</p>
      </div>
      <div class="flex">
        <button class="ca-btn ca-btn--primary" @click="router.push('/reading')">开始学习</button>
      </div>
    </div>

    <div v-if="loading" class="ca-empty">加载中…</div>
    <div v-else-if="loadError" class="ca-empty">{{ loadError }}</div>

    <template v-else-if="data">
      <!-- 今日待复习 -->
      <div class="due-banner" v-if="dueToday > 0" @click="router.push({ path: '/reading', query: { review: '1' } })">
        <div class="due-banner-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </div>
        <div class="due-banner-text">
          <div class="due-banner-title">今天有 <strong>{{ dueToday }}</strong> 个词待复习</div>
          <div class="due-banner-sub">
            <template v-if="(data?.today?.maxOverdueDays || 0) >= 7">
              有词已逾期 {{ data.today.maxOverdueDays }} 天 · 别慌, 从最旧的开始就好
            </template>
            <template v-else>按艾宾浩斯曲线安排 · 点击开始复习</template>
          </div>
        </div>
        <button class="ca-btn ca-btn--primary due-banner-btn">开始复习</button>
      </div>

      <!-- 新用户引导 -->
      <div v-if="totalWords === 0" class="guide-card ca-card ca-card-pad">
        <div class="chart-title">三步开始</div>
        <div class="guide-steps">
          <div class="guide-step"><b>1</b><span>打开「阅读 / 复习」页, 输入或粘贴一篇英文短文, 点「开始阅读」</span></div>
          <div class="guide-step"><b>2</b><span>阅读中划选不认识的词 → 点荧光笔「标记为生词」(划选会弹出词典释义)</span></div>
          <div class="guide-step"><b>3</b><span>明天起按到期提醒回来复习 · 连续 3 次「认识」自动升熟词, 间隔越来越长</span></div>
        </div>
      </div>

      <!-- KPI -->
      <div class="kpi-grid">
        <div class="kpi-card ca-card">
          <span class="kpi-icon-box" style="background:var(--ca-warning-soft);color:var(--ca-warning-ink)">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </span>
          <div class="kpi-body">
            <div class="kpi-value">{{ dueToday }}</div>
            <div class="kpi-label">今日待复习</div>
            <div class="kpi-sub">生词 + 熟词</div>
          </div>
        </div>
        <div class="kpi-card ca-card">
          <span class="kpi-icon-box" style="background:var(--ca-info-soft);color:var(--ca-info-ink)">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </span>
          <div class="kpi-body">
            <div class="kpi-value">{{ secondsToday }}</div>
            <div class="kpi-label">今日学习时长</div>
            <div class="kpi-sub">阅读 + 复习</div>
          </div>
        </div>
        <div class="kpi-card ca-card">
          <span class="kpi-icon-box" style="background:var(--ca-primary-soft);color:var(--ca-primary)">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
          </span>
          <div class="kpi-body">
            <div class="kpi-value">{{ totalWords }}</div>
            <div class="kpi-label">累计单词</div>
            <div class="kpi-sub">生词 + 熟词</div>
          </div>
        </div>
        <div class="kpi-card ca-card">
          <span class="kpi-icon-box" style="background:var(--ca-success-soft);color:var(--ca-success-ink)">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="20 6 9 17 4 12"/></svg>
          </span>
          <div class="kpi-body">
            <div class="kpi-value">{{ totalSeconds }}</div>
            <div class="kpi-label">累计学习时长</div>
            <div class="kpi-sub">全部会话</div>
          </div>
        </div>
      </div>

      <!-- 主内容: 日历 + 单词构成 并排 -->
      <div class="cal-row">
        <div class="ca-card ca-card-pad cal-col">
          <div class="chart-head">
            <div>
              <div class="chart-title">学习活跃日历</div>
              <div class="chart-desc">综合阅读时长 · 生词标记 · 复习次数, 颜色越深活跃度越高</div>
            </div>
            <div class="cal-view-switch">
              <button class="cal-view-btn" :class="{ active: calView === 'month' }" @click="switchCalView('month')">月视图</button>
              <button class="cal-view-btn" :class="{ active: calView === 'year' }" @click="switchCalView('year')">年视图</button>
            </div>
          </div>

          <!-- 月/年导航 -->
          <div v-if="calView === 'month'" class="cal-nav flex">
            <button class="cal-nav-btn" @click="calMonth--; changeCalMonth()">‹</button>
            <span class="cal-month-title">{{ calMonthTitle }}</span>
            <button class="cal-nav-btn" @click="calMonth++; changeCalMonth()">›</button>
          </div>
          <div v-else class="cal-nav flex">
            <button class="cal-nav-btn" @click="calYear--; changeCalYear()">‹</button>
            <span class="cal-month-title">{{ calYear }} 年</span>
            <button class="cal-nav-btn" @click="calYear++; changeCalYear()">›</button>
          </div>

          <!-- 月视图 -->
          <div v-if="calView === 'month'" class="calendar">
            <div class="cal-weekday-row">
              <div v-for="w in WEEKDAY_CN" :key="w" class="cal-weekday">{{ w }}</div>
            </div>
            <div class="cal-grid">
              <div
                v-for="c in calCells"
                :key="c.empty ? c.key : c.dateKey"
                class="cal-day"
                :class="[c.empty ? 'empty' : '', calLevelClass(c), { today: c.isToday }]"
                :style="!c.empty ? { background: calColor(c) } : {}"
                @mouseenter="!c.empty && showCalTip(c, $event.currentTarget)"
                @mouseleave="hideCalTip"
              >
                <span v-if="!c.empty" class="cal-day-num">{{ c.day }}</span>
              </div>
            </div>
          </div>

          <!-- 年视图(GitHub 风格: 7 行 × 周列) -->
          <div v-else class="calendar cal-year-view">
            <div class="cal-year-months">
              <span v-for="l in yearMonthLabels" :key="l.label" class="cal-year-month" :style="{ gridColumn: (l.col + 1) }">{{ l.label }}</span>
            </div>
            <div class="cal-year-grid">
              <div
                v-for="c in yearCells"
                :key="c.empty ? c.key : c.dateKey"
                class="cal-day cal-day--year"
                :class="[c.empty ? 'empty' : '', calLevelClass(c), { today: c.isToday }]"
                :style="!c.empty ? { background: calColor(c) } : {}"
                @mouseenter="!c.empty && showCalTip(c, $event.currentTarget)"
                @mouseleave="hideCalTip"
              ></div>
            </div>
          </div>

          <!-- 悬浮提示: 单实例, fixed 定位, 视口钳制(无位移动效, 不会堆叠) -->
          <div v-if="hoverCell" class="cal-tip" :style="{ left: tipPos.x + 'px', top: tipPos.y + 'px' }">
            <div class="ct-date">{{ hoverCell.dateKey }}</div>
            <div class="ct-row"><span>阅读</span><b>{{ fmtMinutes(hoverCell.seconds) }}</b></div>
            <div class="ct-row"><span>标记生词</span><b>{{ hoverCell.words }} 个</b></div>
            <div class="ct-row"><span>复习</span><b>{{ hoverCell.reviews }} 次</b></div>
            <div class="ct-row"><span>会话</span><b>{{ hoverCell.sessions }} 次</b></div>
          </div>

          <div class="cal-legend flex">
              <span class="muted">少</span>
              <div class="cal-swatch" style="background:#e8eefe"></div>
              <div class="cal-swatch" style="background:#c3d2fa"></div>
              <div class="cal-swatch" style="background:#9db8f5"></div>
              <div class="cal-swatch" style="background:#6a87e6"></div>
              <div class="cal-swatch" style="background:var(--ca-primary)"></div>
              <span class="muted">多</span>
            </div>
        </div>

        <!-- 单词构成饼图 -->
        <div class="ca-card ca-card-pad cal-col">
          <div class="chart-head">
            <div>
              <div class="chart-title">单词构成</div>
              <div class="chart-desc">累计 {{ pieTotal }} 个单词</div>
            </div>
          </div>
          <div class="pie-wrap" v-if="pieTotal > 0">
            <svg width="140" height="140" viewBox="0 0 120 120">
              <path v-for="(p, i) in pieCumulative" :key="i" :d="pieArc(p)" :fill="p.color"></path>
            </svg>
            <div class="pie-center">
              <div class="pie-total">{{ pieTotal }}</div>
              <div class="pie-total-label">全部单词</div>
            </div>
          </div>
          <!-- 空词库时白字落在白底上看不见, 显示空状态 -->
          <div v-else class="pie-empty">暂无单词</div>
          <div class="pie-legend">
            <div v-for="p in pie" :key="p.name" class="pie-legend-item">
              <span class="pie-dot" :style="{ background: p.color }"></span>
              <span>{{ p.name }}</span>
              <span class="pie-num">{{ p.value }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 年度趋势 + 遗忘风险 -->
      <div class="grid-2-charts">
          <!-- 年度趋势(按月) -->
          <div class="ca-card ca-card-pad">
            <div class="chart-head">
              <div>
                <div class="chart-title">年度学习趋势</div>
                <div class="chart-desc">{{ trendYear }} 年 · 学习时长(分钟)与标记词数</div>
              </div>
              <div class="cal-nav flex">
                <button class="cal-nav-btn" @click="trendYear--; changeTrendYear()">‹</button>
                <span class="cal-month-title">{{ trendYear }} 年</span>
                <button class="cal-nav-btn" @click="trendYear++; changeTrendYear()">›</button>
              </div>
            </div>
            <div class="monthly-plot">
              <div class="monthly-bars">
                <div v-for="m in monthly" :key="m.month" class="monthly-col">
                  <div class="monthly-bar-wrap">
                    <div class="monthly-bar sec" :style="{ height: (m.marked / monthlyMaxMarked) * 100 + '%' }"></div>
                    <div class="monthly-bar" :style="{ height: (m.seconds / monthlyMaxSec) * 100 + '%' }"></div>
                    <!-- 设计一致的 tooltip -->
                    <div class="mtip">
                      <div class="mtip-title">{{ m.label }}</div>
                      <div class="mtip-row"><span>学习时长</span><b>{{ fmtMinutes(m.seconds) }}</b></div>
                      <div class="mtip-row"><span>标记生词</span><b>{{ m.marked }} 个</b></div>
                    </div>
                  </div>
                  <div class="monthly-label">{{ m.month.slice(0, 4) }}.{{ m.month.slice(5) }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 遗忘风险折线 -->
          <div class="ca-card ca-card-pad">
            <div class="chart-head">
              <div>
                <div class="chart-title">遗忘风险曲线</div>
                <div class="chart-desc">未来 14 天到期量 · 复习负荷预测</div>
              </div>
            </div>
            <div class="forecast-plot">
              <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="forecast-svg">
                <!-- 网格线 -->
                <line v-for="x in forecastGridLines" :key="'g' + x" :x1="x" :x2="x" :y1="5" :y2="27" stroke="var(--ca-chart-grid)" stroke-width="0.4"></line>
                <!-- 渐变面积 -->
                <defs>
                  <linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="var(--ca-warning)" stop-opacity="0.25"></stop>
                    <stop offset="100%" stop-color="var(--ca-warning)" stop-opacity="0.02"></stop>
                  </linearGradient>
                </defs>
                <polygon :points="forecastArea" fill="url(#fcGrad)"></polygon>
                <!-- 折线 -->
                <polyline :points="forecastPoints" fill="none" stroke="var(--ca-warning)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"></polyline>
                <!-- 数据点 (悬停显示自定义 tooltip) -->
                <g v-for="(d, i) in forecastDots" :key="'d' + i">
                  <circle :cx="d.x" :cy="d.y" r="3.5" fill="transparent" class="fc-hit" @mouseenter="fcHover = d" @mouseleave="fcHover = null"></circle>
                  <circle :cx="d.x" :cy="d.y" r="1.6" fill="var(--ca-surface)" stroke="var(--ca-warning)" stroke-width="1"></circle>
                </g>
              </svg>
              <!-- 设计一致的浮层 -->
              <div
                v-if="fcHover"
                class="fc-tip"
                :style="{ left: (fcHover.x / 100 * 100) + '%', top: (fcHover.y / 32 * 100) + '%' }"
              >
                <div class="ct-date">{{ fcHover.date }}</div>
                <div class="ct-row"><span>到期词数</span><b>{{ fcHover.count }} 个</b></div>
              </div>
            </div>
            <div class="forecast-labels">
              <span v-for="(d, i) in forecast" :key="d.date" :class="{ shown: i % 2 === 0 }">{{ d.date.slice(5) }}</span>
            </div>
          </div>
      </div>

      <!-- 记忆保持率 -->
      <div class="ca-card ca-card-pad retention-card">
        <div class="chart-head">
          <div>
            <div class="chart-title">记忆保持率(近 90 天)</div>
            <div class="chart-desc">按"距上次复习的间隔"分桶的正确率 · 模糊计半个正确 · 间隔越长保持率越高说明记得越牢</div>
          </div>
        </div>
        <div v-if="retention.some((b) => b.total > 0)" class="retention-bars">
          <div v-for="b in retention" :key="b.label" class="retention-col">
            <div class="retention-bar-wrap">
              <div class="retention-bar" :class="retentionClass(b.retention)" :style="{ height: (b.retention || 0) + '%' }"></div>
              <div class="rtip">
                <div class="mtip-title">{{ b.label }}</div>
                <div class="mtip-row"><span>保持率</span><b>{{ b.retention == null ? '—' : b.retention + '%' }}</b></div>
                <div class="mtip-row"><span>样本</span><b>{{ b.total }} 次</b></div>
                <div class="mtip-row"><span>认识/模糊/不认识</span><b>{{ b.known }}/{{ b.fuzzy }}/{{ b.unknown }}</b></div>
              </div>
            </div>
            <div class="retention-label">{{ b.label }}</div>
            <div class="retention-value" :class="retentionClass(b.retention)">{{ b.retention == null ? '—' : b.retention + '%' }}</div>
          </div>
        </div>
        <div v-else class="ca-empty" style="padding:24px">暂无复习数据 · 复习一段时间后这里会显示各间隔档位的记忆保持率</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.due-banner { display: flex; align-items: center; gap: 14px; padding: 14px 16px; margin-bottom: 20px; border-radius: var(--ca-radius-card); background: linear-gradient(105deg, #fff7e5 0%, #fff 100%); border: 1px solid #fdecc8; cursor: pointer; transition: box-shadow var(--ca-duration-base) var(--ca-ease); }
.due-banner:hover { box-shadow: var(--ca-shadow-float); }
.due-banner-icon { width: 40px; height: 40px; flex: 0 0 40px; display: grid; place-items: center; border-radius: 9px; background: var(--ca-warning-soft); color: var(--ca-warning-ink); }
.due-banner-text { flex: 1; }
.due-banner-title { font-size: 15px; font-weight: 600; }
.due-banner-title strong { color: var(--ca-warning-ink); }
.due-banner-sub { font-size: 12px; color: var(--ca-ink-3); margin-top: 2px; }

.guide-card { margin-bottom: 20px; }
.guide-steps { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.guide-step { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: var(--ca-ink-2); line-height: 1.6; }
.guide-step b { flex: 0 0 22px; height: 22px; border-radius: 50%; background: var(--ca-primary); color: #fff; display: grid; place-items: center; font-size: 12px; }

.cal-row { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; align-items: start; margin-bottom: 16px; }
.grid-2-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: stretch; margin-bottom: 16px; }
.grid-2-charts > .ca-card { display: flex; flex-direction: column; }

.chart-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 12px; }
.chart-title { font-size: 14px; font-weight: 700; }
.chart-desc { font-size: 12px; color: var(--ca-ink-3); margin-top: 2px; }

/* 真实月历 */
.cal-nav { gap: 6px; }
.cal-nav-btn { width: 26px; height: 26px; border: 1px solid var(--ca-line); border-radius: 6px; background: var(--ca-surface); color: var(--ca-ink-2); cursor: pointer; font-size: 14px; }
.cal-nav-btn:hover { background: var(--ca-surface-subtle); }
.cal-month-title { font-size: 13px; font-weight: 600; min-width: 100px; text-align: center; }

.cal-view-switch { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: var(--ca-surface-subtle); border: 1px solid var(--ca-line); }
.cal-view-btn { height: 24px; padding: 0 12px; border: none; border-radius: 6px; background: transparent; font-size: 12px; font-weight: 600; color: var(--ca-ink-3); cursor: pointer; }
.cal-view-btn.active { background: var(--ca-surface); color: var(--ca-primary); box-shadow: var(--ca-shadow-card); }

/* 年视图(GitHub 风格): 原位留在左列, 不跨行; 54 周列(覆盖 372 格闰年边界)按 1fr 流式等分卡片宽度 → 右侧零空白, 窄窗口也不出滚动条; 格子 1:1 保持正方形 */
.cal-year-view { overflow-x: auto; }
.cal-year-months {
  display: grid;
  grid-template-columns: repeat(54, minmax(0, 1fr));
  gap: 2px;
  height: 18px;
  margin-bottom: 4px;
  align-items: start;
}
.cal-year-month { font-size: 11px; color: var(--ca-ink-3); font-weight: 600; white-space: nowrap; }
.cal-year-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-columns: repeat(54, minmax(0, 1fr));
  grid-template-rows: repeat(7, min-content);
  gap: 2px;
}
/* 特异性高于后面的 .cal-day(否则 aspect-ratio:2.4 会压扁); 无显式宽高: 宽取 1fr 轨道, 高按 1:1 等比 */
.cal-day.cal-day--year { aspect-ratio: 1 / 1; padding: 0; border-radius: 3px; }

.calendar { user-select: none; }
.cal-weekday-row { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 4px; }
.cal-weekday { text-align: center; font-size: 11px; color: var(--ca-ink-3); font-weight: 600; padding: 2px 0; }

.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-day {
  aspect-ratio: 2.4;
  border-radius: 4px;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 1px;
  border: 1px solid transparent;
  transition: border-color var(--ca-duration-fast) var(--ca-ease);
  position: relative;
}
.cal-day.empty { background: transparent !important; }
/* 去掉悬浮缩放动效: 相邻块过近时缩放会造成视觉堆叠, 改为边框高亮 */
.cal-day:hover { border-color: var(--ca-primary); }
.cal-day.today { border-color: var(--ca-primary); box-shadow: 0 0 0 1px var(--ca-primary); }
.cal-day-num { font-size: 10px; font-weight: 600; color: var(--ca-ink-2); }
/* 深色活跃块上的日期数字改白色, 保证可读 */
.cal-day.c4 .cal-day-num, .cal-day.c5 .cal-day-num { color: rgba(255, 255, 255, 0.95); }

/* 悬浮提示: 单实例 fixed 定位 + 视口钳制(上方放不下自动翻到下方), 无位移动效 */
.cal-tip {
  position: fixed;
  z-index: 3000;
  width: 176px;
  padding: 10px 12px;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  box-shadow: var(--ca-shadow-float);
  pointer-events: none;
  text-align: left;
}
.ct-date { font-size: 11px; font-weight: 700; color: var(--ca-ink-2); margin-bottom: 5px; }
.ct-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--ca-ink-3); padding: 2px 0; }
.ct-row b { font-weight: 600; color: var(--ca-ink); font-variant-numeric: tabular-nums; }

.cal-legend { gap: 4px; font-size: 11px; margin-top: 10px; color: var(--ca-ink-3); }
.cal-swatch { width: 13px; height: 13px; border-radius: 3px; }

/* 年度趋势 */
.monthly-plot { position: relative; display: flex; flex-direction: column; height: 200px; }
.monthly-bars { display: flex; align-items: flex-end; gap: 4px; flex: 1; min-height: 0; }
.monthly-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; height: 100%; }
.monthly-bar-wrap { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 2px; position: relative; }
.monthly-bar { width: 38%; min-height: 2px; border-radius: 3px 3px 0 0; background: var(--ca-primary); transition: height 0.4s var(--ca-ease); }
.monthly-bar.sec { background: var(--ca-chart-3); }
.monthly-label { font-size: 9px; color: var(--ca-ink-3); margin-top: 4px; white-space: nowrap; }

/* 月度 tooltip */
.mtip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  z-index: 3000;
  min-width: 150px;
  padding: 10px 12px;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  box-shadow: var(--ca-shadow-float);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--ca-duration-fast) var(--ca-ease), transform var(--ca-duration-fast) var(--ca-ease);
  pointer-events: none;
  text-align: left;
}
.monthly-bar-wrap:hover .mtip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}
.mtip-title { font-size: 11px; font-weight: 700; color: var(--ca-ink-2); margin-bottom: 4px; }
.mtip-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--ca-ink-3); padding: 1px 0; }
.mtip-row b { font-weight: 600; color: var(--ca-ink); font-variant-numeric: tabular-nums; }

/* 饼图 */
.pie-wrap { position: relative; display: flex; justify-content: center; margin: 4px 0; }
.pie-wrap svg { filter: drop-shadow(0 2px 6px rgb(16 24 40 / 8%)); }
.pie-empty { display: flex; align-items: center; justify-content: center; min-height: 150px; color: var(--ca-ink-3); font-size: 13px; }
.pie-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.pie-total { font-size: 26px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; text-shadow: 0 1px 2px rgb(0 0 0 / 25%); }
.pie-total-label { font-size: 11px; color: rgb(255 255 255 / 80%); font-weight: 500; margin-top: 2px; }
.pie-legend { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.pie-legend-item { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--ca-ink-2); }
.pie-dot { width: 10px; height: 10px; border-radius: 3px; flex: 0 0 10px; }
.pie-legend-item span:first-of-type { flex: 1; }
.pie-num { margin-left: auto; font-weight: 700; color: var(--ca-ink); font-variant-numeric: tabular-nums; font-size: 14px; }

/* 遗忘风险折线: 与年度趋势等高 */
.forecast-plot { width: 100%; position: relative; display: flex; flex-direction: column; height: 200px; }
.forecast-svg { width: 100%; flex: 1; min-height: 0; display: block; }
.fc-hit { cursor: pointer; }
.forecast-labels { flex: 0 0 auto; display: flex; justify-content: space-between; margin-top: 4px; font-size: 9px; color: var(--ca-ink-3); }
.forecast-labels span { opacity: 0; }
.forecast-labels span.shown { opacity: 1; }

/* 遗忘曲线 tooltip(设计风格一致) */
.fc-tip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 10px));
  z-index: 3000;
  min-width: 130px;
  padding: 10px 12px;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  box-shadow: var(--ca-shadow-float);
  text-align: left;
  pointer-events: none;
}
.fc-tip .ct-date { font-size: 11px; font-weight: 700; color: var(--ca-ink-2); margin-bottom: 4px; }
.fc-tip .ct-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--ca-ink-3); }
.fc-tip .ct-row b { font-weight: 600; color: var(--ca-warning-ink); font-variant-numeric: tabular-nums; }

/* 记忆保持率 */
.retention-card { margin-bottom: 16px; }
.retention-bars { display: flex; gap: 10px; align-items: stretch; }
.retention-col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; }
.retention-bar-wrap { width: 100%; height: 130px; display: flex; align-items: flex-end; justify-content: center; position: relative; border-bottom: 1px solid var(--ca-line); }
.retention-bar { width: 60%; min-height: 2px; border-radius: 4px 4px 0 0; transition: height 0.4s var(--ca-ease); }
.retention-bar.good { background: var(--ca-success); }
.retention-bar.mid { background: var(--ca-warning); }
.retention-bar.bad { background: var(--ca-critical); }
.retention-bar.none { background: var(--ca-line); }
.retention-label { font-size: 11px; color: var(--ca-ink-3); margin-top: 6px; white-space: nowrap; }
.retention-value { font-size: 13px; font-weight: 700; margin-top: 2px; font-variant-numeric: tabular-nums; }
.retention-value.good { color: var(--ca-success-ink); }
.retention-value.mid { color: var(--ca-warning-ink); }
.retention-value.bad { color: var(--ca-critical-ink); }
.retention-value.none { color: var(--ca-ink-3); }
.retention-bar-wrap .rtip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  z-index: 3000;
  min-width: 150px;
  padding: 10px 12px;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  box-shadow: var(--ca-shadow-float);
  opacity: 0;
  visibility: hidden;
  transition: opacity var(--ca-duration-fast) var(--ca-ease), transform var(--ca-duration-fast) var(--ca-ease);
  pointer-events: none;
  text-align: left;
}
.retention-bar-wrap:hover .rtip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}
</style>
