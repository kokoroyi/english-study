// 轻量 toast 提示
const container = document.createElement('div')
container.className = 'toast-container'
document.addEventListener('DOMContentLoaded', () => document.body.appendChild(container))

let counter = 0

export function toast(message, type = 'success', duration = 2500) {
  if (!container.isConnected) document.body.appendChild(container)
  const id = ++counter
  const el = document.createElement('div')
  el.className = `toast-item toast-${type}`
  el.textContent = message
  el.style.animationDelay = `${id * 0}ms`
  container.appendChild(el)
  setTimeout(() => {
    el.classList.add('toast-leave')
    setTimeout(() => el.remove(), 200)
  }, duration)
}

// 注入全局样式
const style = document.createElement('style')
style.textContent = `
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: none;
}
.toast-item {
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  box-shadow: 0 8px 24px rgb(16 24 40 / 20%);
  animation: toast-in 0.2s cubic-bezier(0.2, 0, 0, 1);
  transition: opacity 0.2s, transform 0.2s;
  max-width: 80vw;
  word-break: break-word;
}
.toast-success { background: var(--ca-success); }
.toast-error { background: var(--ca-critical); }
.toast-info { background: var(--ca-info); }
.toast-leave { opacity: 0; transform: translateY(8px); }
@keyframes toast-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
`
document.head.appendChild(style)
