<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { confirm, confirmDanger, alert } from '../lib/modal'
import { toast } from '../lib/toast'
import { fmtPhonetic } from '../lib/phonetic.js'
import { store } from '../store'

const words = ref([])
const tab = ref('new') // new | learning | fluent | all
const keyword = ref('')
const loading = ref(false)
const selected = ref(new Set())
const batchMode = ref(false) // 批量管理模式开关
const showAddDialog = ref(false)
const addWordInput = ref('')
const addWordPreview = ref(null)
const detailWord = ref(null) // 展开的单词详情

const tabs = [
  { key: 'new', label: '生词' },
  { key: 'learning', label: '学习中' },
  { key: 'fluent', label: '熟词' },
  { key: 'all', label: '全部' }
]

async function load() {
  loading.value = true
  try {
    const filters = { status: tab.value === 'all' ? 'all' : tab.value, keyword: keyword.value || undefined }
    words.value = await window.api.words.list(filters)
  } catch (e) {
    console.error('词库加载失败', e)
    words.value = []
  } finally {
    loading.value = false
  }
}

// 页面级持久化: tab/搜索词跨导航恢复
function saveVocabState() {
  store.pageState.vocabulary = { tab: tab.value, keyword: keyword.value }
}
onMounted(() => {
  const saved = store.pageState.vocabulary
  if (saved?.tab && tabs.some((t) => t.key === saved.tab)) tab.value = saved.tab
  if (saved?.keyword) keyword.value = saved.keyword
  load()
})
onBeforeUnmount(saveVocabState)

function onTabChange() {
  selected.value.clear()
  saveVocabState()
  load()
}

const filteredWords = computed(() => words.value)
const allSelected = computed(() => filteredWords.length > 0 && selected.value.size === filteredWords.length)

function enterBatchMode() {
  batchMode.value = true
  selected.value.clear()
}

function exitBatchMode() {
  batchMode.value = false
  selected.value.clear()
}

// 批量模式下点击行选中/取消; 平时点击看详情
function onRowClick(w) {
  if (batchMode.value) {
    if (selected.value.has(w.id)) selected.value.delete(w.id)
    else selected.value.add(w.id)
  } else {
    openDetail(w)
  }
}

function toggleAll() {
  if (allSelected.value) selected.value.clear()
  else filteredWords.value.forEach((w) => selected.value.add(w.id))
}

async function batchDelete() {
  const ids = [...selected.value]
  if (!ids.length) return
  const ok = await confirm('删除生词', `确定删除选中的 ${ids.length} 个单词吗?\n(该操作不可恢复)`)
  if (!ok) return
  await window.api.words.batchRemove(ids)
  selected.value.clear()
  exitBatchMode()
  load()
}

async function exportSelected(format) {
  const ids = [...selected.value]
  if (!ids.length) {
    await alert('提示', '请先选择要导出的单词')
    return
  }
  const res = await window.api.words.export(ids, format)
  if (res.ok) {
    // 主进程已通过保存对话框写入文件; 之前这里再走一次 blob 下载,
    // 会额外产出一个内容为 undefined 的空文件
    toast(`已导出到 ${res.path}`)
  } else if (res.canceled) {
    // 用户取消保存, 静默
  } else {
    toast('导出失败: ' + (res.error || '未知错误'), 'error')
  }
}

async function addWord() {
  const w = addWordInput.value.trim()
  if (!w) return
  // 先归并原型: 输入变体词(如 perceived)时预览原词的词义而非时态说明
  try {
    const lemma = await window.api.dict.lemma(w)
    addWordPreview.value = (await window.api.dict.lookup(lemma)) || (await window.api.dict.lookup(w))
  } catch {
    addWordPreview.value = await window.api.dict.lookup(w)
  }
  if (!addWordPreview.value) {
    await alert('词典查询', `词典中未找到「${w}」`)
  }
}

async function confirmAdd() {
  await window.api.words.add({ word: addWordPreview.value.word })
  showAddDialog.value = false
  addWordInput.value = ''
  addWordPreview.value = null
  load()
}

async function removeOne(id, lemma) {
  const ok = await confirmDanger('删除生词', `确定删除「${lemma}」吗?\n(该操作不可恢复)`)
  if (!ok) return
  await window.api.words.remove(id)
  load()
}

