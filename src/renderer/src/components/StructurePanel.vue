<script setup>
// 共享结构展示: 原句分段着色条 + 缩进语法树 + 要点(工作区与语法本例句卡共用)
import { ref, computed } from 'vue'
import { buildColoredParts } from '../lib/sentenceSplit.js'
import { leafForTermKey } from '../lib/grammarTermMap.js'
import { renderWordSpans } from '../lib/wordClass.js'
import GrammarTermPopup from './GrammarTermPopup.vue'
import MarkdownText from './MarkdownText.vue'

const props = defineProps({
  sentence: { type: String, default: '' },
  structure: { type: Object, default: null } // { segments: [...], notes: [...] }
})

const hoverSegId = ref(-1)

const SEG_COLOR = (type) => {
  const t = String(type || '')
  if (t.includes('主句')) return 'sp-main'
  if (t.includes('定语')) return 'sp-attrib'
  if (t.includes('状语')) return 'sp-adv'
  if (t.includes('从句')) return 'sp-noun'
  if (t.includes('非谓语')) return 'sp-nonfinite'
  return 'sp-phrase'
}

// 原句条: 词级着色(每个完整词取重叠最多的片段配色; 空格恒为独立元素, 不黏字不漏字母)
const sentenceParts = computed(() => {
  const data = props.structure
  const text = props.sentence || ''
  if (!data || !Array.isArray(data.segments) || !data.segments.length) return [{ text, seg: null }]
  return buildColoredParts(text, data.segments)
})

// 缩进树: parent 引用 → 深度
const segTree = computed(() => {
  const data = props.structure
  if (!data || !Array.isArray(data.segments)) return []
  const segs = data.segments
  const depthOf = (seg, visited = new Set()) => {
    let d = 0
    let cur = seg
    while (cur && cur.parent != null && !visited.has(cur.id)) {
      visited.add(cur.id)
      const p = segs.find((s) => s.id === cur.parent)
      if (!p || p === cur) break
      cur = p
      d++
    }
    return d
  }
  return segs.map((seg) => ({ ...seg, depth: depthOf(seg) }))
})

const notes = computed(() => {
  const d = props.structure
  return d && Array.isArray(d.notes) ? d.notes : []
})

// ---------- 术语点击 → 解释小气泡 ----------
const popup = ref(null) // { key, data, x, y, leaf, liveText }
async function openTerm(key, liveText, anchorEl) {
  const rect = anchorEl?.getBoundingClientRect()
  const x = rect ? rect.left : 200
  const y = rect ? rect.bottom + 6 : 200
  try {
    const data = await window.api.grammar.termExplain(key)
    popup.value = {
      key,
      data: data || { label: key, short: '', examples: [] },
      x,
      y,
      leaf: leafForTermKey(key),
      liveText: liveText || ''
    }
  } catch {
    popup.value = { key, data: { label: key, short: '', examples: [] }, x, y, leaf: null, liveText: liveText || '' }
  }
}
const roleList = (seg) => String(seg.role || '').split('+').map((r) => r.trim()).filter(Boolean)

// 功能词(介词/冠词/连词等)点击 → 词类解释(接语法本知识卡片, 可查看教学式详解)
async function openWordPopup(w, segText, anchorEl) {
  const rect = anchorEl?.getBoundingClientRect()
  const x = rect ? rect.left : 200
  const y = rect ? rect.bottom + 6 : 200
  const key = `pos:${w.pos}`
  try {
    const data = await window.api.grammar.termExplain(key)
    popup.value = {
      key,
      data: {
        label: `${w.text} · ${w.pos}`,
        short: w.hint ? `${w.text}: ${w.hint}` : data?.short || '',
        examples: (data?.examples || []).length ? data.examples : (data?.example ? [data.example] : [])
      },
      x,
      y,
      leaf: leafForTermKey(key),
      liveText: segText || ''
    }
  } catch {
    popup.value = {
      key,
      data: { label: `${w.text} · ${w.pos}`, short: w.hint ? `${w.text}: ${w.hint}` : '', examples: [] },
      x,
      y,
      leaf: null,
      liveText: segText || ''
    }
  }
}
</script>

