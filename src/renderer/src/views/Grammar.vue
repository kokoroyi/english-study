<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { confirmDanger } from '../lib/modal'
import { toast } from '../lib/toast'
import StructurePanel from '../components/StructurePanel.vue'
import MarkdownText from '../components/MarkdownText.vue'
import { leafKeyForLeaf } from '../lib/grammarTermMap.js'

const router = useRouter()
const route = useRoute()

const stats = ref(null)
const selected = ref(null) // {category, sub, detail}
const entries = ref([])
const loading = ref(false)

// 展开查看 AI 成分拆分
const expanded = reactive(new Set())
function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

// 批量管理
const batchMode = ref(false)
const checked = reactive(new Set())
const checkedCount = computed(() => checked.size)
const allChecked = computed(() => entries.value.length > 0 && entries.value.every((e) => checked.has(e.id)))
function toggleBatch() {
  batchMode.value = !batchMode.value
  checked.clear()
}
function toggleCheck(id) {
  if (checked.has(id)) checked.delete(id)
  else checked.add(id)
}
function toggleCheckAll() {
  if (allChecked.value) checked.clear()
  else entries.value.forEach((e) => checked.add(e.id))
}

async function refreshStats() {
  try {
    stats.value = await window.api.grammar.stats()
  } catch (e) {
    console.error('语法本概览加载失败', e)
    stats.value = null
  }
}

async function refreshList() {
  if (!selected.value) {
    entries.value = []
    return
  }
  loading.value = true
  try {
    // ref 内的对象是 reactive Proxy, 直接过 IPC 会抛 "An object could not be cloned", 必须展开成普通对象
    entries.value = await window.api.grammar.list({ ...selected.value })
  } catch (e) {
    console.error('语法本例句加载失败', e)
    entries.value = []
  } finally {
    loading.value = false
  }
}

function pick(leaf) {
  selected.value = { category: leaf.category, sub: leaf.sub, detail: leaf.detail }
  collapsed.delete(leaf.category) // 选中的分类所在分组自动展开
  saveCollapsed()
  try { localStorage.setItem(LAST_SEL_KEY, JSON.stringify({ category: leaf.category, sub: leaf.sub, detail: leaf.detail || '' })) } catch { /* 忽略 */ }
  expanded.clear()
  checked.clear()
  refreshList()
}

// ---------- 折叠式分类树(默认只展开选中分类所在分组; 状态持久化) ----------
const collapsed = reactive(new Set())
const COLLAPSE_KEY = 'es-grammar-collapsed'
const LAST_SEL_KEY = 'es-grammar-last-leaf'
function saveCollapsed() {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])) } catch { /* 忽略 */ }
}
function loadCollapsed() {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    if (raw == null) {
      // 首次访问: 默认全部收起(选中分类所在分组由 pick 展开)
      for (const g of stats.value?.groups || []) collapsed.add(g.category)
      return
    }
    const arr = JSON.parse(raw)
    for (const c of arr) collapsed.add(c)
  } catch {
    for (const g of stats.value?.groups || []) collapsed.add(g.category)
  }
}
function isCollapsed(g) {
  return collapsed.has(g.category)
}
function toggleGroup(g) {
  if (collapsed.has(g.category)) collapsed.delete(g.category)
  else collapsed.add(g.category)
  saveCollapsed()
}

// ---------- 搜索(分类术语 + 例句) ----------
const searchQuery = ref('')
const searchResults = ref(null)
let searchTimer = null
watch(searchQuery, (q) => {
  clearTimeout(searchTimer)
  const t = String(q || '').trim()
  if (!t) {
    searchResults.value = null
    return
  }
  searchTimer = setTimeout(async () => {
    try {
      searchResults.value = await window.api.grammar.search(t)
    } catch {
      searchResults.value = { leaves: [], entries: [] }
    }
  }, 200)
})
function closeSearch() {
  searchResults.value = null
}
function pickSearchLeaf(leaf) {
  closeSearch()
  pick(leaf)
}
function pickSearchEntry(entry) {
  closeSearch()
  pick({ category: entry.category, sub: entry.sub, detail: entry.detail })
}

function isSel(leaf) {
  const s = selected.value
  return !!s && s.category === leaf.category && s.sub === leaf.sub && (s.detail || '') === (leaf.detail || '')
}

function selLabel() {
  const s = selected.value
  if (!s) return ''
  return s.sub + (s.detail ? `(${s.detail})` : '')
}

