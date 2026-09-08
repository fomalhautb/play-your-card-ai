// 预生成用的三张数据表：模型、题目、变体（技能牌往 prompt 里塞的话）。
//
// 单独一个文件是因为它有三个使用者——生成脚本 pregen-answers.mjs、
// build-core-answers.mjs、build-generation-data.mjs。后两个要用同一份 prompt 拼装函数
// 重建「实际发给模型的完整 prompt」，各写一份的话，改了注入词就会几处说法不一致。
//
// **题目和注入词直接从 packages/content 的 JSON 读**，不再在这里抄一份
//（《正式版架构》6.4「注入提示词和预生成脚本引用同一来源」）：
// 从前两边各写一份、靠注释叮嘱"必须一字不差"，改了一边忘了另一边不会报任何错，
// 只会让玩家看到的题和 AI 实际被问到的那道对不上。
// 模型表还留在这里：它除了 id 和 slug 还要配思考强度和截断方式，那些是跑批参数，
// 不是游戏内容，content 里的卡表不该知道这些（对齐关系见下面 MODELS 的说明）。
import interferencePrompts from '../packages/content/src/data/interferencePrompts.json' with {
  type: 'json',
}
import questions from '../packages/content/src/data/questions.json' with { type: 'json' }

// 答案想要的长度上限。卡牌对战里一张卡上放不下长篇大论，答案短才好看好播。
const ANSWER_TOKEN_LIMIT = 30

// 这 16 个模型就是 packages/content/src/aiModels.ts 里 openrouter 非 null 的那 16 张牌
//（id、name、openrouter slug 都照抄那份表，由 content 的测试守着"每张能上场的卡都有数据"），
// 也就是对局里真能上场的全部 AI。
//
// 截断策略统一走「API 给足额度 + 脚本事后截到 30 token」（maxTokens 4000 + truncateAnswerTokens）。
// 不再按模型区分 API 层硬截，是因为这 16 个里很多会思考（Sol、R1、Fable、K3……），而思维链和正文
// 共享同一份 max_tokens 配额：配额被思考吃光时正文 content 直接是 null，三次重试全空，一个字都拿不到。
// run3 实测 Sol 就是这么整格丢失的。哪些模型会思考、思考多少并不稳定（同一 slug 换个问题就变），
// 与其逐个试探，不如所有模型一律给足额度让它把话说完，再由脚本按同一把尺子截短。
//
// reasoning 是可选的思考强度控制，只给两家配，其余不带这个字段（不主动开思考，也不去猜哪些模型认这个参数——
// 传给不支持的模型会被上游拒绝）：
// - GPT-5.6 Sol 实测支持 effort: 'minimal'，简单题复杂题都不思考。
// - DeepSeek R1 的思考关不掉：OpenRouter 会直接返回 400 "Reasoning is mandatory"，
//   'low' 是能压到的最低档，实测思考 token 从 ~1500 降到 ~265。
export const MODELS = [
  { id: 'gpt-3-5', name: 'GPT-3.5', openrouter: 'openai/gpt-3.5-turbo' },
  { id: 'gpt-4o', name: 'GPT-4o', openrouter: 'openai/gpt-4o' },
  {
    id: 'chatgpt-5-6-sol',
    name: 'ChatGPT 5.6 Sol',
    openrouter: 'openai/gpt-5.6-sol',
    reasoning: { effort: 'minimal' },
  },
  { id: 'claude-5-sonnet', name: 'Claude 5 Sonnet', openrouter: 'anthropic/claude-sonnet-5' },
  { id: 'claude-fable-5', name: 'Claude Fable 5', openrouter: 'anthropic/claude-fable-5' },
  {
    id: 'deepseek-r1',
    name: 'DeepSeek R1',
    openrouter: 'deepseek/deepseek-r1',
    reasoning: { effort: 'low' },
  },
  { id: 'deepseek-v4', name: 'DeepSeek V4', openrouter: 'deepseek/deepseek-v4-pro' },
  { id: 'gemini', name: 'Gemini', openrouter: 'google/gemini-3.7-flash' },
  { id: 'qwen', name: '通义千问', openrouter: 'qwen/qwen3.8-max' },
  { id: 'kimi-k2-6', name: 'Kimi K2.6', openrouter: 'moonshotai/kimi-k2.6' },
  { id: 'kimi-k3', name: 'Kimi K3', openrouter: 'moonshotai/kimi-k3' },
  // 豆包必须显式关掉思考，否则整格拿不到答案：Seed 的思维链会在「再核对一遍规则」上原地打转，
  // 把 max_tokens 耗光后正文 content 返回 null（finish_reason=length），三次重试全空。
  // 实测 24 格废掉 10 格，黑白颠倒那档尤其惨——注入词「反过来回答」会让它反复纠结该反什么。
  // 加配额没用（试过 16000，还是 3/8，因为它是在打转不是没写完），effort:'low' 也没用（同样 3/8）；
  // reasoning: { enabled: false } 把思考整个关掉才有效：8/8 全过，单格耗时从 200 秒降到 3 秒。
  {
    id: 'doubao',
    name: '豆包',
    openrouter: 'bytedance-seed/seed-2-1-turbo',
    reasoning: { enabled: false },
  },
  { id: 'glm-5', name: 'GLM-5', openrouter: 'z-ai/glm-5' },
  { id: 'minimax', name: 'MiniMax', openrouter: 'minimax/minimax-m3' },
  { id: 'yuanbao', name: '腾讯元宝', openrouter: 'tencent/hy3' },
  { id: 'grok', name: 'Grok', openrouter: 'x-ai/grok-4.6' },
  // 默认值写在后面会把上面单独配的值覆盖掉，所以默认在前、model 在后。
].map((model) => ({ maxTokens: 4000, truncateAnswerTokens: ANSWER_TOKEN_LIMIT, ...model }))