async function resetProgress() {
  const ok = await confirmDanger(
    '重置学习进度',
    '把所有词的学习进度全部重置吗?\n\n词条与标记次数保留, 状态回到「生词」、认识/失误计数清零、复习记录清空, 明天起重新开始。\n\n适合停学很久、想推倒重来的情况。'
  )
  if (!ok) return
  const res = await window.api.words.resetProgress()
  toast(`已重置 ${res.reset} 个词的学习进度`)
  load()
}

async function openDetail(w) {
  const entry = await window.api.dict.lookup(w.lemma)
  detailWord.value = { ...w, entry }
}

function statusLabel(s) {
  return { new: '生词', learning: '学习中', fluent: '熟词' }[s] || s
}

function statusClass(s) {
  return { new: 'badge-critical', learning: 'badge-warning', fluent: 'badge-success' }[s] || ''
}

function fmtDate(iso) {
  if (!iso) return '-'
  // due_at 是 UTC ISO, 直接 slice 会显示 UTC 日期(东八区早晨差一天); 转本地日期
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso).slice(0, 10)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 来源列: 优先显示来源文章标题(后端 words.list 新增 source_article_title), 过长截断; 缺失回退旧显示
function sourceLabel(w) {
  const t = String(w.source_article_title || '').trim()
  if (t) return t.length > 18 ? t.slice(0, 18) + '…' : t
  if (w.source_article_id) return '阅读 #' + w.source_article_id
  return w.is_manual ? '手动' : '-'
}
</script>

