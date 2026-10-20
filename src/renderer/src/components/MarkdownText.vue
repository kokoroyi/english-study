<script setup>
// Markdown 文本渲染组件(v-html; 内容经 renderMarkdown 转义, 无注入风险)
import { computed } from 'vue'
import { renderMarkdown } from '../lib/markdown.js'

const props = defineProps({
  text: { type: String, default: '' }
})

const html = computed(() => renderMarkdown(props.text))
</script>

<template>
  <div class="md-text" v-html="html"></div>
</template>

<style scoped>
.md-text { min-width: 0; }
.md-text :deep(.md-p) { margin: 0 0 6px; }
.md-text :deep(.md-p:last-child) { margin-bottom: 0; }
.md-text :deep(.md-h) { margin: 4px 0 6px; line-height: 1.5; }
.md-text :deep(.md-h1) { font-size: 15px; }
.md-text :deep(.md-h2) { font-size: 14px; }
.md-text :deep(.md-h3) { font-size: 13px; }
.md-text :deep(.md-h4), .md-text :deep(.md-h5), .md-text :deep(.md-h6) { font-size: 12.5px; }
.md-text :deep(.md-ul), .md-text :deep(.md-ol) { margin: 0 0 6px; padding-left: 20px; }
.md-text :deep(.md-ul:last-child), .md-text :deep(.md-ol:last-child) { margin-bottom: 0; }
.md-text :deep(.md-pre) {
  background: var(--ca-surface-subtle);
  border: 1px solid var(--ca-line);
  border-radius: 6px;
  padding: 8px 10px;
  overflow-x: auto;
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.6;
}
.md-text :deep(.md-code) {
  background: var(--ca-surface-subtle);
  border-radius: 4px;
  padding: 0 4px;
  font-size: 0.92em;
}
.md-text :deep(.md-table-wrap) { overflow-x: auto; margin: 0 0 8px; }
.md-text :deep(.md-table) {
  border-collapse: collapse;
  font-size: 12.5px;
  width: 100%;
  min-width: max-content;
}
.md-text :deep(.md-table th), .md-text :deep(.md-table td) {
  border: 1px solid var(--ca-line);
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}
.md-text :deep(.md-table th) { background: var(--ca-surface-subtle); font-weight: 700; }
.md-text :deep(strong) { font-weight: 700; }
.md-text :deep(em) { font-style: italic; }
</style>
