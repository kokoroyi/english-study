<script setup>
import { ref, computed, onMounted } from 'vue'
import { confirm, confirmDanger } from '../lib/modal'

const articles = ref([])
const keyword = ref('')
const loading = ref(false)
const readingArticle = ref(null)
const selected = ref(new Set())
const batchMode = ref(false) // 批量管理模式开关

async function load() {
  loading.value = true
  try {
    articles.value = await window.api.articles.list({ keyword: keyword.value || undefined })
  } catch (e) {
    console.error('文章列表加载失败', e)
    articles.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

const allSelected = computed(() => articles.value.length > 0 && selected.value.size === articles.value.length)

function enterBatchMode() {
  batchMode.value = true
  selected.value.clear()
}

function exitBatchMode() {
  batchMode.value = false
  selected.value.clear()
}

// 批量模式下点击卡片选中/取消
function toggleSelect(a) {
  if (!batchMode.value) return
  if (selected.value.has(a.id)) selected.value.delete(a.id)
  else selected.value.add(a.id)
}

function toggleAll() {
  if (allSelected.value) selected.value.clear()
  else articles.value.forEach((a) => selected.value.add(a.id))
}

async function batchDelete() {
  const ids = [...selected.value]
  if (!ids.length) return
  const ok = await confirmDanger('删除文章', `确定删除选中的 ${ids.length} 篇文章吗?\n(关联生词会保留)`)
  if (!ok) return
  await window.api.articles.batchRemove(ids)
  selected.value.clear()
  exitBatchMode()
  load()
}

function fmtDate(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function remove(a) {
  const ok = await confirmDanger('删除文章', `确定删除「${a.title}」吗?\n(关联生词会保留)`)
  if (!ok) return
  await window.api.articles.remove(a.id)
  load()
}
</script>

<template>
  <div class="ca-page">
    <div class="ca-page-header">
      <div>
        <h1 class="ca-page-title">文章历史</h1>
        <p class="ca-page-desc">所有已阅读文章的存档</p>
      </div>
      <div class="flex">
        <input v-model="keyword" class="ca-input search-input" placeholder="搜索标题 / 内容…" @keyup.enter="load" />
        <button class="ca-btn" @click="load">搜索</button>
        <button v-if="!batchMode" class="ca-btn" @click="enterBatchMode">批量管理</button>
      </div>
    </div>

    <div v-if="loading" class="ca-empty">加载中…</div>
    <div v-else-if="!articles.length" class="ca-card ca-card-pad ca-empty">
      还没有文章, 去阅读页输入第一篇吧
    </div>

    <template v-else>
      <!-- 批量管理模式操作栏 -->
      <div class="batch-bar" v-if="batchMode">
        <div class="flex" style="gap:12px">
          <button class="batch-select-all" @click="toggleAll">
            <span class="check-box" :class="{ checked: allSelected }"></span>
            {{ allSelected ? '取消全选' : '全选' }}
          </button>
          <span class="batch-count">已选 {{ selected.size }} 篇</span>
        </div>
        <div class="flex" style="gap:8px">
          <button class="ca-btn ca-btn--danger-text" @click="batchDelete" :disabled="!selected.size">删除</button>
          <button class="ca-btn" @click="exitBatchMode">退出</button>
        </div>
      </div>

      <div class="article-grid">
        <div
          v-for="a in articles"
          :key="a.id"
          class="article-card ca-card"
          :class="{ 'batch-active': batchMode, selected: selected.has(a.id) }"
          @click="toggleSelect(a)"
        >
          <div class="article-head">
            <span v-if="batchMode" class="check-box card-check" :class="{ checked: selected.has(a.id) }"></span>
            <div class="article-title" @click.stop="batchMode ? null : (readingArticle = a)">{{ a.title }}</div>
            <button class="op-btn" @click.stop="batchMode ? null : remove(a)">✕</button>
          </div>
          <div class="article-preview">{{ (a.cleaned_content || a.content || '').slice(0, 140) }}</div>
          <div class="article-meta">
            <span>{{ fmtDate(a.created_at) }}</span>
            <span>{{ a.word_count }} 词</span>
            <span>{{ a.marked_word_count }} 个标记</span>
            <button class="ca-btn small" @click.stop="batchMode ? null : (readingArticle = a)">重新阅读</button>
          </div>
        </div>
      </div>
    </template>

    <!-- 重新阅读 -->
    <div v-if="readingArticle" class="dialog-overlay">
      <div class="read-dialog ca-card">
        <div class="read-head">
          <span class="read-title">{{ readingArticle.title }}</span>
          <button class="op-btn" @click="readingArticle = null">✕</button>
        </div>
        <div class="read-body">{{ readingArticle.cleaned_content || readingArticle.content }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-input { width: 240px; }

.batch-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 16px; margin-bottom: 16px;
  background: var(--ca-primary-soft); border-radius: 10px;
  font-size: 13px; font-weight: 600; color: var(--ca-primary);
}
.batch-count { color: var(--ca-primary); }
.batch-select-all { display: inline-flex; align-items: center; gap: 8px; border: none; background: none; color: var(--ca-primary); font-weight: 600; cursor: pointer; }

.check-box {
  width: 18px; height: 18px;
  border: 2px solid var(--ca-primary);
  border-radius: 5px;
  display: inline-block;
  transition: background var(--ca-duration-fast) var(--ca-ease);
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

.article-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.article-card { padding: 16px; display: flex; flex-direction: column; gap: 10px; transition: border-color var(--ca-duration-fast) var(--ca-ease), transform var(--ca-duration-fast) var(--ca-ease); }
.article-card.batch-active { cursor: pointer; }
.article-card.batch-active:hover { border-color: var(--ca-primary); transform: translateY(-1px); }
.article-card.selected { border-color: var(--ca-primary); box-shadow: 0 0 0 1px var(--ca-primary); background: var(--ca-primary-soft); }

.article-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.card-check { flex: 0 0 18px; margin-top: 2px; }
.article-title { font-weight: 700; font-size: 14px; cursor: pointer; line-height: 1.4; flex: 1; }
.article-title:hover { color: var(--ca-primary); }
.article-preview { color: var(--ca-ink-3); font-size: 12px; line-height: 1.6; flex: 1; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.article-meta { display: flex; align-items: center; gap: 12px; font-size: 11px; color: var(--ca-ink-3); border-top: 1px solid var(--ca-line); padding-top: 10px; }
.article-meta .ca-btn { margin-left: auto; }
.ca-btn.small { height: 26px; padding: 0 10px; font-size: 12px; }
.ca-btn--danger-text { color: var(--ca-critical); border-color: var(--ca-critical-soft); background: var(--ca-critical-soft); }

.op-btn { width: 26px; height: 26px; border: none; border-radius: 6px; background: transparent; color: var(--ca-ink-3); cursor: pointer; }
.op-btn:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }

.dialog-overlay { position: fixed; inset: 0; z-index: 2000; background: rgba(11, 18, 32, 0.5); display: grid; place-items: center; }
.read-dialog { width: 720px; max-width: 94vw; max-height: 86vh; display: flex; flex-direction: column; box-shadow: var(--ca-shadow-float); }
.read-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--ca-line); }
.read-title { font-weight: 700; font-size: 15px; }
.read-body { padding: 20px 28px; overflow-y: auto; line-height: 1.9; font-size: 16px; white-space: pre-wrap; }
</style>