<template>
  <div class="ca-page">
    <div class="ca-page-header">
      <div>
        <h1 class="ca-page-title">词库</h1>
        <p class="ca-page-desc">生词本与熟词本管理</p>
      </div>
      <div class="flex">
        <button v-if="!batchMode" class="ca-btn" @click="showAddDialog = true">
          + 添加生词
        </button>
        <button v-if="!batchMode" class="ca-btn" @click="enterBatchMode">批量管理</button>
        <button v-if="!batchMode" class="ca-btn ca-btn--danger-text" @click="resetProgress">重置进度</button>
      </div>
    </div>

    <div class="ca-card">
      <div class="vocab-toolbar">
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t.key"
            class="tab-btn"
            :class="{ active: tab === t.key }"
            @click="tab = t.key; onTabChange()"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="flex">
          <input v-model="keyword" class="ca-input search-input" placeholder="搜索单词 / 释义…" @keyup.enter="load" />
          <button class="ca-btn" @click="load">搜索</button>
        </div>
      </div>

      <!-- 批量管理模式操作栏: 独立于列表内容, 空列表时也能退出批量模式 -->
      <div class="batch-bar" v-if="batchMode">
        <div class="flex" style="gap:12px">
          <button class="batch-select-all" @click="toggleAll">
            <span class="check-box" :class="{ checked: allSelected }"></span>
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <span class="batch-count">已选 {{ selected.size }} 个</span>
        </div>
        <div class="flex" style="gap:8px">
          <button class="ca-btn" @click="exportSelected('csv')">导出 CSV</button>
          <button class="ca-btn" @click="exportSelected('json')">导出 JSON</button>
          <button class="ca-btn ca-btn--danger-text" @click="batchDelete" :disabled="!selected.size">删除</button>
          <button class="ca-btn" @click="exitBatchMode">退出</button>
        </div>
      </div>

      <div v-if="loading" class="ca-empty">加载中…</div>

      <div v-else-if="!filteredWords.length" class="ca-empty">
        暂无单词, 去阅读文章标记生词吧
      </div>

      <template v-else>
        <table class="vocab-table" :class="{ 'batch-active': batchMode }">
          <thead>
            <tr>
              <th v-if="batchMode" style="width:36px"></th>
              <th>单词</th>
              <th>释义</th>
              <th>状态</th>
              <th>来源</th>
              <th>标记次数</th>
              <th>下次复习</th>
              <th style="width:80px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="w in filteredWords" :key="w.id" :class="{ selected: selected.has(w.id) }" @click="onRowClick(w)">
              <td v-if="batchMode">
                <span class="check-box" :class="{ checked: selected.has(w.id) }"></span>
              </td>
              <td class="word-cell">
                <div class="word-main" @click.stop="batchMode ? toggleSelect(w) : openDetail(w)">
                  <span class="lemma">{{ w.lemma }}</span>
                  <span class="phonetic" v-if="w.phonetic">{{ fmtPhonetic(w.phonetic) }}</span>
                </div>
                <div class="word-sub" v-if="w.source_context">{{ w.source_context }}</div>
              </td>
              <td class="trans-cell">
                <div class="trans-line" v-if="w.translation">{{ w.translation.split('\n').slice(0, 2).join(' ') }}</div>
              </td>
              <td>
                <span class="ca-badge" :class="statusClass(w.status)">{{ statusLabel(w.status) }}</span>
              </td>
              <td class="muted source-cell" v-tip="w.source_article_title || ''">{{ sourceLabel(w) }}</td>
              <td class="ca-tabular">{{ w.marked_count }}</td>
              <td class="ca-tabular muted">{{ fmtDate(w.due_at) }}</td>
              <td class="ops-cell">
                <button class="op-btn" @click.stop="batchMode ? null : openDetail(w)" v-tip="'详情'">⋯</button>
                <button class="op-btn danger" @click.stop="batchMode ? null : removeOne(w.id, w.lemma)" v-tip="'删除'">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </div>

    <!-- 添加生词对话框 -->
    <div v-if="showAddDialog" class="dialog-overlay" @click.self="showAddDialog = false">
      <div class="dialog ca-card">
        <h3>添加生词</h3>
        <div class="flex mt-3">
          <input v-model="addWordInput" class="ca-input flex-1" placeholder="输入单词或词组…" @keyup.enter="addWord" />
          <button class="ca-btn" @click="addWord">查询</button>
        </div>
        <div v-if="addWordPreview" class="add-preview mt-3">
          <div class="flex">
            <span class="lemma">{{ addWordPreview.word }}</span>
            <span class="phonetic" v-if="addWordPreview.phonetic">{{ fmtPhonetic(addWordPreview.phonetic) }}</span>
          </div>
          <div class="mt-2 muted" style="font-size:13px;line-height:1.6">{{ addWordPreview.translation }}</div>
        </div>
        <div class="flex mt-4" style="justify-content:flex-end">
          <button class="ca-btn" @click="showAddDialog = false">取消</button>
          <button class="ca-btn ca-btn--primary" :disabled="!addWordPreview" @click="confirmAdd">加入生词本</button>
        </div>
      </div>
    </div>

    <!-- 单词详情 -->
    <div v-if="detailWord" class="dialog-overlay" @click.self="detailWord = null">
      <div class="dialog ca-card detail-dialog">
        <div class="flex">
          <div class="dict-head">
            <span class="lemma big">{{ detailWord.lemma }}</span>
            <span class="phonetic" v-if="detailWord.entry?.phonetic">{{ fmtPhonetic(detailWord.entry.phonetic) }}</span>
            <span class="ca-badge" :class="statusClass(detailWord.status)">{{ statusLabel(detailWord.status) }}</span>
          </div>
          <button class="op-btn" @click="detailWord = null">✕</button>
        </div>

        <div class="mt-3" v-if="detailWord.entry?.tag">
          <span class="tag" v-for="t in detailWord.entry.tag.split(' ').filter(Boolean)" :key="t">{{ t }}</span>
          <span class="tag" v-if="detailWord.entry.collins">柯林斯 {{ detailWord.entry.collins }} 星</span>
          <span class="tag" v-if="detailWord.entry.oxford">牛津 3000</span>
        </div>

        <div class="mt-3 trans-block" v-if="detailWord.entry?.translation">
          {{ detailWord.entry.translation }}
        </div>
        <div class="mt-2 def-block" v-if="detailWord.entry?.definition">
          {{ detailWord.entry.definition }}
        </div>

        <div class="detail-meta mt-4">
          <div class="meta-row"><span>标记次数</span><strong>{{ detailWord.marked_count }}</strong></div>
          <div class="meta-row"><span>认识次数</span><strong>{{ detailWord.known_count }}</strong></div>
          <div class="meta-row"><span>失误次数</span><strong>{{ detailWord.miss_count }}</strong></div>
          <div class="meta-row"><span>首次标记</span><strong>{{ fmtDate(detailWord.first_marked_at) }}</strong></div>
          <div class="meta-row"><span>下次复习</span><strong>{{ fmtDate(detailWord.due_at) }}</strong></div>
        </div>

        <div class="flex mt-4" style="justify-content:flex-end">
          <button class="ca-btn ca-btn--danger-text" @click="removeOne(detailWord.id, detailWord.lemma); detailWord = null">从词库删除</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ca-btn--danger-text { color: var(--ca-critical); border-color: var(--ca-critical); background: var(--ca-critical-soft); }

