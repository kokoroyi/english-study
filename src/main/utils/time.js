export function nowIso() {
  return new Date().toISOString()
}

/** 本地日期字符串 YYYY-MM-DD(用于"今天到期"等用户感知的日期判断) */
export function todayStr() {
  return localDateKey(new Date())
}

/** 任意时间点的本地日期 YYYY-MM-DD */
export function localDateKey(date) {
  const d = date instanceof Date ? date : new Date(date)
  if (isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 本地今日 00:00:00.000 的 ISO(UTC) 表示 */
export function localDayStartIso(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** 本地今日 23:59:59.999 的 ISO(UTC) 表示 */
export function localDayEndIso(offsetDays = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(23, 59, 59, 999)
  return d.toISOString()
}

export function addDays(date, days) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

export function addDaysFromNow(days) {
  return addDays(new Date(), days)
}