// ---------- 覆盖概览(柱状): 组内已覆盖叶数 / 总叶数 与百分比 ----------
function groupCov(g) { return (g.leaves || []).filter((l) => l.count > 0).length }
function groupTotal(g) { return (g.leaves || []).length }
function groupPct(g) {
  const t = groupTotal(g)
  return t ? Math.round((groupCov(g) / t) * 100) : 0
}

// ---------- 语法知识卡片(该分类的详细教学式解释, 可编辑覆盖/恢复默认) ----------
const termInfo = ref(null)
const termLoading = ref(false)
async function loadTermInfo() {
  termInfo.value = null
  if (!selected.value) return
  termLoading.value = true
  try {
    termInfo.value = await window.api.grammar.termExplain(leafKeyForLeaf(selected.value))
  } catch (e) {
    console.error('术语解释加载失败', e)
  } finally {
    termLoading.value = false
  }
}
watch(() => selected.value, loadTermInfo)

const showEdit = ref(false)
const editForm = ref({ short: '', full: '', examplesText: '' })
function openEdit() {
  const t = termInfo.value
  editForm.value = {
    short: t?.short || '',
    full: t?.full || '',
    examplesText: (t?.examples || []).map((x) => `${x.en} || ${x.zh}`).join('\n')
  }
  showEdit.value = true
}
async function saveEdit() {
  const examples = editForm.value.examplesText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf('||')
      if (i < 0) return { en: l, zh: '' }
      return { en: l.slice(0, i).trim(), zh: l.slice(i + 2).trim() }
    })
  try {
    await window.api.grammar.termSave(leafKeyForLeaf(selected.value), {
      short: editForm.value.short.trim(),
      full: editForm.value.full.trim(),
      examples
    })
    toast('已保存自定义讲解', 'info')
    showEdit.value = false
    await loadTermInfo()
  } catch (e) {
    toast('保存失败: ' + (e.message || String(e)), 'error')
  }
}
async function resetTerm() {
  try {
    await window.api.grammar.termReset(leafKeyForLeaf(selected.value))
    toast('已恢复默认讲解', 'info')
    await loadTermInfo()
  } catch (e) {
    toast('恢复失败: ' + (e.message || String(e)), 'error')
  }
}

async function removeEntry(e) {
  const ok = await confirmDanger('删除例句', '从语法本删除这条例句?\n\n不影响原文与已保存的解析结果')
  if (!ok) return
  try {
    await window.api.grammar.remove(e.id)
    toast('已删除', 'info')
    await Promise.all([refreshStats(), refreshList()])
  } catch (err) {
    toast('删除失败: ' + (err.message || String(err)), 'error')
  }
}

async function batchRemove() {
  if (!checkedCount.value) return
  const ok = await confirmDanger('批量删除', `从语法本删除选中的 ${checkedCount.value} 条例句?\n\n不影响原文与已保存的解析结果`)
  if (!ok) return
  try {
    const ids = [...checked]
    const r = await window.api.grammar.batchRemove(ids)
    toast(`已删除 ${r.removed} 条例句`, 'info')
    checked.clear()
    await Promise.all([refreshStats(), refreshList()])
  } catch (err) {
    toast('批量删除失败: ' + (err.message || String(err)), 'error')
  }
}

function jumpToArticle(e) {
  if (!e.article_id) {
    toast('该句无关联原文(来自 AI 复习故事或手动输入)', 'info')
    return
  }
  router.push({ path: '/reading', query: { article: String(e.article_id), sentence: e.sentence } })
}

onMounted(async () => {
  await refreshStats()
  loadCollapsed()
  const all = (stats.value?.groups || []).flatMap((g) => g.leaves.map((l) => ({ category: g.category, ...l })))
  // 深链: 工作区气泡「在语法本查看」跳转而来 → 优先定位到对应分类
  const q = route.query
  if (q.cat && q.sub) {
    const leaf = all.find((l) => l.category === q.cat && l.sub === q.sub && (l.detail || '') === (q.detail || ''))
    if (leaf) {
      pick(leaf)
      return
    }
  }
  // 恢复上次选中的分类(持久化)
  try {
    const last = JSON.parse(localStorage.getItem(LAST_SEL_KEY) || 'null')
    if (last?.category && last?.sub) {
      const leaf = all.find((l) => l.category === last.category && l.sub === last.sub && (l.detail || '') === (last.detail || ''))
      if (leaf) {
        pick(leaf)
        return
      }
    }
  } catch { /* 忽略损坏数据 */ }
  const first = all.find((l) => l.count > 0) || all[0] || null
  if (first) pick(first)
})
</script>

