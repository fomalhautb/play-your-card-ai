# @ai-duel/core

规则引擎。纯函数、确定性、**指令进事件出**，不带任何内容数据。

联机时它跑在服务端的房间对象里（《正式版架构》5.2），单机时跑在本地 driver 里，
两边是同一份代码、同一套行为。

## 接口形状

```ts
createGame(setup): { state, events }        // 开局：洗牌、洗题序、抛硬币定先手、发起始手牌
execute(state, command): { state, events }  // 执行一条指令
viewFor(state, player): PlayerView          // 算某一方能看到的裁剪视图
filterEvent(event, player): GameEvent | null // 一条事件对某一方能看到多少
```

数据全部来自 `@ai-duel/content`：`createGame` 收一份 `Catalog`（卡表 + 英雄表）和一份题库，
目录原样存进 `GameState.catalog`，之后 `execute` 一律从状态里查（`getCard` / `getHero` /
`upgradeTargetOf`）。所以 core 的 `src/` 一行都没 import 别的包，
`package.json` 里那条 `@ai-duel/content` 是测试专用的（测试打的是真卡）。

规则本身的完整口径在 `docs/legacy/architecture.md` 第 3 节——那份文档整体已废弃，
但第 3 节写的就是现在这套规则，core 从黑客松版一路保留下来没有改过。这里只讲**约定**和**边界**。

## `src/` 里哪份装什么

规则引擎按阶段拆成一摞 `engine*.ts`，**依赖是单向的**：谁只许 import 谁、为什么不能反过来，
完整分层写在 `src/engine.ts` 的文件头，加代码前先看那一份。

| 文件 | 装什么 |
|---|---|
| `index.ts` | 包入口，只做转发 |
| `engine.ts` | `execute` 分派指令 + 转发各阶段的对外导出；**分层清单在它的文件头** |
| `constants.ts` | 可调的规则常量（起手张数、Token 上限、胜利分数……），客户端也读它 |
| `engineUtils.ts` | 最底层的小工具：`reject` / `clone` / `shuffle` / `withRng` / `drawCards` / `other` |
| `engineSetup.ts` | 开局 `createGame` 和它的配置类型 |
| `enginePlay.ts` | 出牌：`effectivePlayCost` / `playCard` / `denyReason` / `endPlay` |
| `engineSkills.ts` | 技能牌和英雄技能的结算：`applySkillEffect` / `useHeroSkill` |
| `engineQuiz.ts` | 答题：`enterQuiz` / `submitAnswers` |
| `engineRound.ts` | 回合推进与收场：`confirmRound` / `announceRound` |
| `engineDebug.ts` | 测试房的加牌 / 弃牌指令 |
| `catalog.ts` | 从 `GameState.catalog` 里查卡牌和英雄定义 |
| `cards.ts` / `question.ts` / `state.ts` / `commands.ts` / `events.ts` | 数据形状，按领域分；`types.ts` 只是把这五份汇总出去 |
| `view.ts` | 隐藏信息的唯一过滤点，连同视图那几个类型（见下一节） |

## 确定性约定

- `execute` 是纯函数：不改传入的 `state`，返回全新的状态。
- 同样的 `state` + 同样的 `command` 永远得到同样的结果。引擎里**没有** `Math.random`、
  `Date.now`，也不碰浏览器或 Node 的全局对象（biome 和 dependency-cruiser 各有一条规则守着）。
- 开局那一串随机（抛硬币、洗两副牌、洗题序）在 `createGame` 里按 `seed` 一次掷完。
- `execute` 里只有「内存紧缺」要掷随机，用的是状态里的 `GameState.rngSeed`：
  起一把生成器、取完值再把下一颗种子写回状态。生成器本身不可 JSON 序列化，进不了状态，种子可以。
- `GameState` 和 `PlayerView` 必须全程可 JSON 序列化（引擎就是用 JSON 深拷贝推进状态的，
  视图还要走网络）。别往里塞函数、`Map`、`Date`。
- 非法指令不抛异常：原样退回 `state`，外加一条 `COMMAND_REJECTED`。

## 隐藏信息

需求第 6 条是服务器权威：客户端只发指令、只收事件，不持有完整局面。
`viewFor` 和 `filterEvent` 是**整个系统里唯一的过滤点**，清单写在 `src/view.ts` 的文件头，
第 14 条的 protocol 和第 22 条的房间对象照它办，别在别处再补一层，
也别绕开它直接下发 `GameState` 或引擎原样发出的事件。

视图那几个类型（`PlayerView` / `SelfView` / `OpponentView` / `PlayerSideView` / `QuestionView`）
也放在 `src/view.ts` 里，没跟别的数据形状一起进 `types.ts` 那一组：
它们只有 `viewFor` 一个产出方，而"每个字段为什么给到这个程度"的理由就是那份清单，
摆在一起改哪边都不用翻文件。

对某一方遮住的：

| 藏什么 | 视图里换成 |
|---|---|
| 对手的手牌（内容 **和实例 id**） | `opponent.handCount` |
| 双方的牌堆顺序和内容（**自己的也藏**） | `deckCount` |
| 本轮题目按阶段裁剪，以后轮次整题不给 | `questions`（`QuestionView` 三档） |
| `rngSeed`（能算出「内存紧缺」留谁） | 没有这个字段 |
| `seq`（造实例 id 的计数器） | 没有这个字段 |

公开的：卡池、双方场上单位连同身上的本轮标记、双方弃牌堆、分数、Token、本轮消耗、
金钟罩、核电站减免、英雄和技能用没用过、结算确认状态。

题目分三档揭晓：出牌阶段只给类别和关键词 → `QUESTION_REVEALED` 之后给题面 →
`ROUND_SCORED` 之后才给答案和解析。答案**不随任何事件下发**，
结算之后它在视图的 `questions` 里，只留一个出口就少一处会漏的地方。

`filterEvent` 对 `COMMAND_REJECTED` 返回 `null`：它是对某一条指令的回执、不是局面上发生的事，
不进广播。调用方（服务端的房间对象、本地 driver）先把这一条挑出来回给发指令的那一方，
其余事件再逐条过 `filterEvent` 分别下发。

**挡不住什么**：题库是随包发布的公开数据，拿着整份题库照出牌阶段就公开的关键词能反查到答案。
这里遮的是"这一刻该不该给"。

## 隐藏信息怎么守

测试分工的全表在 `test/README.md`，隐藏信息占其中两条：

- `test/view.test.ts` — **正向**，守"别裁过头"：自己的手牌一张不少、对手只有张数、
  题目三档各是什么形状、公开事件原样通过、视图 JSON 往返相等、改视图改不到状态。
- `test/viewLeak.test.ts` — **反向**，守"别裁漏了"：40 局随机对局、2000 多步，
  每一步之后对双方各算一次视图、把这一步的事件逐条过一遍 `filterEvent`，
  再把"此刻还该藏着的东西"当字符串在 JSON 里查一遍。两个坑要留神：
  实例 id 得连着引号一起查（`"p1-c2"`），否则公开的 `p1-c20` 会被当成子串误报；
  题库得用编出来的记号串而不是真题，真题的答案短到只有一个「否」字，做子串查找全是假警报。
  这条测试还顺带断言**每种 `GameEvent` 都被过滤过一遍**，配合 `filterEvent` 里那个不写 default 的
  `switch`，新加一种事件时两头都会逼着人当场决定它对对手公开到什么程度。

改隐藏信息相关的东西时，先改 `src/view.ts` 文件头那份清单，再改代码。
清单和代码对不上的时候，以清单为准去改代码。
