// 语法术语内置词典
// - LEAF_TERMS: 语法本知识卡片(详细教学式解释 + 2 个典型易懂例句), key = leaf:分类:子类:细分
// - TERM_EXPLAIN: AI 工作区弹窗(简短直白解释 + 1 个例句), key = type:/tense:/voice:/mood:/role: + 术语
// 用户可在语法本编辑覆盖(存 grammar_terms 表), 恢复默认即回到这里

export const LEAF_TERMS = {
  // ---------- 时态 ----------
  'leaf:时态:一般现在时:': {
    full: `表示经常性、习惯性的动作, 客观事实或普遍真理, 也用于时间表/安排。
结构: 主语 + 动词原形(第三人称单数加 -s/-es); 否定和疑问借助 do/does。
要点: 常与 always, usually, often, every day 等频度副词连用; 真理和自然规律永远用它。`,
    examples: [
      { en: 'The sun rises in the east.', zh: '太阳从东方升起。' },
      { en: 'She often drinks coffee in the morning.', zh: '她经常在早上喝咖啡。' }
    ]
  },
  'leaf:时态:一般过去时:': {
    full: `表示过去某一时间发生的动作或存在的状态, 与现在没有直接联系。
结构: 主语 + 动词过去式; 否定和疑问借助 did + 动词原形。
要点: 常与 yesterday, last week, two days ago, in 2010 等过去时间连用。`,
    examples: [
      { en: 'I visited London last year.', zh: '我去年游览了伦敦。' },
      { en: 'They did not watch the movie.', zh: '他们没有看那部电影。' }
    ]
  },
  'leaf:时态:一般将来时:': {
    full: `表示将来要发生的动作或打算、预测。
结构: will + 动词原形; 或 be going to + 动词原形(强调打算或有迹象)。
要点: will 多表临时决定/预测, be going to 多表预先计划。`,
    examples: [
      { en: 'We will travel next month.', zh: '我们下个月要去旅行。' },
      { en: 'Look at the clouds. It is going to rain.', zh: '看那些云, 要下雨了。' }
    ]
  },
  'leaf:时态:现在进行时:': {
    full: `表示此刻正在进行的动作, 或近期暂时性的安排。
结构: am/is/are + 动词-ing。
要点: 常与 now, at the moment, Look!, Listen! 连用; 少数动词(如 know, want)不用进行时。`,
    examples: [
      { en: 'She is reading a novel now.', zh: '她现在正在读一本小说。' },
      { en: 'Look! It is snowing.', zh: '看! 下雪了。' }
    ]
  },
  'leaf:时态:过去进行时:': {
    full: `表示过去某一时刻正在进行的动作, 常用来描写背景或被打断的动作。
结构: was/were + 动词-ing。
要点: 常与 at 5 p.m. yesterday 连用, 或与 when 引导的过去事件搭配(进行中的动作被打断)。`,
    examples: [
      { en: 'I was cooking when he called.', zh: '他打电话来时我正在做饭。' },
      { en: 'They were playing football at 5 p.m.', zh: '下午五点他们正在踢足球。' }
    ]
  },
  'leaf:时态:现在完成时:': {
    full: `表示过去发生但对现在有影响的动作, 或从过去持续到现在的状态。
结构: have/has + 过去分词。
要点: 常与 already, just, yet, ever, never, since, for 连用; 强调"结果/经历/持续", 不与明确的过去时间(如 yesterday)连用。`,
    examples: [
      { en: 'I have finished my homework.', zh: '我已经写完作业了。' },
      { en: 'She has lived here for ten years.', zh: '她在这里住了十年了。' }
    ]
  },
  'leaf:时态:过去完成时:': {
    full: `表示"过去的过去": 在另一个过去动作之前就已经完成的动作。
结构: had + 过去分词。
要点: 常与 before, by the time, when 引导的过去事件搭配; 强调先后顺序。`,
    examples: [
      { en: 'The train had left before we arrived.', zh: '我们到达之前火车已经开走了。' },
      { en: 'He had never seen the sea before that day.', zh: '在那天之前他从未见过大海。' }
    ]
  },
  'leaf:时态:现在完成进行时:': {
    full: `表示从过去一直持续到现在、并且可能继续下去的动作, 强调"一直在进行"。
结构: have/has been + 动词-ing。
要点: 常与 for/since 连用; 与现在完成时相比更突出动作的延续性和未完成感。`,
    examples: [
      { en: 'I have been waiting for an hour.', zh: '我已经等了一个小时了(还在等)。' },
      { en: 'It has been raining all day.', zh: '雨下了一整天了。' }
    ]
  },
  'leaf:时态:过去完成进行时:': {
    full: `表示到过去某一时刻为止一直持续进行的动作。
结构: had been + 动词-ing。
要点: 强调动作在过去时间点之前"一直在做", 常解释某个过去结果的成因。`,
    examples: [
      { en: 'She had been studying for hours before the exam.', zh: '考试前她已经连续学习了好几个小时。' },
      { en: 'They were tired because they had been running.', zh: '他们很累, 因为之前一直在跑步。' }
    ]
  },
  'leaf:时态:将来进行时:': {
    full: `表示将来某一时刻正在进行的动作, 或按计划自然会发生的事。
结构: will be + 动词-ing。
要点: 常与 at this time tomorrow 等将来时刻连用; 语气比一般将来时更具体、更生动。`,
    examples: [
      { en: 'This time tomorrow I will be flying to Paris.', zh: '明天这个时候我正飞往巴黎。' },
      { en: 'Do not call at 8; I will be having dinner.', zh: '八点别打电话, 那时我正在吃晚饭。' }
    ]
  },
  'leaf:时态:将来完成时:': {
    full: `表示到将来某一时刻为止已经完成的动作。
结构: will have + 过去分词。
要点: 常与 by + 将来时间 连用, 强调"到那时已经完成"。`,
    examples: [
      { en: 'By next June I will have graduated.', zh: '到明年六月我就毕业了。' },
      { en: 'She will have finished the report by Friday.', zh: '到周五她就能写完报告。' }
    ]
  },

  // ---------- 语态 ----------
  'leaf:语态:主动:': {
    full: `主语是动作的执行者, 句子直接说明"谁做了什么"。
结构: 主语 + 谓语 + 宾语。
要点: 强调执行者、表达自然直接; 英语日常表达以主动语态为主。`,
    examples: [
      { en: 'The dog bit the man.', zh: '狗咬了那个人。' },
      { en: 'She wrote a letter.', zh: '她写了一封信。' }
    ]
  },
  'leaf:语态:被动:': {
    full: `主语是动作的承受者, 强调"被怎样了"; 不知道执行者、不想提执行者或执行者不重要时使用。
结构: be + 过去分词; 时态体现在 be 上(如 was built, is being done, has been finished)。
要点: 如需指出执行者用 by; 不及物动词没有被动语态。`,
    examples: [
      { en: 'The bridge was built in 1990.', zh: '这座桥建于 1990 年。' },
      { en: 'The window was broken by the storm.', zh: '窗户被暴风雨打破了。' }
    ]
  },

  // ---------- 从句 ----------
  'leaf:从句:定语从句:': {
    full: `修饰名词或代词的从句, 作用相当于形容词, 紧跟它所修饰的词(先行词)。
引导词: who(人/主格), whom(人/宾格), whose(所属), which(物), that(人/物均可)。
要点: 引导词在从句中充当成分; 关系代词作宾语时常可省略。`,
    examples: [
      { en: 'The book that you lent me is wonderful.', zh: '你借给我的那本书棒极了。' },
      { en: 'I know the girl who won the prize.', zh: '我认识那个获奖的女孩。' }
    ]
  },
  'leaf:从句:宾语从句:': {
    full: `在句中充当动词或介词宾语的从句。
引导词: that(可省略), whether/if(是否), wh-词(特殊疑问)。
要点: 从句必须用陈述语序(主语在前); 主句过去时, 从句一般也要相应后移时态。`,
    examples: [
      { en: 'I think that he is honest.', zh: '我认为他是诚实的。' },
      { en: 'She asked where I lived.', zh: '她问我住在哪里。' }
    ]
  },
  'leaf:从句:主语从句:': {
    full: `在句中充当主语的从句。
引导词: that, whether, wh-词。
要点: 常用 it 作形式主语, 把真正的主语从句放到句尾(It is clear that...); 从句作主语时谓语用单数。`,
    examples: [
      { en: 'That he won the game surprised everyone.', zh: '他赢了比赛让所有人惊讶。' },
      { en: 'It is clear that she is right.', zh: '显然她是对的。' }
    ]
  },
  'leaf:从句:表语从句:': {
    full: `位于系动词(be, seem, look 等)之后、充当表语的从句。
引导词: that(不可省略), whether, wh-词。
要点: 说明主语"是什么/怎么样", 常见句型 The problem is that... / This is why...。`,
    examples: [
      { en: 'The problem is that we lack time.', zh: '问题是我们缺少时间。' },
      { en: 'This is why I came.', zh: '这就是我来的原因。' }
    ]
  },
  'leaf:从句:同位语从句:': {
    full: `跟在抽象名词(如 fact, idea, news, hope, question)之后、解释其具体内容的从句。
引导词: that(在从句中不充当任何成分, 不可省略), 少数用 whether/wh-词。
要点: 与定语从句的区别——同位语从句解释"内容", 定语从句修饰"那个"。`,
    examples: [
      { en: 'The news that our team won excited us.', zh: '我们队获胜的消息让我们激动。' },
      { en: 'I had no idea that you were here.', zh: '我不知道你在这里。' }
    ]
  },
  'leaf:从句:状语从句:时间': {
    full: `表示主句动作发生时间的从句。
引导词: when, while, as, before, after, until, since, as soon as。
要点: 时间状语从句中用一般现在时表将来(主将从现)。`,
    examples: [
      { en: 'Call me when you arrive.', zh: '你到了就给我打电话。' },
      { en: 'I will wait until you come back.', zh: '我会一直等到你回来。' }
    ]
  },
  'leaf:从句:状语从句:原因': {
    full: `表示主句动作原因的从句。
引导词: because(语气最强), since(既然), as(由于)。
要点: because 回答 why 提问, 不与 so 连用。`,
    examples: [
      { en: 'He stayed home because it rained.', zh: '因为下雨他待在了家里。' },
      { en: 'Since you are tired, take a rest.', zh: '既然你累了, 就休息一下吧。' }
    ]
  },
  'leaf:从句:状语从句:条件': {
    full: `表示主句动作发生条件的从句。
引导词: if(如果), unless(除非), as long as(只要)。
要点: 条件从句中用一般现在时表将来(主将从现); unless = if...not。`,
    examples: [
      { en: 'If it rains, we will stay inside.', zh: '如果下雨, 我们就待在屋里。' },
      { en: 'You will fail unless you work hard.', zh: '除非你努力, 否则会失败。' }
    ]
  },
  'leaf:从句:状语从句:让步': {
    full: `表示"虽然/尽管"的从句, 与主句构成转折关系。
引导词: though, although, even though, while。
要点: 不与 but 连用(although...but 是错句); 语气由弱到强: though < although < even though。`,
    examples: [
      { en: 'Although he was tired, he kept working.', zh: '虽然累了, 他仍继续工作。' },
      { en: 'Even though it is hard, I will not give up.', zh: '即使很难, 我也不会放弃。' }
    ]
  },
  'leaf:从句:状语从句:目的': {
    full: `表示主句动作目的的从句。
引导词: so that, in order that(常与情态动词 can/may/will 连用)。
要点: 从句常含情态动词; 不定式 to do / in order to do 是更简练的同义表达。`,
    examples: [
      { en: 'Speak louder so that everyone can hear you.', zh: '说大声点, 好让每个人都能听见。' },
      { en: 'He saved money in order that he could travel.', zh: '他攒钱是为了能去旅行。' }
    ]
  },
  'leaf:从句:状语从句:结果': {
    full: `表示主句动作所导致结果的从句。
引导词: so...that(如此…以至于), such...that。
要点: so + 形容词/副词, such + 名词; 口语中 that 可省略。`,
    examples: [
      { en: 'The box was so heavy that I could not lift it.', zh: '箱子太重了, 我搬不动。' },
      { en: 'She spoke so fast that I missed the point.', zh: '她说得太快, 我没听懂要点。' }
    ]
  },
  'leaf:从句:状语从句:方式': {
    full: `表示主句动作进行方式的从句。
引导词: as(按照), as if / as though(好像)。
要点: as if 后若与事实相反, 常用虚拟语气(一般过去时/过去完成时)。`,
    examples: [
      { en: 'Do as I told you.', zh: '按我告诉你的做。' },
      { en: 'He talks as if he knew everything.', zh: '他说起话来好像什么都知道。' }
    ]
  },

  // ---------- 非谓语 ----------
  'leaf:非谓语:不定式:': {
    full: `to + 动词原形。不能单独作谓语, 但可作主语、宾语、定语、状语、补语。
要点: 常表"目的"或"将要发生的动作"; 固定搭配 want to do, decide to do, hope to do 等。
注意: 部分动词后接不带 to 的不定式(make/let/have sb. do)。`,
    examples: [
      { en: 'I want to learn English.', zh: '我想学英语。' },
      { en: 'She came here to help us.', zh: '她来这里是为了帮助我们。' }
    ]
  },
  'leaf:非谓语:动名词:': {
    full: `动词-ing 形式作名词用, 可作主语、宾语、表语、定语。
要点: 表示一般性、习惯性的动作; 常见搭配 enjoy doing, finish doing, be good at doing。
区别: 动名词重"事", 不定式重"要做的事/目的"。`,
    examples: [
      { en: 'Swimming is good exercise.', zh: '游泳是很好的锻炼。' },
      { en: 'I enjoy reading before bed.', zh: '我喜欢睡前阅读。' }
    ]
  },
  'leaf:非谓语:分词:': {
    full: `分两种:
现在分词(-ing): 表主动、进行。作定语、状语、补语, 如 a sleeping baby(正在睡觉的婴儿)。
过去分词(-ed): 表被动、完成。作定语、状语、补语, 如 a broken window(被打碎的窗户)。
要点: 分词的逻辑主语通常就是句子的主语; 作状语时常可换成对应的时间/原因/条件从句。`,
    examples: [
      { en: 'The sleeping baby is cute.', zh: '那个睡着的婴儿很可爱。(现在分词, 主动/进行)' },
      { en: 'The broken window needs fixing.', zh: '那扇破窗户需要修。(过去分词, 被动/完成)' }
    ]
  },

  // ---------- 虚拟语气 ----------
  'leaf:虚拟语气:虚拟语气:': {
    full: `表示与事实相反、愿望、建议或不太可能实现的假设。
常见结构:
1. 与现在/将来相反: If I were you, I would...
2. 与过去相反: If I had known, I would have...
3. 愿望: wish + 过去时(与现在相反) / 过去完成时(与过去相反)
4. 建议/要求类动词后的宾语从句: (should) + 动词原形, 如 suggest that he (should) rest。
要点: 与现在相反的 if 从句中, be 动词一律用 were。`,
    examples: [
      { en: 'If I were you, I would apologize.', zh: '如果我是你, 我会道歉。' },
      { en: 'The doctor suggested that he (should) rest.', zh: '医生建议他休息。' }
    ]
  },

  // ---------- 句子成分 ----------
  'leaf:句子成分:主语:': {
    full: `句子的主题, 通常位于句首, 是谓语动词所述动作的执行者或状态的主体。
可由名词、代词、动名词、不定式或从句充当。
要点: 找主语就问"谁/什么做了这个动作?"`,
    examples: [
      { en: 'The dog barked loudly.', zh: '狗大声叫。(主语 The dog)' },
      { en: 'Swimming keeps me fit.', zh: '游泳让我保持健康。(主语 Swimming)' }
    ]
  },
  'leaf:句子成分:谓语:': {
    full: `说明主语"做什么"或"是什么"的部分, 核心是动词(含时态、语态、情态)。
要点: 一个简单句只有一个谓语核心; 找谓语就看哪个动词带时态变化。
注意: 非谓语(不定式/分词/动名词)不是谓语。`,
    examples: [
      { en: 'She sings beautifully.', zh: '她唱得很动听。(谓语 sings)' },
      { en: 'The letter was written yesterday.', zh: '信是昨天写的。(谓语 was written)' }
    ]
  },
  'leaf:句子成分:宾语:': {
    full: `动作的承受者或对象, 位于及物动词或介词之后。
可由名词、代词、动名词、不定式或从句充当。
要点: 找宾语就问"动作作用于谁/什么?"; 不及物动词后不接宾语。`,
    examples: [
      { en: 'I read a book.', zh: '我读了一本书。(宾语 a book)' },
      { en: 'She is good at math.', zh: '她擅长数学。(介词宾语 math)' }
    ]
  },
  'leaf:句子成分:表语:': {
    full: `位于系动词(be, become, seem, look, feel 等)之后, 说明主语的身份、状态、特征。
可由名词、形容词、介词短语、不定式或从句充当。
要点: 系动词 + 表语合起来构成谓语部分, 表语不是宾语。`,
    examples: [
      { en: 'She is a teacher.', zh: '她是一名教师。(表语 a teacher)' },
      { en: 'He looks tired.', zh: '他看起来累了。(表语 tired)' }
    ]
  },
  'leaf:句子成分:补语:': {
    full: `补充说明宾语或主语的身份、状态或结果。
宾补: make/keep/find + 宾语 + 补语, 如 make him happy。
主补: 被动句中补充主语, 如 He was made captain。
要点: 宾补去掉后句意不完整; 常见于 make, call, elect, paint, keep 等动词。`,
    examples: [
      { en: 'They elected him president.', zh: '他们选他当主席。(宾补 president)' },
      { en: 'The door was painted white.', zh: '门被漆成了白色。(主补 white)' }
    ]
  },
  'leaf:句子成分:定语:': {
    full: `修饰名词或代词、说明"哪个/什么样的"的成分。
可由形容词、名词、介词短语、分词、定语从句充当。
要点: 单个词常前置(the red car), 短语和从句常后置(the girl in red / the book that I read)。`,
    examples: [
      { en: 'The red car is mine.', zh: '那辆红色的车是我的。(定语 red)' },
      { en: 'The girl in red is my sister.', zh: '穿红衣服的女孩是我妹妹。(定语 in red)' }
    ]
  },
  'leaf:句子成分:状语:': {
    full: `修饰动词、形容词或整个句子, 表示时间、地点、方式、原因、目的、程度等。
可由副词、介词短语、状语从句、不定式等充当。
要点: 位置灵活, 可句首/句中/句尾; 删除状语不影响句子语法完整。`,
    examples: [
      { en: 'He left early.', zh: '他很早就离开了。(状语 early)' },
      { en: 'We met at the station.', zh: '我们在车站见面。(状语 at the station)' }
    ]
  },
  'leaf:句子成分:同位语:': {
    full: `紧跟在名词或代词之后, 进一步说明其身份或具体内容的成分。
常由名词或同位语从句充当。
要点: 同位语与被说明的词指同一对象, 去掉后句意变模糊但句子仍完整。`,
    examples: [
      { en: 'My friend Tom is here.', zh: '我的朋友汤姆来了。(同位语 Tom)' },
      { en: 'Beijing, the capital of China, is huge.', zh: '北京, 中国的首都, 很大。(同位语 the capital of China)' }
    ]
  },

  // ---------- 词类(功能词速查, 工作区点击功能词气泡的深链目标) ----------
  'leaf:词类:介词:': {
    short: '介词表示名词与其它词的关系(时间/地点/方式), 后接名词/代词, 如 in, on, at, by, with。',
    full: `介词用来表示名词与句中其它词的关系, 后面接名词、代词或动名词, 构成"介词短语"。
常见介词及核心含义:
- 时间: at(时刻), on(某天), in(月/年/季节), since(自从), for(持续), during(期间), until(直到)
- 地点: at(点), in(里面), on(表面), under(下面), over(上方), between(两者之间), among(三者以上)
- 方式/工具: by(靠/通过), with(用), in(用某种语言)
- 其它: of(…的), for(为了/给), to(向/给), from(来自), about(关于)
要点: 同一个介词常有多重含义, 要结合语境判断; 中文习惯加介词而英文不加时(如 go home 不加 to)要特别留意。`,
    examples: [
      { en: 'He reads in the morning.', zh: '他早上读书。(in 表时间)' },
      { en: 'The book is on the table.', zh: '书在桌上。(on 表位置)' }
    ]
  },
  'leaf:词类:冠词:': {
    short: 'a/an 泛指"一个"; the 特指"那个/那些"。',
    full: `放在名词前的限定词, 区分"泛指"与"特指"。
a/an: 泛指"一个", 用于首次提到、职业身份、单数可数名词前; 元音音素开头的词前用 an(an apple, an hour)。
the: 特指, 用于上文提过、双方都知道、独一无二的事物(the sun)、序数词和最高级前、乐器前。
零冠词: 不可数名词表泛指、三餐、球类运动、语言名称前不加冠词。
要点: 中文没有冠词, 练习时牢记"泛指用 a/an, 特指用 the"。`,
    examples: [
      { en: 'I saw a cat. The cat was black.', zh: '我看见一只猫。那只猫是黑色的。' },
      { en: 'The sun rises in the east.', zh: '太阳从东方升起。(独一无二用 the)' }
    ]
  },
  'leaf:词类:连词:': {
    short: '连接词、短语或句子: and, or, but, because, if, when 等。',
    full: `连接词、短语或句子的词。
并列连词: and(和), or(或者/否则), but(但是), so(所以), nor(也不)。
从属连词: because(因为), if(如果/是否), when(当…时), although(虽然), while(当…时/然而), that(引导从句)。
要点: 从属连词引导从句, 条件/时间从句用"主将从现"; although 不与 but 连用, because 不与 so 连用。`,
    examples: [
      { en: 'I like tea and coffee.', zh: '我喜欢茶和咖啡。' },
      { en: 'Although it rained, we went out.', zh: '虽然下雨了, 我们还是出门了。' }
    ]
  },
  'leaf:词类:代词:': {
    short: '代替名词的词: I/you/he、my/your、this/that、who/which 等。',
    full: `代替名词、避免重复的词。
人称代词: 主格 I/you/he/she/it/we/they; 宾格 me/you/him/her/it/us/them。
物主代词: my/your/his/her/its/our/their 后接名词; mine/yours/his/hers/ours/theirs 单独使用。
指示代词: this/these(近指), that/those(远指)。
不定代词: someone, anyone, everyone, nothing, something 等。
疑问/关系代词: who, whom, whose, which, what。
要点: 代词有格的变化, 作主语用主格, 作宾语用宾格; it 还常作形式主语/宾语(It is important to...)。`,
    examples: [
      { en: 'She is my friend.', zh: '她是我的朋友。' },
      { en: 'I do not like this; give me that.', zh: '我不喜欢这个, 给我那个。' }
    ]
  },
  'leaf:词类:情态动词:': {
    short: '表示能力/可能/必须/建议的词, 后接动词原形: can, may, must, should。',
    full: `表示能力、可能、必须、建议等语气的助动词, 后接动词原形, 没有人称和数的变化。
can/could: 能力、许可、可能性(could 更委婉, 也可表过去能力)。
may/might: 许可、可能性(might 更不确定)。
must: 必须; 否定 mustn't 表"禁止"。
should: 应该(建议/义务)。
will/would: 意愿、将来(would 更委婉)。
要点: 情态动词后永远接动词原形; 表推测时确定程度 must(一定) > may/might(可能)。`,
    examples: [
      { en: 'You must finish it.', zh: '你必须完成它。' },
      { en: 'She can swim very fast.', zh: '她能游得非常快。' }
    ]
  },
  'leaf:词类:助动词:': {
    short: '帮助构成时态/语态/否定疑问的词: be(进行/被动), have(完成), do(否定疑问)。',
    full: `本身没有实际意义, 帮助实义动词构成时态、语态、否定和疑问。
be: 构成进行时(am/is/are doing)与被动语态(be done)。
have: 构成完成时(have/has/had done)。
do: 构成一般时态的否定与疑问(do/does/did not...)。
要点: 助动词与情态动词的区别——助动词只承担语法功能, 不表达"能力/可能"等语气。`,
    examples: [
      { en: 'She is reading.', zh: '她正在读书。(is 构成进行时)' },
      { en: 'They have finished the work.', zh: '他们已经完成了工作。(have 构成完成时)' }
    ]
  },
  'leaf:词类:系动词:': {
    short: '连接主语与表语: be, seem, look, feel, become, get 等。',
    full: `连接主语和表语, 说明主语"是什么/怎么样"。
be: 是(is/am/are/was/were)。
感官系动词: look(看起来), feel(感觉), sound(听起来), smell(闻起来), taste(尝起来)。
变化系动词: become, get, turn, grow(变得)。
保持系动词: remain, stay, keep(保持)。
要点: 系动词后接形容词或名词作表语; 感官系动词后接形容词而不是副词(He looks tired., 不是 tiredly)。`,
    examples: [
      { en: 'He looks tired.', zh: '他看起来累了。' },
      { en: 'She became a doctor.', zh: '她成了一名医生。' }
    ]
  }
}

