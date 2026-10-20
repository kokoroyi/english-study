// IPC 传参安全序列化
// Vue reactive 代理对象不能被 Electron structured clone,
// 所有跨 IPC 传参前必须转为纯对象。

/** 深拷贝为纯 JSON 对象(丢弃 Proxy 包装) */
export function plain(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj.toISOString()
  // 数组
  if (Array.isArray(obj)) return obj.map(plain)
  // 普通对象: 遍历自有可枚举键
  const out = {}
  for (const key of Object.keys(obj)) {
    out[key] = plain(obj[key])
  }
  return out
}

/** 从 Vue 响应式对象安全取值并转纯对象。
 *  语义澄清: 本函数不读取任何 store, 只是把(响应式)对象拍平为纯对象(plain 的别名), 供 IPC 传参。 */
export function fromStore(reactiveObj) {
  return plain(reactiveObj)
}
