# @ai-duel/design

设计令牌：颜色、字号（含字体栈）、间距、圆角、动效时长，外加卡牌和版式的公共尺寸。

全项目只在这里定义一次，`canvas` 的 Pixi 组件和 `ui` 的 React 组件共用同一份数值，
组件里禁止写死颜色和时长（《正式版架构》7.1 第 4 条）。

## 目录

```
tokens/          令牌源，W3C DTCG 格式的 JSON，人改的就是这些
sd.config.mjs    生成脚本（Style Dictionary 5），也是 check 的入口
src/generated/   产物，机器写的，别手改
  tokens.ts        TS 消费方用：嵌套访问 + 字面量类型
  tokens.css       React 那边用：:root 上的自定义属性
src/index.ts     包入口，转出 tokens 和 Tokens 类型
test/            产物的形状检查（颜色格式、正数、阶梯递增）
```

## 怎么改

1. 改 `tokens/*.json`。
2. 跑 `pnpm --filter @ai-duel/design build`。
3. **把产物一起提交。** 产物是提交进仓库的，两边直接读，谁也不用先跑一遍生成器；
   代价是产物会和源走岔，所以 CI 里有一步 `pnpm --filter @ai-duel/design check`
   当场重新生成一遍做比对，对不上就红。

`check` 只在内存里生成、不落盘，所以它不会偷偷把工作区改干净再报绿。

## 消费方式

TS（Pixi 和 React 都一样）：

```ts
import { tokens } from '@ai-duel/design'

sprite.tint = tokens.color.paper.navy // '#232f4b'，Pixi v8 直接认
gsap.to(node, { duration: tokens.duration.hand.layout }) // 0.4，单位是秒
```

CSS（React 那边在应用入口引一次）：

```ts
import '@ai-duel/design/tokens.css'
```

```css
.foo {
  color: var(--color-paper-ink);
  border-radius: var(--radius-lg);
}
```

> `biome.jsonc` 的 `noRestrictedImports` 禁掉了所有 `@ai-duel/*/*` 形式的 import，
> 本意是「别伸进别的包的内部文件」。而 `./tokens.css` 是 `package.json` 的 `exports` 里
> 声明过的第二个包入口、不是内部文件，所以那条规则的 `group` 末尾加了一条
> `!@ai-duel/design/tokens.css` 把它放行了，直接写 `import '@ai-duel/design/tokens.css'` 就行。
> 口子只开这一个精确路径，别的深路径照旧禁——别绕成相对路径。

TS 那边的尺寸是**纯数字**（px；`font.sizeCqi.*` 那一组的单位是 cqi），时长是**秒**——
Pixi 只认数字，GSAP 的 duration 也是秒。要带单位的值就读 CSS 变量，两边是同一批数。

## 命名规则

- 路径是 `类别.分组.名字`，TS 里嵌套访问，CSS 里拍平成 `--类别-分组-名字`（kebab）。
- 类别就是七个顶层组：`color`、`font`、`size`、`space`、`radius`、`duration`、`opacity`。
- 分组按**东西**分，不按页面分：`color.paper` 是纸面那套、`color.battle` 是对局那套、
  `color.plaque.<变体>.<状态>.<部位>` 是匾额按钮。
  一个分组里可以同时有子分组和令牌：匾额的四角折线和星芒不随状态变，就直接挂在变体上
  （`color.plaque.navy.corner`），和三个状态子分组并排。
- 同一个东西的触屏档在名字后面加 `Touch`（`size.battle.topbarHeightTouch`），
  和桌面档并列，不做成另一套主题——旧样式里它们就是一条媒体查询里的覆盖。
- 每个令牌的 `$description` 写清楚它原来在旧样式的哪个文件、哪条规则里，干什么用。
  产物里这段说明会跟着走：TS 是叶子上的 JSDoc（编辑器悬停可见），CSS 是变量上一行的注释。

### 为什么颜色不带透明度

颜色令牌一律是 `#rrggbb`，Pixi v8 和 CSS 都直接认，测试也卡着这条。
旧样式里带透明度的那几个颜色（匾额的内框细线、首页花饰）拆成了两个令牌：
颜色进 `color`，透明度进 `opacity`——Pixi 的 tint 和 alpha 本来也是分开的两件事。

## 收了什么

- **颜色**：纸面色板（`paper.css`）、对局色板、首页墨色和花饰、页面前景/底色、
  三种卡牌的标识色（AI 蓝 / 技能橙 / 英雄紫）、匾额按钮四个变体各自的三种状态配色
  （板面 / 外框 / 内框 / 字色，外加不随状态变的四角折线和星芒）、卡边米黄、
  卡片加载动画的线框色、夜色圆章、战场小卡角标的四档配色、浮起小气泡、
  战场中线和它的回合徽章、对方回合吊匾、连接状态和错误红字、
  结算层的对错两档（`theme.forest` / `theme.brick`）、三档全屏遮罩（`overlay.*`）、
  压在深色上那行暖白字（`battle.cueInk`）。
- **字号**：字体栈、允许的字重范围 300~700、10~15px 的小字号阶梯（含三个半档）、
  按容器宽排版那几页的 cqi 阶梯、小字和中号字各自的桌面/触屏放大系数。
- **尺寸**：卡面 150×225、战场小卡 110×165 和它的比例、放大查看的四个倍数、
  英雄牌缩放、对局顶栏 / 侧栏 / 顶栏控件 / 手牌区 / 对方手牌的高宽（含触屏档）、
  结算卡最小宽、静音钮尺寸、匾额按钮四个尺寸档、雕花框的边宽和四角、问号圆章直径、
  对局顶栏图标钮、中线徽章、Token 细条、两块吊匾（对方回合 / 下一题）。