// ---------- AI 工作区弹窗: 简短直白版 ----------
export const TERM_EXPLAIN = {
  'type:主句': {
    short: '句子去掉所有从句后剩下的主干部分, 含有主语和谓语, 能独立成句。',
    example: { en: 'I stayed home because it rained.', zh: '我待在家里, 因为下雨了。(I stayed home 是主句)' }
  },
  'type:名词短语': {
    short: '以名词为核心的一组词, 作用相当于一个名词, 可作主语、宾语等。',
    example: { en: 'A red apple is on the table.', zh: '一个红苹果在桌上。(a red apple 是名词短语)' }
  },
  'type:介词短语': {
    short: '"介词 + 名词"构成的短语, 常表示时间、地点、方式, 多作状语或定语。块内点击具体介词(如 by、with、for)可看该词含义。',
    example: { en: 'He reads in the morning.', zh: '他早上读书。(in the morning 是介词短语)' }
  },
  'type:定语从句': {
    short: '修饰名词的从句, 作用像形容词, 由 who/which/that 等引导。',
    example: { en: 'The book that you lent me is great.', zh: '你借我的那本书很棒。' }
  },
  'type:宾语从句': {
    short: '充当宾语的从句, 用 that/if/wh-词引导, 从句用陈述语序。',
    example: { en: 'I think that he is honest.', zh: '我认为他诚实。' }
  },
  'type:主语从句': {
    short: '充当主语的从句, 常用 it 作形式主语, 如 It is clear that...。',
    example: { en: 'That he won surprised us.', zh: '他赢了让我们惊讶。' }
  },
  'type:表语从句': {
    short: '位于系动词后充当表语的从句, 如 The problem is that...。',
    example: { en: 'The problem is that we lack time.', zh: '问题是我们缺时间。' }
  },
  'type:同位语从句': {
    short: '跟在 fact/idea/news 等抽象名词后、解释其内容的从句, 由 that 引导。',
    example: { en: 'The news that we won excited us.', zh: '我们获胜的消息让我们激动。' }
  },
  'type:状语从句(时间)': {
    short: '表示"什么时候"的从句, 由 when/while/before/after/until 等引导。',
    example: { en: 'Call me when you arrive.', zh: '到了给我打电话。' }
  },
  'type:状语从句(原因)': {
    short: '表示"为什么"的从句, 由 because/since/as 引导。',
    example: { en: 'He stayed home because it rained.', zh: '因为下雨他待在家。' }
  },
  'type:状语从句(条件)': {
    short: '表示"如果/除非"的从句, 由 if/unless 引导, 从句用一般现在时表将来。',
    example: { en: 'If it rains, we will stay inside.', zh: '如果下雨我们就待在屋里。' }
  },
  'type:状语从句(让步)': {
    short: '表示"虽然/尽管"的从句, 由 though/although/even though 引导, 不与 but 连用。',
    example: { en: 'Although he was tired, he kept working.', zh: '虽然累, 他仍继续工作。' }
  },
  'type:状语从句(目的)': {
    short: '表示"为了什么"的从句, 由 so that / in order that 引导, 常含情态动词。',
    example: { en: 'Speak louder so that everyone can hear you.', zh: '说大声点, 让大家都听见。' }
  },
  'type:状语从句(结果)': {
    short: '表示"导致什么结果"的从句, 由 so...that / such...that 引导。',
    example: { en: 'The box was so heavy that I could not lift it.', zh: '箱子太重, 我搬不动。' }
  },
  'type:状语从句(方式)': {
    short: '表示"以什么方式"的从句, 由 as / as if / as though 引导。',
    example: { en: 'Do as I told you.', zh: '按我说的做。' }
  },
  'type:非谓语结构(不定式)': {
    short: '"to + 动词原形", 不作谓语, 常表目的或将要做的事。',
    example: { en: 'She came to help us.', zh: '她来帮助我们。' }
  },
  'type:非谓语结构(动名词)': {
    short: '动词-ing 当名词用, 表一般性、习惯性的动作。',
    example: { en: 'I enjoy reading.', zh: '我喜欢阅读。' }
  },
  'type:非谓语结构(现在分词)': {
    short: '动词-ing, 表"主动/正在进行", 常作定语或状语。',
    example: { en: 'The sleeping baby is cute.', zh: '睡着的婴儿很可爱。' }
  },
  'type:非谓语结构(过去分词)': {
    short: '动词过去分词, 表"被动/已完成", 常作定语或状语。',
    example: { en: 'The broken window needs fixing.', zh: '破窗户需要修理。' }
  },
  'tense:一般现在时': {
    short: '经常、习惯发生的动作或客观事实; 三单动词加 s。',
    example: { en: 'The sun rises in the east.', zh: '太阳从东方升起。' }
  },
  'tense:一般过去时': {
    short: '过去发生的动作或状态, 动词用过去式, 常与 yesterday 等连用。',
    example: { en: 'I visited London last year.', zh: '我去年去了伦敦。' }
  },
  'tense:一般将来时': {
    short: '将来要发生的动作, 用 will 或 be going to。',
    example: { en: 'We will travel next month.', zh: '我们下个月去旅行。' }
  },
  'tense:现在进行时': {
    short: '此刻正在进行的动作, 用 am/is/are + doing。',
    example: { en: 'She is reading now.', zh: '她正在读书。' }
  },
  'tense:过去进行时': {
    short: '过去某时刻正在进行的动作, 用 was/were + doing。',
    example: { en: 'I was cooking when he called.', zh: '他来电时我在做饭。' }
  },
  'tense:现在完成时': {
    short: '过去发生但对现在有影响, 或持续到现在, 用 have/has + 过去分词。',
    example: { en: 'I have finished my homework.', zh: '我写完作业了。' }
  },
  'tense:过去完成时': {
    short: '"过去的过去", 用 had + 过去分词, 强调动作先后。',
    example: { en: 'The train had left before we arrived.', zh: '我们到之前火车已开走。' }
  },
  'tense:现在完成进行时': {
    short: '从过去一直做到现在, 可能继续, 用 have/has been + doing。',
    example: { en: 'I have been waiting for an hour.', zh: '我已经等了一小时。' }
  },
  'tense:过去完成进行时': {
    short: '到过去某时刻为止一直在做, 用 had been + doing。',
    example: { en: 'She had been studying for hours.', zh: '她之前连续学了几个小时。' }
  },
  'tense:将来进行时': {
    short: '将来某时刻正在进行的动作, 用 will be + doing。',
    example: { en: 'This time tomorrow I will be flying.', zh: '明天这时我正在飞行。' }
  },
  'tense:将来完成时': {
    short: '到将来某时刻已经完成, 用 will have + 过去分词, 常与 by 连用。',
    example: { en: 'By next June I will have graduated.', zh: '明年六月我就毕业了。' }
  },
  'voice:主动': {
    short: '主语是动作的执行者: 谁做了什么。',
    example: { en: 'The dog bit the man.', zh: '狗咬了人。' }
  },
  'voice:被动': {
    short: '主语是动作的承受者: 被怎样了, 用 be + 过去分词。',
    example: { en: 'The bridge was built in 1990.', zh: '桥建于 1990 年。' }
  },
  'mood:陈述': {
    short: '陈述事实或看法的普通句子语气。',
    example: { en: 'She likes music.', zh: '她喜欢音乐。' }
  },
  'mood:祈使': {
    short: '表示命令、请求、建议, 通常省略主语, 动词原形开头。',
    example: { en: 'Close the door, please.', zh: '请关门。' }
  },
  'mood:虚拟': {
    short: '表示与事实相反或愿望、假设, 如 If I were you...。',
    example: { en: 'If I were you, I would go.', zh: '我是你的话就去。' }
  },
  'role:主语': {
    short: '句子的主题, 动作的执行者, 一般位于句首。',
    example: { en: 'The dog barked.', zh: '狗叫了。(主语 The dog)' }
  },
  'role:谓语': {
    short: '说明主语做什么/是什么, 核心是带时态变化的动词。',
    example: { en: 'She sings well.', zh: '她唱得好。(谓语 sings)' }
  },
  'role:宾语': {
    short: '动作的对象, 在及物动词或介词之后。',
    example: { en: 'I read a book.', zh: '我读书。(宾语 a book)' }
  },
  'role:表语': {
    short: '系动词后说明主语身份/状态的成分。',
    example: { en: 'She is a teacher.', zh: '她是老师。(表语 a teacher)' }
  },
  'role:补语': {
    short: '补充说明宾语或主语的身份、状态。',
    example: { en: 'They elected him president.', zh: '选他当主席。(补语 president)' }
  },
  'role:定语': {
    short: '修饰名词的成分, 说明"哪个/什么样的"。',
    example: { en: 'The red car is mine.', zh: '红车是我的。(定语 red)' }
  },
  'role:状语': {
    short: '修饰动词或句子, 表时间/地点/方式/原因等。',
    example: { en: 'He left early.', zh: '他很早离开。(状语 early)' }
  },
  'role:同位语': {
    short: '紧跟名词后, 说明其身份或内容。',
    example: { en: 'My friend Tom is here.', zh: '我朋友汤姆在。(同位语 Tom)' }
  }
}

