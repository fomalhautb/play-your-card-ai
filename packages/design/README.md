# @ai-duel/design

设计令牌：卡牌和版式的公共尺寸，外加动效时长。

全项目只在这里定义一次，画布那边的 Pixi 组件直接读它，组件里禁止写死动效时长
（《正式版架构》7.1 第 4 条）。

> **正式版简化第 5 步（2026-09）把这个包瘦了一圈。** 原先有七组令牌（颜色、不透明度、字号、
> 圆角、间距、尺寸、时长）和两种产物（TS + CSS）。简化第 3 步把 React 组件剥成素方块之后
> CSS 变量一条都没人读了，第 4 步又删掉了画布上的装饰件，剩下的颜色只服务卡面和几层全屏
> 遮罩、各自只有一两个调用方——按下面「明确不收什么」的判据，那些值该留在组件里。
> 于是颜色、不透明度、字号、圆角、间距五组连同 CSS 产物一起删掉，尺寸那组逐条核过，
> 只留卡牌和版式的几何。重做视觉时会重新定一套色板，那时再决定哪些值值得收回来。

## 目录

```
tokens/          令牌源，W3C DTCG 格式的 JSON，人改的就是这些
  size.json        卡牌和版式的公共尺寸
  duration.json    动效时长
sd.config.mjs    生成脚本（Style Dictionary 5），也是 check 的入口
src/generated/   产物，机器写的，别手改
  tokens.ts        嵌套访问 + 字面量类型
src/index.ts     包入口，转出 tokens 和 Tokens 类型
test/            产物的形状检查（正数、比例、触屏档不小于桌面档）
```

## 怎么改

1. 改 `tokens/*.json`。
2. 跑 `pnpm --filter @ai-duel/design build`。
3. **把产物一起提交。** 产物是提交进仓库的，消费方直接读，谁也不用先跑一遍生成器；
   代价是产物会和源走岔，所以 CI 里有一步 `pnpm --filter @ai-duel/design check`
   当场重新生成一遍做比对，对不上就红。

`check` 只在内存里生成、不落盘，所以它不会偷偷把工作区改干净再报绿。

## 消费方式

```ts
import { tokens } from '@ai-duel/design'

sprite.width = tokens.size.card.width // 150，Pixi 只认数字
gsap.to(node, { duration: tokens.duration.hand.layout }) // 0.4，单位是秒
```

尺寸是**纯数字**（px），时长是**秒**。现在只有一个包入口，深路径一律禁止
（`biome.jsonc` 的 `noRestrictedImports`）。

## 命名规则

- 路径是 `类别.分组.名字`，TS 里嵌套访问。
- 类别就是两个顶层组：`size`、`duration`。
- 分组按**东西**分，不按页面分：`size.card` 是卡牌、`size.battle` 是对局版式。
- 同一个东西的触屏档在名字后面加 `Touch`（`size.battle.topbarHeightTouch`），
  和桌面档并列，不做成另一套主题——旧样式里它们就是一条媒体查询里的覆盖。
- 每个令牌的 `$description` 写清楚它原来在旧样式的哪个文件、哪条规则里，干什么用。
  产物里这段说明会跟着走（叶子上的 JSDoc，编辑器悬停可见）。

## 收了什么

- **尺寸**：卡面 150×225 和它的圆角、战场小卡 110×165 和它的比例、放大查看的四个倍数
  （普通卡和英雄牌各有桌面 / 触屏两档）、对局顶栏高（含触屏档）、侧栏宽、手牌区和对方
  手牌区的高、结算卡最小宽、Token 细条的宽高。
  判据是「两个以上的文件真的在读同一个数」——只有一处读的尺寸留在那一处（例子见
  `canvas` 的 `scenes/duel/layout/desktopLayout.ts` 顶部那一排常量）。