<template>
  <div class="sp-structure">
    <div v-if="sentenceParts.length" class="sp-bar">
      <template v-for="(p, i) in sentenceParts" :key="i">
        <span
          v-if="p.seg"
          class="sp-part sp-term"
          :class="[SEG_COLOR(p.seg.type), { 'sp-hover': p.seg.id === hoverSegId }]"
          v-tip="(p.seg.voice === '被动' ? '被动语态 · ' : '') + '点击查看「' + p.seg.type + '」的解释'"
          @mouseenter="hoverSegId = p.seg.id"
          @mouseleave="hoverSegId = -1"
          @click="openTerm('type:' + p.seg.type, p.seg.text, $event.currentTarget)"
        >
          <template v-for="(w, wi) in renderWordSpans(p.text)" :key="wi">
            <span v-if="w.pos" class="sp-fw" v-tip="'点击查看「' + w.text + '」(' + w.pos + ')'" @click.stop="openWordPopup(w, p.seg.text, $event.currentTarget)">{{ w.text }}</span>
            <template v-else>{{ w.text }}</template>
          </template>
          <sup v-if="p.seg.voice === '被动'" class="sp-passive">被</sup>
        </span>
        <span v-else>{{ p.text }}</span>
      </template>
    </div>
    <div v-if="segTree.length" class="sp-tree">
      <div
        v-for="seg in segTree"
        :key="seg.id"
        class="sp-node"
        :class="[SEG_COLOR(seg.type), { 'sp-hover': seg.id === hoverSegId }]"
        :style="{ paddingLeft: seg.depth * 14 + 'px' }"
        @mouseenter="hoverSegId = seg.id"
        @mouseleave="hoverSegId = -1"
      >
        <span class="sp-type sp-term" :class="SEG_COLOR(seg.type)" v-tip="'点击查看解释'" @click="openTerm('type:' + seg.type, seg.text, $event.currentTarget)">{{ seg.type }}</span>
        <span class="sp-text">
          <template v-for="(w, wi) in renderWordSpans(seg.text)" :key="wi">
            <span v-if="w.pos" class="sp-fw" v-tip="'点击查看「' + w.text + '」(' + w.pos + ')'" @click.stop="openWordPopup(w, seg.text, $event.currentTarget)">{{ w.text }}</span>
            <template v-else>{{ w.text }}</template>
          </template>
        </span>
        <span class="sp-meta">
          <span v-for="(r, i) in roleList(seg)" :key="'r' + i" class="sp-meta-chip sp-term" v-tip="'点击查看解释'" @click="openTerm('role:' + r, seg.text, $event.currentTarget)">{{ r }}<template v-if="i < roleList(seg).length - 1">+</template></span>
          <span v-if="seg.tense && seg.tense !== '-'" class="sp-meta-chip sp-term" v-tip="'点击查看解释'" @click="openTerm('tense:' + seg.tense, seg.text, $event.currentTarget)"> · {{ seg.tense }}</span>
          <span v-if="seg.voice && seg.voice !== '-'" class="sp-meta-chip sp-term" v-tip="'点击查看解释'" @click="openTerm('voice:' + seg.voice, seg.text, $event.currentTarget)"> · {{ seg.voice }}</span>
          <span v-if="seg.mood && seg.mood !== '-'" class="sp-meta-chip sp-term" v-tip="'点击查看解释'" @click="openTerm('mood:' + seg.mood, seg.text, $event.currentTarget)"> · {{ seg.mood }}</span>
        </span>
      </div>
    </div>
    <div v-if="notes.length" class="sp-notes">
      <MarkdownText v-for="(n, i) in notes" :key="i" class="sp-note" :text="'· ' + n" />
    </div>

    <!-- 术语解释小气泡(Teleport 到 body, 不遮挡触发点) -->
    <GrammarTermPopup
      v-if="popup"
      :label="popup.data.label || popup.key"
      :short="popup.data.short || ''"
      :example="(popup.data.examples || [])[0] || null"
      :live-text="popup.liveText"
      :leaf="popup.leaf"
      :x="popup.x"
      :y="popup.y"
      @close="popup = null"
    />
  </div>