.vocab-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ca-line);
  flex-wrap: wrap;
}

.tabs { display: flex; gap: 4px; }
.tab-btn {
  height: 30px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--ca-ink-3);
  cursor: pointer;
}
.tab-btn.active { background: var(--ca-primary-soft); color: var(--ca-primary); }
.search-input { width: 220px; }

.batch-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--ca-primary-soft);
  font-size: 13px;
  font-weight: 600;
  color: var(--ca-primary);
}
.batch-select-all { display: inline-flex; align-items: center; gap: 8px; border: none; background: none; color: var(--ca-primary); font-weight: 600; cursor: pointer; }
.batch-count { color: var(--ca-primary); }

.check-box {
  width: 18px;
  height: 18px;
  border: 2px solid var(--ca-primary);
  border-radius: 5px;
  display: inline-block;
  transition: background var(--ca-duration-fast) var(--ca-ease);
  vertical-align: middle;
}
.check-box.checked {
  background: var(--ca-primary);
  position: relative;
}
.check-box.checked::after {
  content: '✓';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
}

.vocab-table { width: 100%; border-collapse: collapse; }
.vocab-table.batch-active tbody tr { cursor: pointer; }
.vocab-table.batch-active tbody tr:hover td { background: var(--ca-primary-soft); }
.vocab-table.batch-active .word-main { cursor: default; }
.vocab-table th {
  text-align: left;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ca-ink-3);
  background: var(--ca-surface-subtle);
  border-bottom: 1px solid var(--ca-line);
  letter-spacing: 0.04em;
}
.vocab-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--ca-line);
  font-size: 13px;
  vertical-align: middle;
}
.vocab-table tr:hover td { background: var(--ca-surface-subtle); }
.vocab-table tr.selected td { background: var(--ca-primary-soft); }

.word-cell { max-width: 220px; }
.word-main { display: flex; align-items: baseline; gap: 8px; cursor: pointer; }
.lemma { font-weight: 600; font-size: 14px; }
.phonetic { color: var(--ca-ink-3); font-size: 12px; }
.word-sub { font-size: 11px; color: var(--ca-ink-3); margin-top: 2px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trans-cell { max-width: 300px; }
.trans-line { color: var(--ca-ink-2); font-size: 12px; line-height: 1.5; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ops-cell { text-align: right; white-space: nowrap; }
.op-btn {
  width: 26px; height: 26px;
  border: none; border-radius: 6px;
  background: transparent; color: var(--ca-ink-3);
  cursor: pointer; font-size: 14px;
}
.op-btn:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }
.op-btn.danger:hover { background: var(--ca-critical-soft); color: var(--ca-critical); }

.dialog-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(11, 18, 32, 0.4);
  display: grid; place-items: center;
}
.dialog { width: 460px; max-width: 92vw; padding: 24px; box-shadow: var(--ca-shadow-float); }
.dialog h3 { margin: 0; font-size: 17px; }

.add-preview { padding: 12px; border-radius: 10px; background: var(--ca-surface-subtle); }
.lemma.big { font-size: 22px; }

.tag {
  font-size: 11px; padding: 2px 8px; margin-right: 4px;
  border-radius: 999px;
  background: var(--ca-primary-soft); color: var(--ca-primary); font-weight: 600;
}

.trans-block { font-size: 14px; line-height: 1.7; color: var(--ca-ink); }
.def-block { font-size: 12px; line-height: 1.6; color: var(--ca-ink-2); white-space: pre-line; }

.detail-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.meta-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px dashed var(--ca-line); font-size: 13px; }
.meta-row span { color: var(--ca-ink-3); }
.dict-head { display: flex; align-items: center; gap: 10px; flex: 1; }
</style>