- **动效时长**：手牌重排 0.4s、卡牌放大进出场 0.55 / 0.6s、卡片加载周期 1.75s、
  首页人物高亮和介绍卡片的淡入淡出与起跑延迟、匾额按钮的压下和回弹、按钮悬停换色、
  气泡的淡入淡出和停留。
  TS 里的时长常量只收**多处共用**的那几个（`LAYOUT_DUR`、`ZOOM_IN_DUR`、`ZOOM_OUT_DUR`），
  只有一个文件用的（拖拽、翻面、结算层里那一堆）留在各自的组件里，它们是组件的内部节奏。
- **间距和圆角**：旧样式没有令牌化过，这两档阶梯是统计 `styles.css` 里
  `border-radius` / `padding` / `gap` / `margin` 的 px 取值定的，各取出现最多的六个数，
  每一档的 `$description` 里记了它出现的次数和排名。

## 明确不收什么

- **缓动曲线**：旧样式里那几条 `cubic-bezier(...)` 现在没有对应的令牌，也就没有 `easing`
  这个顶层组。原因是两边根本不认同一种写法：CSS 直接吃这个字符串，而 GSAP 核心不认，
  要另外注册 CustomEase 才行——收成一个令牌只会让画布那边每次都得转换一遍。
  画布组件先用 GSAP 内置的 `back.out` / `power2.in` 顶上（见 canvas 的 PlaqueButton）。
  等 `ui` 那边真有 CSS 过渡要和画布用同一条曲线时再一起定。
- **多值的圆角** `12px 0 0 12px` 这类：一个令牌只存一个值，「圆哪几个角」是组件的形状
  而不是设计量。要圆左侧两个角的组件自己拿 `radius.xl` 去画。
- **百分比圆角** `50%`：TS 那边的尺寸一律是纯数字，百分比换算不出来；
  而且 Pixi 画圆本来就是 `circle()`，用不着给方块加圆角。
- **手绘滤镜引用** `--rough-*`：值是 `url('#ai-duel-rough-icon')`，指向页面里的 SVG filter，
  是 DOM 专属的东西，Pixi 那边没有对应物。
- **纸纹 data-URI 纹理** `--tex-*` / `--battle-grain` / `--vignette`：Pixi 要把它们烤进纹理，
  不是靠一个变量代进 CSS，属于素材不属于令牌。
- **页面私有的布局变量**：`--home-layer-feather`、`--battle-cue-x`、`--of-band`、
  `--card-edge-feather` 这类只服务一处版式的量，跟着各自的组件走。
- **扇形几何常量**：`fanMath.ts` 的 `SPREAD_DEG`、`GAP_PER_CARD`、`MAX_SPAN`、`arcRadius` 等
  属于手牌组件自己的几何，迁移第 1 条做 Pixi 手牌时再安排。
- **中号字的那十来个数**：旧样式里是就地写 `calc(设计稿的数 * --fs-mid-scale)`，
  互不相同、也不成阶梯，只把那个放大系数收了进来。
- **组件私有字号和字距**：只服务一个组件、别处不复用、彼此也不成阶梯的那些字号
  （匾额按钮四个尺寸档的 24 / 20 / 18 / 19px 和各自的字距、卡面铭牌的 14px、
  结算层那几档大字）。收进来只是给一个没人复用的数起个全局名字，反而让人以为
  「改这一条会影响别处」。
  **判据**：两个以上的组件真的在读同一个数，才收；否则留在组件里。
  留在组件里的写法有要求——集中成文件顶部的**一张常量表**，附一句说明为什么不进令牌，
  别把数字散在各处（现成例子见 `canvas` 的 `components/PlaqueButton.ts` 里的 `PLAQUE_TYPE`）。
  上面那条「中号字」是同一类的一个特例，只是它连组件都还没有。

## 关于生成器

用的是 [Style Dictionary](https://styledictionary.com) 5.x。

- 源里 `$value` 用带单位的字符串（`150px`、`0.4s`、`0.95cqi`），不用 DTCG 新草案的
  `{ value, unit }` 对象。两个原因：Style Dictionary 5.5 的内置 CSS 变换处理不了 duration
  的对象形式（会输出 `[object Object]`），而 `cqi` 也不在 DTCG 允许的单位表里。
- CSS 用内置的 `css/variables`。源里的值本来就是 CSS 能直接吃的，所以只挂了
  `name/kebab` 和一个自写的字体栈拼接变换，没用 `transformGroup: 'css'`。
- TS 用了一个自写的 format（`ts/nested-const`）。内置的几个都不合用：
  `javascript/module` / `javascript/nested` 是嵌套的，但输出的是整个令牌对象
  （`$type`、`filePath`、`original`…）而不是值，而且是 CommonJS；
  `javascript/es6` 只有值但是扁平的一堆 const；`typescript/es6-declarations` 只产 `.d.ts`。
  没有一个同时满足「嵌套」「有类型」「单个 `.ts`」，所以自己走一遍 `allTokens`
  拼成嵌套字面量，末尾加 `as const`。
- 尺寸和时长在 TS 那边转成数字，也是三个自写的值变换（`dimension/number`、`duration/seconds`、
  以及两个平台共用的 `fontFamily/stack`）。不用 `transformGroup: 'js'` 是因为它带的
  `size/rem` 会把 `150px` 换算成 rem。

产物排除在 Biome 的格式化和 lint 之外（见 `biome.jsonc`）：格式由生成器定，手改会被覆盖；
400 行那条上限也一样——它管的是人写的文件，而令牌只会越加越多。