- **动效时长**：手牌重排 0.4s、卡牌放大进出场 0.55 / 0.6s、展示层停留时的浮动和字幕淡入、
  选目标层压暗的淡入淡出、结算层等待点跳动和比分脉冲、气泡的淡入淡出和停留。
  收时长这一组的判据和尺寸不同：它们是「屏幕上有东西在轻轻动」的统一节奏，
  一处快一处慢会让画面看着不是一套。真正只服务一段演出的长度在 canvas 的
  `director/timings.ts` 里，一条一条对着旧代码抄。
  另有几条（卡片加载周期、首页人物的淡入淡出、匾额按钮的压下回弹、按钮悬停）现在**没有
  调用方**：正式版简化把那些组件删了，时长留着是因为重做视觉时还要按同一个节奏装回去。

## 明确不收什么

- **颜色和不透明度**：见上面那段简化说明。现在画布里剩下的颜色（卡面的纸色和墨色、
  费用章的金属色、几层全屏遮罩、命中特效的粒子色）都集中在各自文件顶部的常量表里，
  每条都注明了抄自旧样式的哪一条规则。
- **字号和字体栈**：同上。画布上的文字现在只有一个 `Box` 和一个 `Label` 两处用得着，
  各自在文件顶部写死。
- **圆角和间距阶梯**：原先那两档是统计旧 `styles.css` 的取值定的，服务的是 React 那边的
  纸面样式；样式剥掉之后没有调用方了。卡面圆角不在这条里——它是卡牌几何，留在 `size.card`。
- **缓动曲线**：CSS 和 GSAP 不认同一种写法（GSAP 核心不吃 `cubic-bezier(...)` 字符串，
  要另外注册 CustomEase），收成一个令牌只会让画布那边每次都得转换一遍。
  画布组件用 GSAP 内置的 `back.out` / `power2.in` 顶上。
- **纸纹 data-URI 纹理**：Pixi 要把它们烤进纹理，属于素材不属于令牌。
- **页面私有的布局量**：只服务一处版式的数跟着各自的组件走。
  **判据**：两个以上的文件真的在读同一个数，才收；否则留在组件里。
  留在组件里的写法有要求——集中成文件顶部的**一张常量表**，附一句说明它抄自哪里、
  为什么不进令牌，别把数字散在各处。

## 关于生成器

用的是 [Style Dictionary](https://styledictionary.com) 5.x，只开了一个 TS 平台。

- 源里 `$value` 用带单位的字符串（`150px`、`0.4s`），不用 DTCG 新草案的
  `{ value, unit }` 对象：Style Dictionary 5.5 的内置变换处理不了 duration 的对象形式
  （会输出 `[object Object]`）。
- TS 用了一个自写的 format（`ts/nested-const`）。内置的几个都不合用：
  `javascript/module` / `javascript/nested` 是嵌套的，但输出的是整个令牌对象
  （`$type`、`filePath`、`original`…）而不是值，而且是 CommonJS；
  `javascript/es6` 只有值但是扁平的一堆 const；`typescript/es6-declarations` 只产 `.d.ts`。
  没有一个同时满足「嵌套」「有类型」「单个 `.ts`」，所以自己走一遍 `allTokens`
  拼成嵌套字面量，末尾加 `as const`。
- 尺寸转成数字、时长转成秒，是两个自写的值变换（`dimension/number`、`duration/seconds`）。
  不用 `transformGroup: 'js'` 是因为它带的 `size/rem` 会把 `150px` 换算成 rem。
- CSS 产物在正式版简化第 5 步删掉了：React 那边一条 `var(--…)` 都不读了。要加回来的话
  把 `css/variables` 那个平台配回 `sd.config.mjs`，并给 `biome.jsonc` 的
  `noRestrictedImports` 重新开一条 `!@ai-duel/design/tokens.css` 的放行。

产物排除在 Biome 的格式化和 lint 之外（见 `biome.jsonc`）：格式由生成器定，手改会被覆盖；
400 行那条上限也一样——它管的是人写的文件，而令牌只会越加越多。
