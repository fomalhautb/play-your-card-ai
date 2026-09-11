# 组件目录页

《正式版架构》7.1 第 3 条那个「一个开发专用页面列出所有组件、全部变体、全部状态」。
React 部分是 Storybook 本来就干的事，Pixi 组件在同一目录页里嵌画布展示。
6.6 和 6.8 的截图回归直接拿这一页当输入。

规矩只有一条：**每个组件必须有目录页条目，没有条目视同没写完。**

## 起页面

```bash
pnpm assets:build    # 第一次要先打卡面图集，不然卡面那几条会显示「起不来」
pnpm storybook       # http://localhost:6006
```

条目分两栏：`Canvas/*` 是 Pixi 组件，`UI/*` 是 React 组件。
每条画布条目的控制面板上有一个**实时**开关：

- 关（默认）：手动时钟，挂载完按 60fps 的固定步长推进到条目声明的那个时刻就停住。
  同一条条目每次打开都停在同一帧——截图回归拍的就是这一档。
- 开：真实 ticker，用来看动画。这一档下方多一颗「重播」按钮。

## 文件

| 文件 | 干什么 |
|---|---|
| `main.ts` | Storybook 配置：story 文件在哪、静态资源根在哪 |
| `preview.tsx` | 全局设置：底色、「实时」开关、把画布条目换成 `<PixiStage>` 的装饰器 |
| `pixiStory.tsx` | 画布条目的舞台：建渲染器、建帧循环、加载图集、按参数重建、收尾 |
| `playwright.config.ts` | 截图回归的跑批器配置 |
| `catalog.spec.ts` | 截图回归的用例：遍历所有条目各拍一张 |
| `ensureAtlas.ts` | 跑比对之前先确认卡面图集在位 |
| `baselines/<平台>/` | 基线图，**要提交进仓库** |

story 文件不放在这里，**跟着组件走**：`packages/canvas/src/**/*.stories.ts`、
`packages/ui/src/**/*.stories.tsx`。集中放的话新增组件要改两个地方，
而「每个组件必须有条目」这条要求条目和组件挨着，漏了一眼就看得出来。

## 给新组件加条目

### canvas（Pixi）

在组件旁边开一个 `XXX.stories.ts`。它只写一份**纯数据的声明**，一行 React 都没有——
`canvas` 包不许依赖 React（`.dependency-cruiser.cjs` 的「边界-canvas-不碰-react」），
也不能 import 本目录下的任何东西（跨包只走包入口，7.2 第 2 条）。
`preview.tsx` 的装饰器认 `parameters.pixi` 这个字段，把条目换成一块画布。

```ts
import type { StoryStage } from '../storyStage'
import { MyThing } from './MyThing'

export default {
  // title 和导出名一律用英文，理由见下面「基线图的文件名」。
  title: 'Canvas/MyThing',
  // 画面全由 Pixi 画，React 这边什么都不渲染。
  render: () => null,
}

export const Normal = {
  name: '普通',
  parameters: {
    pixi: {
      width: 320,
      height: 420,
      /** 要卡面图集就写 true；图集不在时画面上会显示一句提示，不是白屏。 */
      needsAtlas: true,
      /** 手动时钟要推进到的时刻（毫秒）。有动画的条目靠它停在固定的一帧。 */
      settleMs: 600,
      /**
       * 只有拍一张就要等很久的重条目才写：单张截图的时限（毫秒），不写就用统一的 45 秒。
       * 用法和为什么不整体调大，见下面「一条条目老是超时」。
       */
      screenshotTimeoutMs: 150_000,
      mount(ctx: StoryStage) {
        const thing = new MyThing(/* … */)
        ctx.stage.addChild(thing)
        // 逐帧跟随（不走补间的那种）在这里注册，返回「还在动吗」。
        ctx.onFrame((deltaMs) => thing.advance(deltaMs))
        // 自己建的纹理自己收。没什么要收的就什么都不返回。
        return () => thing.dispose()
      },
    },
  },
}
```

`mount` 拿到的 `StoryStage` 里有 `stage`、`renderer`、`animator`、`resolution`、
`width`/`height`、`textures`（图集）、`step(ms)`、`onFrame(cb)`。
类型定义和每一项的说明在 `packages/canvas/src/storyStage.ts`。

要动画的条目一律走 `ctx.animator` 建补间：只有它建的补间会被帧循环记账，
手动时钟才推得动、也才停得下来（3.6）。自己调 `gsap.to` 的话画面不会动。

### ui（React）

在组件旁边开一个 `XXX.stories.tsx`，就是普通的 Storybook 写法：

```tsx
import { MyButton } from './MyButton'

export default {
  title: 'UI/MyButton',
  component: MyButton,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
}

export const Normal = { name: '普通', args: { variant: 'A' } }
export const Disabled = { name: '禁用', args: { variant: 'A', disabled: true } }
```

数值一律从 `@ai-duel/design` 读，别在 story 里写死颜色和间距（7.1 第 4 条）。

