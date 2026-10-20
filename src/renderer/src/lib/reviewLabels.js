// 复习结果标签与语义(ReadingText 内联判定面板 / ReviewCards 熟词卡片共用, 防多处漂移)
export const REVIEW_RESULT_LABELS = {
  known: '认识',
  fuzzy: '模糊',
  unknown: '不认识',
  skip: '跳过',
  later: '稍后'
}

export function reviewResultLabel(result) {
  return REVIEW_RESULT_LABELS[result] || '未知'
}