/** 弹窗术语 key 的可读标签 */
export function termLabel(key) {
  const parts = String(key).split(':')
  if (parts[0] === 'leaf') {
    const sub = parts[2] || ''
    const detail = parts[3] || ''
    return detail ? `${sub}(${detail})` : sub
  }
  return parts.slice(1).join(':')
}

/** 语法本叶子 → 知识卡片 key */
export function leafKeyForLeaf({ category, sub, detail }) {
  return `leaf:${category}:${sub}:${detail || ''}`
}

/** 语法本叶子 → 弹窗术语 key(用于从知识卡片跳对应术语, 少数无对应返回 null) */
export function termKeyForLeaf({ category, sub, detail }) {
  if (category === '时态') return `tense:${sub}`
  if (category === '语态') return `voice:${sub}`
  if (category === '句子成分') return `role:${sub}`
  if (category === '虚拟语气') return 'mood:虚拟'
  if (category === '从句') return `type:${detail ? `${sub}(${detail})` : sub}`
  if (category === '非谓语') return `type:非谓语结构(${sub === '分词' ? '现在分词' : sub})`
  if (category === '词类') return `pos:${sub}`
  return null
}

/** 弹窗术语 key → 语法本叶子(无对应返回 null, 用于"在语法本查看") */
export function leafForTermKey(key) {
  const parts = String(key).split(':')
  const p = parts[0]
  const v = parts.slice(1).join(':')
  if (p === 'tense') return { category: '时态', sub: v, detail: '' }
  if (p === 'voice') return { category: '语态', sub: v, detail: '' }
  if (p === 'role') return { category: '句子成分', sub: v, detail: '' }
  if (p === 'pos') return { category: '词类', sub: v, detail: '' }
  if (p === 'mood') return v === '虚拟' ? { category: '虚拟语气', sub: '虚拟语气', detail: '' } : null
  if (p === 'type') {
    if (v === '主句' || v === '名词短语' || v === '介词短语') return null
    const adv = v.match(/^状语从句\(([^)]+)\)/)
    if (adv) return { category: '从句', sub: '状语从句', detail: adv[1] }
    if (['定语从句', '宾语从句', '主语从句', '表语从句', '同位语从句'].includes(v)) return { category: '从句', sub: v, detail: '' }
    const nf = v.match(/^非谓语结构\(([^)]+)\)/)
    if (nf) return { category: '非谓语', sub: nf[1] === '现在分词' || nf[1] === '过去分词' ? '分词' : nf[1], detail: '' }
  }
  return null
}