悬停和按下这两个态目前**没有**装插件来模拟 CSS 伪类，所以组件要能被 prop 直接摆成那个样子
（比如 `data-state="hover"`），否则那两条 story 拍出来和普通态一模一样。
第一批 React 组件（迁移第 31 条）落地时按这条设计，真需要伪类模拟再另议装插件。

### 状态矩阵

7.1 第 3 条要求列出「普通、悬停、按下、禁用、加载」五态。
**有的态每态一条 story，没有的在文件头注明不适用**，并写清为什么。
现有条目的写法见 `packages/canvas/src/components/CardSprite.stories.ts` 的文件头。

## 截图回归

```bash
pnpm --filter @ai-duel/client catalog:test      # 比对
pnpm --filter @ai-duel/client catalog:update    # 重新生成基线
```

### 分片

条目一多，整页一条用例就顶破 CI 快档给每个 job 的 10 分钟（实测已到 9 分多钟），
所以 `catalog.spec.ts` 里按 `SHARDS` 把条目**按排序后的序号轮流发牌**，分成几条互不重叠的用例，
各带一个 `@shard<n>` 标签；CI 按标签把它们分到并行的 job 上（`.github/workflows/ci.yml` 的
`catalog` 那格的 matrix）。本机不加 `--grep` 就是几条依次跑完，总耗时和从前一样：

```bash
pnpm --filter @ai-duel/client catalog:test --grep "@shard1"   # 只跑第一片
```

**改 `SHARDS` 要同时改 ci.yml 和 catalog-baselines.yml 的 matrix**——工作流按标签筛用例，
多出来的那一片会变成「一条用例都没匹配到」而不是失败，静悄悄地少拍一批条目。
不按 `Canvas/*` 和 `UI/*` 分是因为两边条目数差得太远，分完仍然是一片扛住九成的时间。
基线图按 story id 存，和它落在哪一片无关，所以新增条目让分片重新洗牌也不会让任何基线失效。

做法：起一个目录页服务，从 Storybook 自己的 `index.json` 读出全部条目，
对每条打开 `iframe.html?id=<id>&viewMode=story`，等 `[data-story-ready="1"]` 出现之后
拍**这一块**（不是整页），和 `baselines/<平台>/<story id>.png` 逐像素比。
比对用 Playwright 自带的 `toHaveScreenshot`，内部就是 pixelmatch。

条目清单不写死，就是为了「加了组件忘了加条目」查得出来——
手工维护的清单只会跟着一起忘。

一条条目对不上不会打断后面的（用的是 `expect.soft`），一轮跑完能看到全部差异。

确定性靠五件事，缺一条比对就没法用小阈值：

1. 画布条目走手动时钟，按 60fps 的固定步长推到固定时刻；
2. 随机数定种子（命中特效的烟尘方向和大小）；
3. 浏览器的 `deviceScaleFactor` 钉在 1，视口钉在 1280×900；
4. WebGL 走 ANGLE 的 SwiftShader 软件后端，不吃各机器的 GPU 驱动差异；
5. DOM 条目的版式不跟着容器宽度和字体度量走：列数写死（别用 `auto-fill` / `flex-wrap`），
   行高写死（别用 `line-height: normal`），高度也别挂在 `100vh` 这类视口尺寸上。
   这三样都是"差一点就换一种排法"的开关，在哪一档翻面跟着平台走——
   令牌页（`packages/ui/src/tokens.stories.tsx`）就在 linux 上翻过一次，那里有原委。

阈值 `maxDiffPixelRatio` 是 0.001。顶不住了**先查是不是引入了不确定性**
（真实时钟、没定种子的随机、字体没加载完），别先去调大这个数——调大一次就等于把这道检查关掉一点。

### 一条条目老是超时

先分清是**画面还在动**还是**单纯慢**，两种的修法完全相反：

- 画面还在动：`toHaveScreenshot` 要连拍两张一致的才算稳，一直动就永远等不到。
  查这条条目的动画是不是走了 `ctx.animator`——只有它建的补间才会被手动时钟推、也才停得下来，
  自己调 `gsap.to` 或者挂 `requestAnimationFrame` 的话手动时钟按不住它。这种要去修 story，
  调时限没有用。
- 单纯慢：CI 上 WebGL 走的是 SwiftShader（纯 CPU 软件光栅），画布越大、素材越多越慢，
  而 Playwright 判「元素稳定」等的是合成器真出两帧，排在一批没干完的 GPU 活后面就得一起等。
  这种在这条 story 的 `screenshotTimeoutMs` 里单独给个更长的数（现在只有首页那三条有）。

**别为了个别条目去调 `playwright.config.ts` 里的 `expect.timeout`**：那一档是全局的，
调大之后一条真坏掉的条目也要拖满新时限才报错，而快档要跑一百多条，整体时限本来就贴着上限。
更不要去调 `maxDiffPixelRatio`——那和超时是两回事，调它只会把这道检查关掉一点。

### 基线图的文件名

文件名就是 story id，而 id 是 Storybook 拿 `title` 加导出名生成的。
所以这两样**一律用英文**：中文进文件名在各平台上的编码不一致，基线一换机器就对不上。
给人看的中文名写在每条的 `name` 里。

### 改了组件之后