</template>

<style scoped>
.sp-structure { display: flex; flex-direction: column; gap: 8px; }
.sp-bar {
  font-size: 14px;
  line-height: 1.9;
  padding: 6px 8px;
  background: var(--ca-surface-subtle);
  border-radius: 8px;
}
.sp-part { border-radius: 3px; padding: 0 1px; transition: background 120ms ease; }
.sp-part.sp-main { background: rgba(98, 124, 255, 0.16); }
.sp-part.sp-attrib { background: rgba(23, 162, 184, 0.16); }
.sp-part.sp-adv { background: rgba(150, 100, 255, 0.14); }
.sp-part.sp-noun { background: rgba(255, 159, 67, 0.16); }
.sp-part.sp-nonfinite { background: rgba(0, 180, 140, 0.14); }
.sp-part.sp-phrase { background: rgba(130, 140, 160, 0.14); }
.sp-part.sp-hover { box-shadow: 0 0 0 1.5px var(--ca-primary); }
/* 被动标记: 块末单个小号橙色上标「被」(每块仅一次) */
.sp-passive {
  color: var(--ca-warning-ink);
  background: var(--ca-warning-soft);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
  padding: 0 3px;
  margin-left: 2px;
  vertical-align: super;
  line-height: 1;
}
/* 功能词(介词/冠词/连词等): 点状下划线提示可点击 */
.sp-fw {
  cursor: help;
  text-decoration: underline dotted;
  text-decoration-color: rgba(98, 124, 255, 0.55);
  text-underline-offset: 2px;
}
.sp-fw:hover { background: rgba(98, 124, 255, 0.12); border-radius: 2px; }

.sp-tree { display: flex; flex-direction: column; gap: 2px; font-variant-numeric: tabular-nums; /* 结构树数字对齐(PLAN 4.7) */ }
.sp-node {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap; /* 元信息过长时折行, 不挤压句子显示 */
  row-gap: 2px;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
  border-radius: 4px;
  padding-top: 2px;
  padding-bottom: 2px;
}
/* 树节点按类型同色底(与原句条色块一致, 浅一档) */
.sp-node.sp-main { background: rgba(98, 124, 255, 0.1); }
.sp-node.sp-attrib { background: rgba(23, 162, 184, 0.1); }
.sp-node.sp-adv { background: rgba(150, 100, 255, 0.1); }
.sp-node.sp-noun { background: rgba(255, 159, 67, 0.1); }
.sp-node.sp-nonfinite { background: rgba(0, 180, 140, 0.1); }
.sp-node.sp-phrase { background: rgba(130, 140, 160, 0.1); }
.sp-node.sp-hover { background: var(--ca-primary-soft); }
.sp-type { font-weight: 700; flex: 0 0 auto; font-size: 12px; padding: 0 5px; border-radius: 4px; }
.sp-type.sp-main { background: rgba(98,124,255,.2); color: #4557c4; }
.sp-type.sp-attrib { background: rgba(23,162,184,.18); color: #0d7d8e; }
.sp-type.sp-adv { background: rgba(150,100,255,.16); color: #7a4fd0; }
.sp-type.sp-noun { background: rgba(255,159,67,.2); color: #b4641a; }
.sp-type.sp-nonfinite { background: rgba(0,180,140,.16); color: #0a7d63; }
.sp-type.sp-phrase { background: rgba(130,140,160,.18); color: #5d6a82; }
.sp-text { color: var(--ca-ink-2); flex: 1; min-width: 0; }
/* 元信息(角色/时态/语态/语气)整体占满一行, 折行显示不挤压句子 */
.sp-meta { color: var(--ca-ink-3); font-size: 12px; flex: 1 0 100%; line-height: 1.6; }
.sp-notes { font-size: 13px; color: var(--ca-ink-3); line-height: 1.7; }
.sp-note { padding: 1px 0; }

/* 术语点击热区: 悬停出现点状下划线提示可点击 */
.sp-term { cursor: help; }
.sp-term:hover { text-decoration: underline dotted; }
.sp-meta-chip { white-space: nowrap; }
</style>
