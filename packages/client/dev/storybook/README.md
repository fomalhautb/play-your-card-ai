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

做法：起一个目录页服务，从 Storybook 自己的 `index.json` 读出全部条目，
对每条打开 `iframe.html?id=<id>&viewMode=story`，等 `[data-story-ready="1"]` 出现之后
拍**这一块**（不是整页），和 `baselines/<平台>/<story id>.png` 逐像素比。
比对用 Playwright 自带的 `toHaveScreenshot`，内部就是 pixelmatch。

条目清单不写死，就是为了「加了组件忘了加条目」查得出来——
手工维护的清单只会跟着一起忘。

一条条目对不上不会打断后面的（用的是 `expect.soft`），一轮跑完能看到全部差异。

确定性靠四件事，缺一条比对就没法用小阈值：

1. 画布条目走手动时钟，按 60fps 的固定步长推到固定时刻；
2. 随机数定种子（命中特效的烟尘方向和大小）；
3. 浏览器的 `deviceScaleFactor` 钉在 1，视口钉在 1280×900；
4. WebGL 走 ANGLE 的 SwiftShader 软件后端，不吃各机器的 GPU 驱动差异。

阈值 `maxDiffPixelRatio` 是 0.001。顶不住了**先查是不是引入了不确定性**
（真实时钟、没定种子的随机、字体没加载完），别先去调大这个数——调大一次就等于把这道检查关掉一点。

### 基线图的文件名

文件名就是 story id，而 id 是 Storybook 拿 `title` 加导出名生成的。
所以这两样**一律用英文**：中文进文件名在各平台上的编码不一致，基线一换机器就对不上。
给人看的中文名写在每条的 `name` 里。

### 改了组件之后

1. 本机跑 `catalog:test`，看差异图确认改动是想要的（失败时 Playwright 会在
   `packages/client/test-results/` 下留「拍到的」「期望的」「差异图」三张）；
2. 确认没问题就跑 `catalog:update` 重新生成，把 `baselines/darwin/` 下变了的图一起提交。

### 平台和 CI

基线按平台分目录：`baselines/darwin/`、`baselines/linux/`。
必须分——字体光栅化在 macOS 和 Linux 上不一样，卡面铭牌和令牌页上的字每个像素都对不齐，
一份基线两个平台一定比不过。

**现在仓库里只有 `darwin/`。** 拍板时本机的 Docker 守护进程没跑起来，
没法用官方的 `mcr.microsoft.com/playwright` 镜像现场生成一份 linux 基线。
所以 CI 快档那一步是这么写的（见 `.github/workflows/ci.yml`）：

- 有 `baselines/linux/`：正常比对，对不上整步红。
- 没有：只生成不比对，把生成的基线传成名叫 `catalog-baselines-linux` 的 artifact，
  同时打一条 warning 注解，步骤本身不红。

**怎么补上 linux 基线**（做完之后 CI 就开始真的比对）：

1. 在 GitHub 上打开这个 PR 的 CI 快档那次运行，从底部的 Artifacts 里下载 `catalog-baselines-linux`；
2. 解压，把里面的 png 全部放到 `packages/client/dev/storybook/baselines/linux/`；
3. 提交。下一次 CI 就会走比对那条路。

有 Linux 机器或者 Docker 的话也可以本机生成，命令是同一条：
`pnpm --filter @ai-duel/client catalog:update`（在 Linux 上跑就落到 `baselines/linux/`）。

## 已知局限

- **字体**：字体栈里的 EB Garamond 和 Noto Serif SC 从 Google Fonts 拿，目录页没有联网加载它们，
  拍到的是本机兜底的衬线体。所以基线图上的字形跟着机器走——这也是基线必须按平台分目录的
  头号原因。哪天字体改成自带的本地文件，跨平台差异会小很多，但仍然分目录（光栅化本身就不一样）。
- **卡面图集**：图集是构建产物、不进仓库。第一次跑比对时 `ensureAtlas.ts` 会自动打一份；
  换了原画之后要**手动**重跑 `pnpm assets:build` 再更新基线，那一步不自动跟踪原画有没有变。
- **实时那一档拍不了**：截图回归永远走手动时钟那一档，「实时」只给人看。
  也就是说动画**过程**没有回归保护，只有它停在某一帧的样子有。要保护过程得截关键帧序列，
  那是 6.6 里性能剧本那条路的事（迁移第 20 条）。
- **一条用例包全部条目**：Playwright 建用例必须在加载测试文件时同步完成，而条目清单要等服务器
  起来才拿得到。所以是一条用例在里面遍历，报告里看不到「17 条用例」那样的列表。
- **端口写死 6006 / 6007**：被占了会直接失败，不会自动换一个。这是故意的——
  自动换端口的话另一个工作树里开着的目录页会被当成这一个来拍，而且全程没有提示。