<template>
  <div class="ca-page grammar-page">
    <div class="ca-page-header">
      <div>
        <h1 class="ca-page-title">语法本</h1>
        <p class="ca-page-desc">阅读页「完整解析」后自动归类收录 · 缺失分类一目了然 · 例句可展开查看成分拆分</p>
      </div>
      <div class="g-search-wrap">
        <input
          v-model="searchQuery"
          class="ca-input g-search-input"
          placeholder="搜索语法术语 / 例句…"
          @blur="setTimeout(closeSearch, 200)"
        />
        <div v-if="searchResults" class="g-search-panel">
          <div v-if="searchResults.leaves.length" class="g-search-section">
            <div class="g-search-sec-title">分类</div>
            <div v-for="(l, i) in searchResults.leaves" :key="'l' + i" class="g-search-leaf" @mousedown.prevent @click="pickSearchLeaf(l)">
              {{ l.sub }}<template v-if="l.detail">({{ l.detail }})</template>
              <span class="g-search-cat">{{ l.category }}</span>
            </div>
          </div>
          <div v-if="searchResults.entries.length" class="g-search-section">
            <div class="g-search-sec-title">例句</div>
            <div v-for="(e, i) in searchResults.entries" :key="'e' + i" class="g-search-entry" @mousedown.prevent @click="pickSearchEntry(e)">
              <div class="g-search-entry-sen">{{ e.sentence }}</div>
              <div class="g-search-entry-meta">{{ e.sub }}<template v-if="e.detail">({{ e.detail }})</template> · {{ e.translation }}</div>
            </div>
          </div>
          <div v-if="!searchResults.leaves.length && !searchResults.entries.length" class="g-search-empty">无匹配结果</div>
        </div>
      </div>
      <div v-if="stats" class="g-cover">
        <div class="g-cover-summary">
          <span class="g-cover-item">例句 <b>{{ stats.total }}</b></span>
          <span class="g-cover-item">覆盖 <b>{{ stats.covered }}</b>/{{ stats.totalLeaves }}</span>
        </div>
        <div v-for="g in stats.groups" :key="g.category" class="g-bar-row">
          <span class="g-bar-name">{{ g.category }}</span>
          <span class="g-bar-track"><span class="g-bar-fill" :style="{ width: groupPct(g) + '%' }"></span></span>
          <span class="g-bar-num">{{ groupCov(g) }}/{{ groupTotal(g) }}</span>
          <span class="g-bar-pct">{{ groupPct(g) }}%</span>
          <span v-if="g.count === 0" class="g-chip miss">缺失</span>
        </div>
      </div>
    </div>

    <div v-if="!stats" class="ca-workspace">
      <div class="ca-empty" style="padding: 60px">语法本加载中…</div>
    </div>

    <div v-else class="g-body ca-workspace">
      <aside class="g-tree">
        <div v-for="g in stats.groups" :key="g.category" class="g-group">
          <div class="g-group-label" @click="toggleGroup(g)" v-tip="isCollapsed(g) ? '展开' : '收起'">
            <span class="g-fold">{{ isCollapsed(g) ? '▸' : '▾' }}</span>
            <span class="g-group-name">{{ g.category }}</span>
            <span class="g-group-count">{{ g.count }}</span>
          </div>
          <template v-if="!isCollapsed(g)">
            <div
              v-for="l in g.leaves"
              :key="l.sub + l.detail"
              class="g-leaf"
              :class="{ active: isSel(l), miss: l.count === 0 }"
              @click="pick(l)"
            >
              <span class="g-leaf-name">{{ l.sub }}<template v-if="l.detail">·{{ l.detail }}</template></span>
              <span class="g-leaf-count">{{ l.count }}</span>
            </div>
          </template>
        </div>
      </aside>

      <section class="g-list">
        <div v-if="selected" class="g-list-head">
          <span class="g-breadcrumb">{{ selected.category }} / {{ selLabel() }}</span>
          <span class="g-list-total">{{ entries.length }} 条例句</span>
          <button class="ca-btn small" :class="{ on: batchMode }" @click="toggleBatch">
            {{ batchMode ? '退出批量管理' : '批量管理' }}
          </button>
        </div>

        <!-- 语法知识卡片: 该分类的教学式详细讲解(可编辑/恢复默认) -->
        <div v-if="selected" class="g-term-card ca-card">
          <div class="g-term-head">
            <span class="g-term-title">📖 {{ selLabel() }} · 语法讲解</span>
            <span v-if="termInfo?.source" class="g-term-src" :class="termInfo.source">{{ termInfo.source === 'custom' ? '自定义' : '内置' }}</span>
            <div class="g-term-actions">
              <button class="ca-btn small" @click="openEdit">编辑</button>
              <button class="ca-btn small" @click="resetTerm" :disabled="termInfo?.source !== 'custom'">恢复默认</button>
            </div>
          </div>
          <div v-if="termLoading" class="ca-empty" style="padding: 14px">加载中…</div>
          <template v-else-if="termInfo">
            <MarkdownText v-if="termInfo.full" class="g-term-full" :text="termInfo.full" />
            <div v-else class="g-term-full muted">该分类暂无讲解, 点「编辑」写下你自己的理解和例句。</div>
            <div v-if="termInfo.examples && termInfo.examples.length" class="g-term-examples">
              <div class="g-term-ex-title">典型例句</div>
              <div v-for="(ex, i) in termInfo.examples" :key="i" class="g-term-ex">
                <div class="g-term-ex-en">{{ ex.en }}</div>
                <div class="g-term-ex-zh">{{ ex.zh }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- 批量操作条 -->
        <div v-if="batchMode" class="g-batch-bar">
          <label class="g-check-all">
            <input type="checkbox" :checked="allChecked" @change="toggleCheckAll" />
            <span>全选当前分类</span>
          </label>
          <span class="g-batch-count">已选 {{ checkedCount }} 条</span>
          <button class="ca-btn small ca-btn--danger" :disabled="!checkedCount" @click="batchRemove">批量删除</button>
        </div>

        <div v-if="loading" class="ca-empty" style="padding: 60px"><div class="spinner"></div></div>

        <div v-else-if="!entries.length" class="ca-empty" style="padding: 60px">
          <div>该分类还没有例句</div>
          <div class="g-empty-tip">阅读页选中句子 → 点「完整解析」, 系统自动归类收录</div>
        </div>

        <template v-else>
          <div v-for="e in entries" :key="e.id" class="g-card ca-card" :class="{ 'g-card-checked': batchMode && checked.has(e.id) }">
            <div class="g-card-main" @click="batchMode ? toggleCheck(e.id) : toggleExpand(e.id)">
              <div class="g-card-row">
                <input v-if="batchMode" type="checkbox" class="g-check" :checked="checked.has(e.id)" @click.stop @change="toggleCheck(e.id)" />
                <span class="g-sentence">{{ e.sentence }}</span>
              </div>
              <div v-if="e.translation" class="g-translation">{{ e.translation }}</div>
              <div class="g-tags">
                <button
                  v-if="e.structure && Array.isArray(e.structure.segments) && e.structure.segments.length"
                  class="g-toggle"
                  @click.stop="toggleExpand(e.id)"
                >
                  {{ expanded.has(e.id) ? '收起成分拆分 ▲' : '查看成分拆分 ▼' }}
                </button>
                <span v-else class="g-no-structure">暂无解析结构</span>
              </div>
            </div>

            <div v-if="expanded.has(e.id) && e.structure" class="g-structure">
              <StructurePanel :sentence="e.sentence" :structure="e.structure" />
            </div>

            <div class="g-foot">
              <span class="g-src" :class="{ gone: !e.article_title }">
                {{ e.article_title ? '来自《' + e.article_title + '》' : '无关联原文' }}
              </span>
              <span class="g-time">{{ (e.created_at || '').slice(0, 16) }}</span>
              <button class="ca-btn small" @click="jumpToArticle(e)">回原文</button>
              <button class="ca-btn small ca-btn--danger-text" @click="removeEntry(e)">删除</button>
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- 语法讲解编辑弹窗 -->
    <div v-if="showEdit" class="summary-overlay" @click.self="showEdit = false">
      <div class="g-edit-card ca-card">
        <div class="overlay-head">
          <span>编辑语法讲解 · {{ selLabel() }}</span>
          <button class="op-btn" @click="showEdit = false">✕</button>
        </div>
        <div class="g-edit-body">
          <label class="g-edit-label">简短解释(工作区弹窗用, 一两句直白说明)</label>
          <textarea v-model="editForm.short" class="g-edit-ta" rows="2"></textarea>
          <label class="g-edit-label">详细讲解(语法本展示, 教学式: 定义/结构/要点)</label>
          <textarea v-model="editForm.full" class="g-edit-ta" rows="8"></textarea>
          <label class="g-edit-label">典型例句(每行一条: 英文 || 中文翻译)</label>
          <textarea v-model="editForm.examplesText" class="g-edit-ta" rows="4"></textarea>
        </div>
        <div class="g-edit-foot">
          <button class="ca-btn" @click="showEdit = false">取消</button>
          <button class="ca-btn ca-btn--primary" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 语法本占满整个次级内容区(同词库页, 不设最大宽度) */

.g-cover { display: flex; flex-direction: column; gap: 6px; width: 300px; }
.g-cover-summary { display: flex; align-items: center; gap: 12px; justify-content: flex-end; flex-wrap: wrap; }
.g-cover-item { font-size: 12px; color: var(--ca-ink-3); white-space: nowrap; }
.g-cover-item b { color: var(--ca-primary); font-size: 14px; }
/* 覆盖概览: 各分类横条柱状 */
.g-bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--ca-ink-2); }
.g-bar-name { flex: 0 0 64px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-bar-track { flex: 1; min-width: 0; height: 8px; border-radius: 4px; background: var(--ca-surface-subtle); overflow: hidden; }
.g-bar-fill { display: block; height: 100%; border-radius: 4px; background: var(--ca-primary); }
.g-bar-num { flex: 0 0 auto; font-variant-numeric: tabular-nums; color: var(--ca-ink-3); }
.g-bar-pct { flex: 0 0 38px; text-align: right; font-variant-numeric: tabular-nums; }

/* 搜索框 + 结果面板 */
.g-search-wrap { position: relative; }
.g-search-input { width: 240px; }
.g-search-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 600;
  width: 420px;
  max-height: 340px;
  overflow-y: auto;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  box-shadow: var(--ca-shadow-float);
  padding: 8px;
}
.g-search-sec-title { font-size: 11px; font-weight: 700; color: var(--ca-ink-3); padding: 4px 8px 2px; }
.g-search-leaf {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; border-radius: 7px;
  font-size: 13px; color: var(--ca-ink-2); cursor: pointer;
}
.g-search-leaf:hover { background: var(--ca-primary-soft); color: var(--ca-primary); }
.g-search-cat { font-size: 11px; color: var(--ca-ink-3); }
.g-search-entry { padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.g-search-entry:hover { background: var(--ca-primary-soft); }
.g-search-entry-sen { font-size: 13px; color: var(--ca-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-search-entry-meta { font-size: 11.5px; color: var(--ca-ink-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-search-empty { padding: 12px; text-align: center; font-size: 12px; color: var(--ca-ink-3); }
.g-chip {
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--ca-success-soft);
  color: var(--ca-success-ink);
  font-size: 12px;
  font-weight: 600;
}
.g-chip.miss {
  background: var(--ca-surface-subtle);
  color: var(--ca-ink-3);
  border: 1px dashed var(--ca-line);
}

.g-body { display: flex; min-height: calc(100vh - 220px); overflow: hidden; padding: 0; }
.g-tree {
  width: 240px;
  flex: 0 0 240px;
  border-right: 1px solid var(--ca-line);
  overflow-y: auto;
  padding: 12px 8px;
}
.g-group { margin-bottom: 6px; }
.g-group-label {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 8px 10px 4px;
  font-size: 12px; font-weight: 700; color: var(--ca-ink-2);
  cursor: pointer; user-select: none; border-radius: 6px;
}
.g-group-label:hover { background: var(--ca-surface-subtle); }
.g-fold { width: 14px; flex: 0 0 14px; color: var(--ca-ink-3); font-size: 10px; }
.g-group-name { flex: 1; }
.g-group-count { font-size: 11px; color: var(--ca-ink-3); font-weight: 600; }
.g-leaf {
  display: flex; align-items: center; justify-content: space-between;
  padding: 5px 10px 5px 16px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--ca-ink-2);
  cursor: pointer;
  transition: background var(--ca-duration-fast) var(--ca-ease);
}
.g-leaf:hover { background: var(--ca-surface-subtle); }
.g-leaf.active { background: var(--ca-primary-soft); color: var(--ca-primary); font-weight: 600; }
.g-leaf.miss { color: var(--ca-ink-3); }
.g-leaf.miss .g-leaf-count { opacity: 0.55; }
.g-leaf-count { font-size: 11px; color: var(--ca-ink-3); }
.g-leaf.active .g-leaf-count { color: var(--ca-primary); }

.g-list { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px; }
.g-list-head {
  display: flex; align-items: center; gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--ca-line);
  margin-bottom: 12px;
}
.g-breadcrumb { font-size: 14px; font-weight: 700; flex: 1; }
.g-list-total { font-size: 12px; color: var(--ca-ink-3); }

/* 语法知识卡片 */
.g-term-card { padding: 14px 16px; margin-bottom: 12px; border-left: 3px solid var(--ca-primary); }
.g-term-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.g-term-title { font-size: 13.5px; font-weight: 700; flex: 1; }
.g-term-src { font-size: 11px; padding: 1px 8px; border-radius: 999px; }
.g-term-src.builtin { background: var(--ca-surface-subtle); color: var(--ca-ink-3); }
.g-term-src.custom { background: var(--ca-success-soft); color: var(--ca-success-ink); }
.g-term-actions { display: flex; gap: 8px; }
.g-term-full { font-size: 13px; line-height: 1.9; color: var(--ca-ink-2); white-space: pre-wrap; }
.g-term-full.muted { color: var(--ca-ink-3); }
.g-term-examples { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.g-term-ex-title { font-size: 12px; font-weight: 700; color: var(--ca-ink-2); }
.g-term-ex { padding: 7px 10px; border-left: 2px solid var(--ca-primary-border); background: var(--ca-surface-subtle); border-radius: 0 6px 6px 0; }
.g-term-ex-en { font-size: 13px; color: var(--ca-ink); font-style: italic; }
.g-term-ex-zh { font-size: 12px; color: var(--ca-ink-3); margin-top: 2px; }

/* 讲解编辑弹窗 */
.g-edit-card { width: 560px; max-width: 92vw; box-shadow: var(--ca-shadow-float); overflow: hidden; }
.g-edit-body { padding: 14px 18px; display: flex; flex-direction: column; gap: 8px; max-height: 62vh; overflow-y: auto; }
.g-edit-label { font-size: 12px; font-weight: 600; color: var(--ca-ink-2); }
.g-edit-ta {
  width: 100%;
  border: 1px solid var(--ca-line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.7;
  resize: vertical;
  background: var(--ca-surface);
  color: var(--ca-ink);
  outline: none;
  font-family: inherit;
}
.g-edit-ta:focus { border-color: var(--ca-primary); }
.g-edit-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 18px; border-top: 1px solid var(--ca-line); }

.summary-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(11, 18, 32, 0.4); display: grid; place-items: center; }
.overlay-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--ca-line); font-weight: 700; font-size: 14px; }
.op-btn { width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--ca-ink-3); cursor: pointer; }
.op-btn:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }

