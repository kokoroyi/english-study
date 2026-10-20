<script setup>
// 术语解释小气泡: 定点弹出、视口钳制、不遮挡触发点; 点外/Esc/✕ 关闭; 可跳语法本
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import MarkdownText from './MarkdownText.vue'

const props = defineProps({
  label: { type: String, default: '' },
  short: { type: String, default: '' },
  example: { type: Object, default: null }, // {en, zh}
  liveText: { type: String, default: '' },
  leaf: { type: Object, default: null }, // {category, sub, detail} | null
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 }
})
const emit = defineEmits(['close'])
const router = useRouter()

const POPUP_W = 330
const POPUP_MAX_H = 240
const pos = computed(() => {
  const maxX = Math.max(8, window.innerWidth - POPUP_W - 8)
  const maxY = Math.max(8, window.innerHeight - POPUP_MAX_H - 8)
  return {
    left: `${Math.max(8, Math.min(props.x, maxX))}px`,
    top: `${Math.max(8, Math.min(props.y, maxY))}px`
  }
})

function close() {
  emit('close')
}
function gotoLeaf() {
  if (!props.leaf) return
  router.push({ path: '/grammar', query: { cat: props.leaf.category, sub: props.leaf.sub, detail: props.leaf.detail || '' } })
  close()
}
function onDocDown(e) {
  if (!e.target.closest('.term-popup')) close()
}
function onKey(e) {
  if (e.key === 'Escape') close()
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, true)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <Teleport to="body">
    <div class="term-popup" :style="pos">
      <div class="tp-head">
        <span class="tp-title">{{ label }}</span>
        <button class="tp-close" @click="close" v-tip="'关闭'">✕</button>
      </div>
      <div class="tp-body">
        <div v-if="short" class="tp-short"><MarkdownText :text="short" /></div>
        <div v-else class="tp-short muted">暂无内置解释, 可在语法本对应分类下补充</div>
        <div v-if="liveText" class="tp-live">在这句里: <span class="tp-live-text">{{ liveText }}</span></div>
        <div v-if="example" class="tp-example">
          <div class="tp-ex-en">{{ example.en }}</div>
          <div class="tp-ex-zh">{{ example.zh }}</div>
        </div>
      </div>
      <div v-if="leaf" class="tp-foot">
        <button class="tp-goto" @click="gotoLeaf">在语法本查看详细教学 ↗</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.term-popup {
  position: fixed;
  z-index: 3000;
  width: 330px;
  max-height: 240px;
  display: flex;
  flex-direction: column;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 12px;
  box-shadow: var(--ca-shadow-float);
  overflow: hidden;
}
.tp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--ca-line);
  background: var(--ca-primary-soft);
}
.tp-title { font-size: 13px; font-weight: 700; color: var(--ca-primary); }
.tp-close {
  width: 20px; height: 20px;
  border: none; border-radius: 5px;
  background: transparent; color: var(--ca-ink-3);
  cursor: pointer; font-size: 12px; line-height: 1;
}
.tp-close:hover { background: var(--ca-surface-subtle); color: var(--ca-ink); }
.tp-body { flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; }
.tp-short { font-size: 12.5px; line-height: 1.7; color: var(--ca-ink-2); white-space: pre-wrap; }
.tp-short.muted { color: var(--ca-ink-3); }
.tp-live { font-size: 12px; color: var(--ca-ink-3); }
.tp-live-text { color: var(--ca-ink-2); font-style: italic; }
.tp-example { padding: 7px 9px; border-left: 2px solid var(--ca-primary-border); background: var(--ca-surface-subtle); border-radius: 0 6px 6px 0; }
.tp-ex-en { font-size: 12.5px; color: var(--ca-ink); font-style: italic; }
.tp-ex-zh { font-size: 12px; color: var(--ca-ink-3); margin-top: 2px; }
.tp-foot { padding: 8px 12px; border-top: 1px solid var(--ca-line); }
.tp-goto {
  border: none; background: transparent; padding: 0;
  font-size: 12px; font-weight: 600; color: var(--ca-primary);
  cursor: pointer;
}
.tp-goto:hover { text-decoration: underline; }
</style>
