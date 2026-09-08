# core 的测试

对应《正式版架构》6.3。五层，各管一段：

| 文件 | 管什么 |
|---|---|
| `engine.test.ts` | 单元测试：一条规则一个用例，规则细节看这里 |
| `properties.test.ts`、`properties.determinism.test.ts` | 属性测试：随机打几千局，断言不变量 |
| `replay.test.ts` + `golden/` | 回放测试：录好的整局重放，事件流逐字节对账 |
| `view.test.ts` | 隐藏信息（正向）：`viewFor` / `filterEvent` 该给的确实给了、该裁的裁对了形状 |
| `viewLeak.test.ts` | 隐藏信息（反向）：随机整局逐步扫视图和事件，该藏的一个都不许漏 |
| `helpers/` | 上面几样共用的随机走局器、指令枚举、开局描述 |

隐藏信息那两条守的是需求第 6 条，清单在 `src/view.ts` 的文件头，
背景见 `packages/core/README.md`。它们自带一套随机走局，不用 `helpers/`——
那份走局器只挑合法指令，而防泄漏要连被拒的指令一起过一遍。

跑：`pnpm --filter @ai-duel/core test`（本机十几秒）。

## 随机走局器

`helpers/randomPlay.ts` 的 `playRandomGame(seed, options)`：给一个整数种子，
从开局一路随机挑**合法**指令打到分出胜负，返回每一步的指令、事件流和执行后的状态。

```ts
import { playRandomGame } from './helpers/randomPlay'

const play = playRandomGame(12345, { illegalRate: 0.25 })
play.setup        // 这一局用的牌组、英雄、题序（可 JSON 序列化）
play.initialEvents// createGame 产生的开局事件
play.steps        // [{ command, events, illegal, state }, ...]
play.final        // 最后一步之后的状态
play.exhausted    // 撞上步数上限还没打完（正常一局到不了）
```

几件要紧的事：

- **一个种子决定一整局**：牌组、英雄、每一步挑哪条指令全从种子推出来，
  走局器自己不碰 `Math.random` 和时钟。所以复现一次结果只要种子和 `options`。
- **合法指令是照着引擎的校验枚举的**（`helpers/commandPool.ts`）：出牌阶段列出付得起的每张手牌
  （要选目标的技能牌按每个合法目标各算一条）、能发动的英雄技能和 `END_PLAY`；
  答题阶段用 content 的 `scriptedAnswers` 生成 `SUBMIT_ANSWERS`；结算阶段是双方的 `CONFIRM_ROUND`。
  这份枚举是引擎校验的**副本**，引擎改了校验而这里没跟着改，
  「合法指令不该被拒」那条属性就会红——那是提醒，不一定是引擎的 bug。
- **`illegalRate` 按比例混进保证会被拒的指令**：对方回合出牌、付不起、目标不存在、
  错误阶段的指令、重复确认、不存在的卡牌 id。属性测试用的是 `0.25`；
  录 golden 用 `0`（golden 里只放干净的合法指令）。
- **`setup` 可以指定**，不指定就按种子随机挑（三副预设牌组 + 一副覆盖牌组，
  4 位已实装英雄 + 不带英雄）。

## 属性测试守了哪些不变量

每条一个 `it`，红了一眼看得出坏的是哪条。除了 JSON 往返那条（60 局）以外每条各跑 1000 局，
非法指令比例 0.25。

`properties.test.ts`：

1. **费用不为负**：每一步之后双方 `tokens >= 0`、`spentThisRound >= 0`，且不超过 `tokenMax`。
   上限那半边有一个**有意的例外**：本轮打过「模型蒸馏」的一方可以顶破上限
   （回收的 Token 按印刷费用加回来，多出的部分等下一轮补满时被覆盖，见 `engine.ts`）。
2. **手牌张数对得上账**：引擎里没有手牌上限常量，所以查的是账——
   手上剩几张 = 抽到的 − 打出的 − 被弃的（`CARD_DRAWN` 减 `AI_DEPLOYED` / `SKILL_PLAYED` /
   `CARD_REMOVED`）。同时查牌的守恒：牌堆 + 手牌 + 场上 + 弃牌堆恒等于牌组张数。
3. **非法指令不改状态**：混进来的非法指令必须只回一条 `COMMAND_REJECTED`，
   且执行前后的状态 `JSON.stringify` 逐字节相同；反过来，合法指令一条 `COMMAND_REJECTED` 都不许出。
4. **实例 id 全局唯一**：任意一刻，双方牌堆、手牌、场上、弃牌堆里的 `instanceId` 互不重复。
5. **终局条件**：打完的局 `winner` 非 null，收场理由只有"有人单独到 `WIN_TARGET` 分"
   和"题库出完"两种；`'draw'` 只可能来自后一种；事件流最后一条一定是 `GAME_OVER`。

