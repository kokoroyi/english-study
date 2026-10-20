// ADHD 阅读模式的统一口径(渲染层共用)
// 单一 mode 是唯一真相: 'semantic' 语义增强 | 'bionic' 仿生阅读 | 'off' 普通阅读
// 旧数据只有 semanticEnabled/bionicEnabled 两个布尔, 这里负责归一化; 保存时同步回两个布尔字段以兼容旧代码/旧库。
export const ADHD_MODE_ORDER = ['semantic', 'bionic', 'off']
export const ADHD_MODE_LABEL = { semantic: '语义', bionic: 'Bionic', off: '普通' }
export const ADHD_MODE_DESC = {
  semantic: '智能识别关键词并加粗高亮',
  bionic: '词首加粗 + 尾部淡化, 引导视线',
  off: '普通阅读(无增强)'
}

export function isValidAdhdMode(mode) {
  return ADHD_MODE_ORDER.includes(mode)
}

/** 由 appearance.adhd(旧布尔或新 mode)得到三态之一 */
export function normalizeAdhdMode(adhd = {}) {
  if (isValidAdhdMode(adhd.mode)) return adhd.mode
  if (adhd.semanticEnabled) return 'semantic'
  if (adhd.bionicEnabled) return 'bionic'
  return 'off'
}

export function getAdhdMode(appearance) {
  return normalizeAdhdMode(appearance?.adhd || {})
}

/** 返回写入了 mode 并同步旧布尔字段的新 adhd 对象(不修改入参) */
export function withAdhdMode(adhd, mode) {
  const m = isValidAdhdMode(mode) ? mode : 'off'
  return { ...(adhd || {}), mode: m, semanticEnabled: m === 'semantic', bionicEnabled: m === 'bionic' }
}

/** 三态循环: 语义 → Bionic → 普通 → 语义 */
export function nextAdhdMode(mode) {
  const current = isValidAdhdMode(mode) ? mode : normalizeAdhdMode({ mode })
  const i = ADHD_MODE_ORDER.indexOf(current)
  return ADHD_MODE_ORDER[(i + 1) % ADHD_MODE_ORDER.length]
}
