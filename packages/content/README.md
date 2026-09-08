# @ai-duel/content

游戏内容数据：卡牌、英雄、题库、离线预生成的答题结果，以及校验它们的 zod schema。

只放数据和读数据的纯函数。规则在 `@ai-duel/core`，那个包一张卡都不带；这里只依赖 core 的**类型**
（《正式版架构》7.2 第 1 条）。

## 数据在哪

```
src/
  aiModels.ts     18 张 AI 牌（费用、国产标签、进化链、OpenRouter 模型 id）
  skillCards.ts   24 张技能牌（10 张已接进引擎，14 张还是占位）
  heroes.ts       7 位英雄
  cards.ts        两张卡表合成的总表 CARDS，牌组容量，三套预设牌组
  collection.ts   卡池、初始收藏、抽卡
  questions.ts    题库（读 data/questions.json）
  script.ts       查预生成答案表，干扰牌的注入提示词
  catalog.ts      createCatalog()：交给 createGame 的那份内容目录
  schema/         上面这些数据的 zod schema
  data/
    questions.json            题库
    interferencePrompts.json  两张干扰牌的注入词 + 它们在预生成数据里的变体身份
    pregenAnswers.json        题目 × 卡牌 × 变体 → 那个模型答了什么、对不对（脚本生成）
```

**为什么一部分是 TS、一部分是 JSON**，按"谁在改它"分：

- 手写、注释多的定义（AI 牌、技能牌、英雄）留在 TS 里。那些注释是设计依据——为什么这张牌 4 点、
  为什么这两张不进卡池、为什么复读机写成利诱而不是命令——转成 JSON 会全部丢掉。
- 脚本生成或要被脚本读的表放 `data/*.json`。`pregenAnswers.json` 是
  `scripts/build-core-answers.mjs` 的产物；题库和注入词要被 `scripts/pregen-data.mjs`
  直接 import，这样离线预生成和游戏读的是同一份文件（《正式版架构》6.4
  「注入提示词和预生成脚本引用同一来源」），不再靠"两边必须一字不差"的注释约束。

## 怎么改一张牌

1. 改 `src/aiModels.ts` 或 `src/skillCards.ts` 里那张卡。**id 就是原画的文件名**
   （`packages/legacy-client/public/cards/{models,skills}/<id>.webp`），改 id 要连图一起改，
   否则卡面会悄悄退回占位插画——`test/assets.test.ts` 会红。
2. 改了费用或 `domestic` 标签，`test/cards.test.ts` 里那张平衡表要跟着改。那是故意的：
   平衡数值不该被顺手改掉。
3. 新增一张能上场的 AI 牌，还要重新生成预生成答案表（下一节），否则它一上场查表就抛错。
4. 新增或删除卡牌后跑 `pnpm --filter @ai-duel/content test`：卡池、预设牌组、覆盖率几条都在这儿守着。

英雄同理，表在 `src/heroes.ts`，原画在 `packages/legacy-client/public/hero/card-<id>.webp`。
但英雄技能的**效果**在 core 的引擎里（按 id 分派），加一位带技能的英雄不是改数据就够了。

## 怎么重新生成回答表

答案不是手写剧本，是真的调模型跑出来的。三步（都要 OpenRouter 的 key）：

```bash
node scripts/pregen-answers.mjs      # 题目 × 模型 × 变体 逐格调模型，结果写进 scripts/out/
node scripts/judge-answers.mjs       # 判卷：每格答得对不对
node scripts/build-core-answers.mjs  # 合成 src/data/pregenAnswers.json（本包）
```

最后一步不调模型，只读 `scripts/out/` 里的结果，可以单独重跑。
`pregenAnswers.json` **手改无效**——下次跑第三步就被覆盖。
题目和注入词由 `scripts/pregen-data.mjs` 从本包的 JSON 读，所以改了那两份 JSON 就要重跑，
表里那批回答是照旧句子跑出来的。

## schema 和类型怎么钉在一起

每个 schema 后面跟一句 `satisfies z.ZodType<核心类型>`，比如
`export const aiCardSchema = z.object({...}) satisfies z.ZodType<AiCard>`。
core 的类型里加了字段或改了字段类型而 schema 没跟着改，**这个包就编译不过**，
不用等到运行时才发现两边说的不是一回事。

schema 查的是类型查不了的那一半：字符串不能为空、费用是正整数、表的键和卡自己的 id 对得上、
`evolvesTo` 指向的卡确实在表里、同一张卡不会被两张卡指为进化目标。

JSON 数据在**模块加载时** parse 一次（`src/questions.ts`、`src/script.ts`）：
坏数据一来就炸，而不是打到某一轮才炸。TS 数据本来就有类型检查兜着，schema 在测试里过一遍。

## 测试守了什么

`pnpm --filter @ai-duel/content test`，对应《正式版架构》6.4 和 6.3 最后一条：

- `schema.test.ts` — 所有数据过 schema。
- `cards.test.ts` — 逐张卡的费用、国产标签、进化链形状；`createCatalog()` 的形状。
- `aiModels.test.ts` — 每张 AI 牌的技能名和技能文案；四条升级链逐级对得上。
- `skillCards.test.ts` — 24 张技能牌里"接了引擎的 10 张"和"还是占位的 14 张"这条分界线。
- `collection.test.ts` — 卡池、初始收藏、三副预设牌组、开包抽卡。
- `pregenAnswers.test.ts` — **答案表完整**：每题 × 每张能上场的 AI × 每个变体都有值，
  多余的格子也报；查表的三条路径（正常、调不到模型的兜底、缺数据抛错）。
- `assets.test.ts` — **资源引用存在**：每张牌和每位英雄的原画文件真的在。
  美术资源现在还住在 `packages/legacy-client/public/`（迁移第 33 条才搬），到时改那个常量。
- `coverage.test.ts` — **内容覆盖**：每张已启用的牌和每位已启用的英雄，至少被 `core/test`
  或本包 `test/` 里的某一行代码点名。挂了要补一条有意义的断言，不是放宽这条检查。

**没做**：文案 key 各语言齐全那条（6.4 最后一项）。现在没有 i18n，全部文案都是中文写死在数据里，
等真上多语言时再补。