1. 本机跑 `catalog:test`，看差异图确认改动是想要的（失败时 Playwright 会在
   `packages/client/test-results/` 下留「拍到的」「期望的」「差异图」三张）；
2. 确认没问题就按下面「更新基线」把两个平台的基线都重新生成，一起提交。

**两个平台的基线要一起更新**：只提交 darwin 那份的话，本机绿了 CI 照样红——
CI 跑在 Linux 上，比的是 `baselines/linux/`。

### 更新基线

基线按平台分目录：`baselines/darwin/`、`baselines/linux/`。
必须分——字体光栅化在 macOS 和 Linux 上不一样，卡面铭牌和令牌页上的字每个像素都对不齐，
一份基线两个平台一定比不过。所以更新也得分两趟。

**darwin**：本机（macOS）跑一条命令，改动的 png 会直接落在 `baselines/darwin/` 下。

```bash
pnpm --filter @ai-duel/client catalog:update
git status   # 确认只有该变的那几张变了
```

变的图比预期多说明**引入了不确定性**（真实时钟、没定种子的随机、字体没加载完），
先去查那个，别当成"顺手一起更新了"提交上去。

**linux**：本机没有 Linux 机器，靠一条手动触发的工作流去跑，跑完把基线传成 artifact
（见 `.github/workflows/catalog-baselines.yml`；它不往仓库里写，图要人看过再提交）。

```bash
# 1. 触发（也可以在 GitHub 的 Actions 页面点「Run workflow」）
gh workflow run catalog-baselines.yml --ref <你的分支>

# 2. 等它跑完，拿到这次运行的 id
gh run list --workflow=catalog-baselines.yml --limit 1

# 3. 下载覆盖到 linux 基线目录（在仓库根目录跑）
# 基线按分片生成（见下面「分片」），两格的 artifact 都要下，拷进同一个目录。
# 每格传的只有**它这一趟改过的那几张**（工作流拿 git 挑出来的），
# 所以两份直接合并就行，谁先拷谁后拷都一样，不会互相盖。
# 某一片一张都没变时那一格不产出 artifact，下下来只有一份是正常的。
gh run download <run-id> -p 'catalog-baselines-linux-*' -D /tmp/catalog-linux
cp /tmp/catalog-linux/*/*.png packages/client/dev/storybook/baselines/linux/

> 注意：`gh workflow run` 只认**默认分支（main）上已有**的工作流文件，`catalog-baselines.yml`
> 合进 main 之前在分支上调它会得到 404。这段时间的替代做法：让 CI 快档红一次，从它上传的
> `catalog-diff-<片号>` artifact 里取 `<条目 id>-actual.png`，去掉 `-actual` 后缀放进
> `baselines/linux/` 提交即可——那就是 Linux 上实拍的图，和工作流生成的一模一样。

# 4. git status 看一遍，确认变的和 darwin 那趟是同一批条目，然后提交
```

第 4 步那句"同一批条目"是这趟唯一的检查手段：两个平台拍的是同一份代码同一帧，
变的条目**必须**对得上。linux 那边多变了几张，说明有条目在 Linux 上另外有问题
（十有八九是字体），别闷头提交。

### 平台和 CI

CI 快档（`.github/workflows/ci.yml`）那一步分两种走法：

- 有 `baselines/linux/`：正常比对，对不上整步红，同时把「拍到的」和「差异图」
  传成名叫 `catalog-diff` 的 artifact。
- 没有：只生成不比对，把生成的基线传成 `catalog-baselines-linux`，
  再打一条 warning 注解，步骤本身不红。

这个分支是仓库里还没有 linux 基线时留的兜底，现在两份基线都在，走的一直是第一条。

## 已知局限

- **字体**：字体栈里的 EB Garamond 和 Noto Serif SC 从 Google Fonts 拿，目录页没有联网加载它们，
  拍到的是本机兜底的衬线体。所以基线图上的字形跟着机器走——这也是基线必须按平台分目录的
  头号原因。哪天字体改成自带的本地文件，跨平台差异会小很多，但仍然分目录（光栅化本身就不一样）。
- **卡面图集**：图集是构建产物、不进仓库。第一次跑比对时 `ensureAtlas.ts` 会自动打一份；
  换了原画之后要**手动**重跑 `pnpm assets:build` 再更新基线，那一步不自动跟踪原画有没有变。
- **实时那一档拍不了**：截图回归永远走手动时钟那一档，「实时」只给人看。
  也就是说这里拍到的都是动画停下来的样子，**过程**归另一条管：
  `packages/bench/tests/keyframes.spec.ts` 在四段性能剧本的固定帧号上各截一张
  （迁移第 20 条做的），两边容差同口径、基线同样按平台分目录。
- **一条用例包一整片条目**：Playwright 建用例必须在加载测试文件时同步完成，而条目清单要等服务器
  起来才拿得到。所以是几条用例各自在里面遍历一片，报告里看不到「17 条用例」那样的列表。
- **端口写死 6006 / 6007**：被占了会直接失败，不会自动换一个。这是故意的——
  自动换端口的话另一个工作树里开着的目录页会被当成这一个来拍，而且全程没有提示。