`properties.determinism.test.ts`：

6. **同 seed 结果一致**：同一个种子跑两遍，开局描述、每一步的指令、事件流和状态逐字节相同。
7. **状态 JSON 往返后相等**：每一步之前把状态过一遍 `JSON.parse(JSON.stringify(...))`，
   往返前后逐字节相同，而且**往返回来的状态执行同一条指令得到同样的事件流和新状态**——
   后半句才真正说明没丢东西（长得一样不算数，接着算下去也一样才算）。

## 怎么复现 fast-check 的反例

fast-check 挂掉时会打出反例（一个整数，就是那局的种子）和它自己的 `seed` / `path`，形如：

```
Error: Property failed after 37 tests
{ seed: 1922905548, path: "36:2:1", endOnFailure: true }
Counterexample: [1583497216]
Shrunk 3 time(s)
...
Caused by: Error: seed=1583497216 第 24 步：0 号玩家 Token 变成了负数
```

`Counterexample` 里那个数字就是失败那一局的种子（和 `Caused by` 那行里的 `seed=` 是同一个）。
它是**收缩之后**的种子，未必是最先撞上的那一局，但同样能重现这个失败。
最外面那个 `{ seed, path }` 是 fast-check 自己的重放坐标，和局面无关。

两种复现方式，按需要选：

1. **只想看那一局**——把 `Counterexample` 里那个数字喂给走局器，在临时脚本或 `it` 里直接跑：

   ```ts
   const play = playRandomGame(1583497216, { illegalRate: 0.25 })
   console.log(play.steps.map((s, i) => `${i} ${JSON.stringify(s.command)}`).join('\n'))
   ```

   断言消息里已经带了出问题的**步数**，照着下标去 `play.steps[24]` 看指令、事件和状态即可。

2. **想让 fast-check 原样重跑一遍**（包括收缩过程）——把它打出的 `seed` 和 `path` 填回去：

   ```ts
   fc.assert(fc.property(SEED, run), { seed: 1712..., path: '36:2:1' })
   ```

调查完记得把临时改动删掉。**发现的是引擎的真 bug 就先别改测试**：
在 `engine.test.ts` 里补一个最小用例把它钉住，再动引擎。

## golden 怎么重录，什么时候该重录

`golden/*.json` 每个文件是一整局：`setup`（种子、双方牌组和英雄、按 id 引用的题序）、
`initialEvents`、以及每条指令和它产生的事件流。目录（`Catalog`）不存——太大而且是公开数据，
重放时统一用 content 的 `createCatalog()`，靠文件里的 `contentHash` 对账。

**重录命令：**

```
pnpm --filter @ai-duel/core golden:record
```

它会重打 `helpers/goldenGames.ts` 里 `GOLDEN_CONFIGS` 那几局、覆盖 `golden/*.json`，
并检查这几局加起来有没有把**每张已启用的牌**都打出过一次（6.3 的内容覆盖），缺了就报错。
录制是确定性的：同一份代码和内容数据重录一遍应当零 diff。

**什么情况下该重录：**

- ✅ **有意改了规则**，事件流跟着变——先逐条看回放报出来的差异是不是这次改动的预期结果，
  确认了再重录，并把新的 JSON 一起提交、在 PR 里说清楚哪些事件变了。
- ✅ **改了内容数据**（卡牌费用、题目文案、预生成回答）：回放会先报"内容数据变了"
  而不是"规则变了"——那是 `contentHash` 对不上。确认内容改动本身没问题之后重录。
- ✅ **加了新牌或新英雄**：录制脚本的覆盖检查会红。给 `GOLDEN_CONFIGS` 加一局、
  或者把新牌放进某副牌组，再重录。
- ❌ **回放红了、看不懂差异**：不要重录。重录会把差异抹掉，等于把这次回归测试关掉。
  先搞清楚事件为什么变了。

**换牌组或改平衡之后覆盖检查红了怎么办**：`GOLDEN_CONFIGS` 里的 `seed` 是挑出来的
（挑法是每个配置扫几千个种子，贪心选出能凑齐全部 26 张开放牌的一组）。
牌组或费用变了可能要重新挑一遍：临时写个脚本，对每个配置试 `seed + i`，
收集 `AI_DEPLOYED` / `SKILL_PLAYED` 里出现过的 `cardId`，选出并集能覆盖全部开放牌的组合，
把结果填回 `GOLDEN_CONFIGS`。

**回放报错长什么样**：定位到哪一步、哪条事件、哪个字段，例如

```
balanced-mirror 第 6 步的事件流和 golden 不一致
  指令：{"type":"SUBMIT_ANSWERS","results":[...]}
  差异：events[3].spent[0]: 期望 99，实际 3
  这一步 golden 有 4 条事件，重放出来 4 条。
  规则改动请人工确认后 pnpm --filter @ai-duel/core golden:record 重录。
```
