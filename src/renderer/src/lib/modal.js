// 设计系统一致的 弹窗/确认 组件
// 替换原生 alert/confirm, 风格与 calm-admin-tokens 一致

let container = null

function ensureContainer() {
  if (container && container.isConnected) return container
  container = document.createElement('div')
  container.className = 'modal-root'
  document.body.appendChild(container)
  return container
}

// 注入样式
const style = document.createElement('style')
style.textContent = `
.modal-root {
  position: fixed;
  inset: 0;
  z-index: 10000;
  pointer-events: none;
}
.modal-root .modal-mask {
  position: absolute;
  inset: 0;
  background: rgba(11, 18, 32, 0.45);
  display: grid;
  place-items: center;
  pointer-events: auto;
  animation: modal-fade 0.16s var(--ca-ease);
}
.modal-root .modal-box {
  width: 380px;
  max-width: 90vw;
  background: var(--ca-surface);
  border: 1px solid var(--ca-line);
  border-radius: 12px;
  box-shadow: var(--ca-shadow-float);
  padding: 20px 22px;
  animation: modal-in 0.18s var(--ca-ease);
}
.modal-root .modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--ca-ink);
  margin: 0 0 10px;
}
.modal-root .modal-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--ca-ink-2);
  white-space: pre-line;
  margin-bottom: 18px;
}
.modal-root .modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.modal-root .modal-btn {
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--ca-line);
  border-radius: 8px;
  background: var(--ca-surface);
  color: var(--ca-ink-2);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all var(--ca-duration-fast) var(--ca-ease);
}
.modal-root .modal-btn:hover { background: var(--ca-surface-subtle); }
.modal-root .modal-btn.primary {
  color: #fff;
  background-color: var(--ca-primary);
  background-image: var(--ca-primary-gradient);
  border-color: var(--ca-primary-border);
  box-shadow: var(--ca-shadow-primary);
}
.modal-root .modal-btn.primary:hover { background-image: var(--ca-primary-gradient-hover); }
.modal-root .modal-btn.danger {
  color: var(--ca-critical-ink);
  background: var(--ca-critical-soft);
  border-color: transparent;
}
.modal-root .modal-btn.danger:hover { opacity: 0.85; }
@keyframes modal-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes modal-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .modal-root .modal-mask, .modal-root .modal-box { animation: none; }
}
`
document.head.appendChild(style)

function open({ title, body, buttons, cancelValue }) {
  return new Promise((resolve) => {
    const root = ensureContainer()
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    const box = document.createElement('div')
    box.className = 'modal-box'
    box.innerHTML = `
      <div class="modal-title"></div>
      <div class="modal-body"></div>
      <div class="modal-actions"></div>
    `
    box.querySelector('.modal-title').textContent = title || ''
    box.querySelector('.modal-body').textContent = body || ''

    const actions = box.querySelector('.modal-actions')

    let settled = false
    const settle = (value) => {
      if (settled) return
      settled = true
      window.removeEventListener('keydown', onKey)
      mask.remove()
      resolve(value)
    }

    buttons.forEach((btn) => {
      const el = document.createElement('button')
      el.className = 'modal-btn' + (btn.cls ? ' ' + btn.cls : '')
      el.textContent = btn.label
      el.addEventListener('click', () => settle(btn.value))
      actions.appendChild(el)
    })

    mask.appendChild(box)
    // 遮罩/Esc: 默认取 cancelValue, 未指定时取最后一个按钮的值
    const fallback = cancelValue !== undefined ? cancelValue : buttons[buttons.length - 1]?.value ?? false
    mask.addEventListener('click', (e) => {
      if (e.target === mask) settle(fallback)
    })
    root.appendChild(mask)
    // 焦点到主按钮
    const primary = box.querySelector('.modal-btn.primary') || box.querySelector('.modal-btn')
    primary?.focus()
    // Esc 取消
    const onKey = (e) => {
      if (e.key === 'Escape') settle(fallback)
    }
    window.addEventListener('keydown', onKey)
  })
}

export function alert(title, body = '') {
  return open({
    title,
    body,
    buttons: [{ label: '知道了', value: true, cls: 'primary' }]
  })
}

export function confirm(title, body = '') {
  return open({
    title,
    body,
    buttons: [
      { label: '取消', value: false },
      { label: '确定', value: true, cls: 'primary' }
    ]
  })
}

export function confirmDanger(title, body = '') {
  return open({
    title,
    body,
    buttons: [
      { label: '取消', value: false },
      { label: '删除', value: true, cls: 'danger' }
    ]
  })
}

/** 多选项弹窗: buttons = [{label, value, cls?}]; cancelValue 为遮罩/Esc 的返回值(默认取末位按钮值) */
export function choose(title, body = '', buttons = [], cancelValue) {
  return open({ title, body, buttons, cancelValue })
}