.g-batch-bar {
  display: flex; align-items: center; gap: 14px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px dashed var(--ca-primary-border);
  border-radius: 10px;
  background: var(--ca-primary-soft);
  font-size: 13px;
}
.g-check-all { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.g-batch-count { color: var(--ca-primary); font-weight: 600; }
.ca-btn--danger { color: #fff; background: var(--ca-critical); border-color: transparent; }

.g-card { padding: 14px 16px; margin-bottom: 12px; transition: box-shadow var(--ca-duration-fast) var(--ca-ease); }
.g-card-checked { box-shadow: 0 0 0 2px var(--ca-primary); }
.g-card-main { cursor: pointer; }
.g-card-row { display: flex; align-items: baseline; gap: 8px; }
.g-check { flex: 0 0 auto; cursor: pointer; }
.g-sentence { font-size: 14.5px; line-height: 1.7; color: var(--ca-ink); }
.g-translation { margin-top: 6px; font-size: 13px; line-height: 1.7; color: var(--ca-ink-2); }
.g-tags { margin-top: 6px; }
.g-toggle {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--ca-line);
  border-radius: 999px;
  background: var(--ca-surface);
  color: var(--ca-primary);
  font-size: 12px;
  cursor: pointer;
}
.g-toggle:hover { border-color: var(--ca-primary); }
.g-no-structure { font-size: 12px; color: var(--ca-ink-3); }
.g-structure {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--ca-line);
  border-radius: 10px;
  background: var(--ca-surface-subtle);
}
.g-foot {
  display: flex; align-items: center; gap: 10px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px dashed var(--ca-line);
  font-size: 12px;
  color: var(--ca-ink-3);
}
.g-src { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-src.gone { color: var(--ca-warning-ink); }
.g-time { font-variant-numeric: tabular-nums; }

.g-empty-tip { margin-top: 10px; font-size: 12.5px; color: var(--ca-ink-3); }

.spinner {
  width: 28px; height: 28px;
  margin: 0 auto;
  border: 3px solid var(--ca-line);
  border-top-color: var(--ca-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
</style>
