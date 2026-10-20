// 功能词词类标注(渲染层): 基于已知词表的轻量词类识别
// 句子里的功能词(介词/冠词/连词/代词/情态动词/助动词/系动词)可点击查看解释,
// 弥补"片段级"分析看不到具体小词含义的缺口。

const PREPS = new Set(
  'about above across after against along among around at before behind below beneath beside between beyond by down during except for from in inside into like near of off on onto out outside over past since through throughout to toward towards under until up upon with within without'.split(' ')
)
const ARTICLES = new Set(['a', 'an', 'the'])
const CONJS = new Set(
  'and or but so nor yet for because although though while when if unless since as that whether before after until whereas once'.split(' ')
)
const MODALS = new Set('can could may might must shall should will would ought need dare'.split(' '))
const AUX = new Set('am is are was were been being have has had having do does did done doing'.split(' '))
const PRONOUNS = new Set(
  'i you he she it we they me him her us them my your his its our their mine yours hers ours theirs myself yourself himself herself itself ourselves yourselves themselves this that these those who whom whose which what someone somebody anyone anybody everyone everybody no one nobody nothing something anything everything one'.split(' ')
)
const LINKING = new Set('be become seem look feel sound smell taste get turn grow remain stay appear keep prove'.split(' '))

/** 常见功能词的具体含义提示(弹窗优先显示) */
export const WORD_HINTS = {
  by: '① 被、由(被动句引出施动者) ② 通过、靠(方式) ③ 在…旁边 ④ 到…为止',
  with: '① 和…一起 ② 用、以(工具/方式) ③ 带着、具有',
  for: '① 为了(目的) ② 给、供 ③ 持续…时间 ④ 因为',
  of: '① …的(所属) ② 表示数量/部分 ③ 关于',
  to: '① 到、向(方向) ② 给(对象) ③ 不定式标志(to do)',
  in: '① 在…里面 ② 在(时间段/年/月/季节) ③ 用(语言/方式)',
  on: '① 在…上面(接触表面) ② 在(某天/星期) ③ 关于',
  at: '① 在(具体地点/时刻) ② 朝、向 ③ 以(速度/价格)',
  from: '① 从、来自 ② 由于 ③ 与…不同',
  into: '进入…里面(动态)',
  over: '① 在…上方(不接触) ② 越过 ③ 超过、多于',
  under: '① 在…下面 ② 少于 ③ 在…条件下',
  after: '在…之后(时间/顺序)',
  before: '在…之前',
  during: '在…期间',
  through: '① 穿过、通过 ② 由于、凭借',
  about: '① 关于 ② 大约 ③ 在…周围',
  across: '① 横过、穿过 ② 在…对面',
  against: '① 反对 ② 靠着 ③ 以…为背景',
  between: '在…之间(两者)',
  among: '在…之中(三者及以上)',
  around: '① 在…周围 ② 大约',
  without: '没有、不(带)',
  within: '在…之内',
  beside: '在…旁边',
  behind: '在…后面',
  beyond: '超出、在…之外',
  since: '① 自从(时间) ② 既然、因为',
  until: '直到…为止',
  like: '像、如同',
  near: '在…附近',
  as: '① 作为 ② 像…一样 ③ 当…时 ④ 因为',
  and: '和、并且(并列连接)',
  or: '或者; 否则',
  but: '但是(转折)',
  because: '因为(引导原因)',
  if: '① 如果(条件) ② 是否(宾语从句)',
  when: '当…时',
  while: '① 当…时 ② 然而(对比)',
  although: '虽然、尽管(不与 but 连用)',
  though: '虽然、尽管; 不过(句末)',
  that: '① 那个 ② 引导从句(宾语/定语/同位语) ③ 如此…以至于',
  who: '谁; 引导定语从句(指人)',
  which: '哪一个; 引导定语从句(指物)',
  whose: '谁的; 引导定语从句(表所属)',
  the: '定冠词: 特指"那个/那些"(上文提过、双方皆知、独一无二的事物)',
  a: '不定冠词: 泛指"一个"(首次提到、职业、单数可数名词前)',
  an: '不定冠词: 同 a, 用于元音音素开头的词前(an apple)',
  can: '能、可以(能力/许可)',
  could: '能(过去式); 可以(更委婉); 可能',
  may: '可能; 可以(许可)',
  might: '可能(比 may 更不确定)',
  must: '必须; 一定(推测)',
  should: '应该(建议/义务)',
  will: '将会; 愿意',
  would: '将会(过去/委婉); 愿意; 过去习惯',
  be: '系动词"是"; 也作助动词构成进行时/被动',
  have: '有; 助动词构成完成时(have done)',
  do: '做; 助动词构成否定/疑问',
  seem: '似乎、好像(系动词)',
  become: '变得、成为(系动词)',
  get: '得到; 变得(系动词); 到达',
  it: '它; 也作形式主语/宾语(It is... that...)'
}

/** 识别单词的词类; 返回 { pos, hint } 或 null */
export function classifyWord(raw) {
  const w = String(raw || '').toLowerCase().replace(/[^a-z'-]/g, '')
  if (!w) return null
  if (MODALS.has(w)) return { pos: '情态动词', hint: WORD_HINTS[w] || '' }
  if (LINKING.has(w)) return { pos: '系动词', hint: WORD_HINTS[w] || '' }
  if (AUX.has(w)) return { pos: '助动词', hint: WORD_HINTS[w] || '' }
  if (ARTICLES.has(w)) return { pos: '冠词', hint: WORD_HINTS[w] || '' }
  if (PREPS.has(w)) return { pos: '介词', hint: WORD_HINTS[w] || '' }
  if (CONJS.has(w)) return { pos: '连词', hint: WORD_HINTS[w] || '' }
  if (PRONOUNS.has(w)) return { pos: '代词', hint: WORD_HINTS[w] || '' }
  return null
}

/**
 * 把片段文本拆成可渲染的单元: 功能词带词类信息(可点击), 其余保持纯文本。
 * 返回 [{ text, pos, hint }]
 */
export function renderWordSpans(text) {
  const src = String(text || '')
  const out = []
  const re = /[A-Za-z0-9'’-]+|[^A-Za-z0-9'’]+/g
  let m
  while ((m = re.exec(src)) !== null) {
    const info = classifyWord(m[0])
    out.push(info ? { text: m[0], pos: info.pos, hint: info.hint } : { text: m[0], pos: null, hint: '' })
  }
  return out
}