// 题库直接用 content 的那份，只把字段名对到判卷脚本要的形状上：
// expected 是「人类认为的正确答案」，用来事后核对模型答得对不对
//（scripts/judge-answers.mjs 会把它连同模型回答一起交给判卷模型），不参与生成请求；
// 在 content 里它叫 answer，是结算界面上那行大字。
// category 是题目类型，方便按类看模型强弱：
// - meme：中文梗和语言陷阱，考的是能不能听懂话外音而不是知识量。
// - bias：题面里根本没给判断依据，正确反应是承认无法判断，考的是会不会顺着刻板印象编。
// - life：常识推理题，答案常和第一直觉相反。
export const QUESTIONS = questions.map((question) => ({
  id: question.id,
  category: question.category,
  text: question.text,
  expected: question.answer,
}))

// 开头那句字数限制和 max_tokens 是一套的：光靠硬截断会把话截在半截，
// 先在 prompt 里把字数卡死，模型自己就会往短里写，截断只是兜底。
const BASE_SYSTEM_PROMPT =
  '最多十个字之内回答完。你是卡牌对战游戏《出牌吧AI》里的答题选手。请用中文简短回答问题：先给出结论，再用一句话说明理由。不要使用 markdown 格式。'

// 「复读机」和「黑白颠倒」是游戏里唯二会往 AI 上下文里塞话的技能牌，所以变体只有三档：
// 不塞话的基准线，加上这两张各自的注入词。之前那批复读机强度对照方案（①~⑤）已经选出
// 利诱版这一条，别的连同重复轰炸一起删掉了。
//
// 注入词、变体 id 和变体名一律从 content 的 interferencePrompts.json 现取，这里不再抄：
// 那个 JSON 同时是游戏里「这张牌往对方耳朵里塞了什么」的文案来源（content 的 script.ts），
// 两边本来就必须是同一句话。改那份 JSON 等于同时改了游戏和脚本，但改完要重跑预生成——
// 表里那批回答是照旧句子跑出来的。
//
// 复读机用利诱版而不是直接下指令：强制指令版实测所有模型 100% 服从，牌打出去必中就没有玩头；
// 只给好处、把答不答的决定权交回模型，才会出现「有的上钩有的不上钩」的区分度。
// 黑白颠倒那句故意只有一句话，不解释「反过来」是什么意思——怎么理解这句含糊的话本身就是看点。
//
// 注入词接在系统提示后面，前面空一行，和游戏里的读法一致（那边是整句塞进上下文）。
export const VARIANTS = [
  {
    id: 'baseline',
    name: '无技能',
    buildSystem: () => BASE_SYSTEM_PROMPT,
    buildUser: (question) => question.text,
  },
  ...Object.values(interferencePrompts).map((entry) => ({
    id: entry.variant,
    name: entry.name,
    buildSystem: () => `${BASE_SYSTEM_PROMPT}\n\n${entry.prompt}`,
    buildUser: (question) => question.text,
  })),
]
