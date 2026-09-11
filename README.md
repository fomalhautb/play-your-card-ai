<h1 align="center">出牌吧，AI！</h1>

<p align="center">这题你AI会吗?</p>

<p align="center">
  <a href="https://playyourcardai.online"><strong>playyourcardai.online</strong></a>
  ·
  <a href="https://playyourcardai.online/info">关于本作</a>
</p>

## 这是什么

一款以「AI 模型的弱点」为核心机制的双人卡牌对战游戏，打开浏览器就能玩，不用装东西也不用注册。

牌分三种：**AI 牌**是一个个真实的 AI 模型，上场后每回合结束都要答一道题，
答错就被罚下，答对留在场上继续滚分；**技能牌**打出即生效，然后进弃牌区；**英雄牌**在开局前选，每人一张。
题目专挑人类一眼看穿、AI 却真会翻车的那种：偏见、幻觉、误判、过度自信、上下文遗忘。

本作起点是 **SheNicest 2026 年 8 月黑客松**的参赛作品（石在 · 司马冰清 · 刘利剑 · 叶丁元），
五天从白纸做到线上能联机。那一版是纯 DOM + GSAP 的前端配一个只转发消息的服务端，
现在这一版是照《正式版架构》整个重写的：Pixi 渲染、服务端跑规则、桌面和手机各出一个壳。

## 目录结构

```
packages/
  core        规则引擎。纯函数、确定性、指令进事件出，不带内容数据，不碰浏览器
  content     内容数据：卡牌、英雄、题库、预生成答案，配 zod schema
  protocol    客户端与服务端之间的消息类型和解析
  design      设计令牌（颜色、间距、时长……），由 Style Dictionary 从 tokens/*.json 生成
  platform    平台能力的接口（存储、音频、全屏、安全区、网络），web / Capacitor 各一套实现
  canvas      Pixi 组件和对局演出编排层（编排层是纯 TS，不碰 Pixi 和 GSAP）
  ui          React 组件库，文字界面用
  client      装配一切：路由、各个界面、联机和单机两条 driver
  server      Cloudflare Worker：房间 DO、大厅 DO、账号（better-auth + D1）
  bench       性能剧本、截图回归、交互回归

apps/
  web         网页壳（Vite）
  steam       Electron 壳，接 steamworks.js
  mobile      Capacitor 壳，出 iOS 和 Android 包

assets/       美术和音频的源，以及打图集的脚本
docs/         架构、部署、设计文档
```

依赖只许单向流动（`core` 最底，`client` 最顶），单文件不超过 400 行，跨包只走包入口。
三条规矩都做成了 lint，细则见 [`docs/正式版架构.md`](docs/正式版架构.md) 第 7 节。

## 怎么跑

```bash
pnpm install
pnpm assets:build       # 打卡面图集、分发界面底图和音频。第一次跑之前必须来一次
pnpm dev                # 网页壳 http://localhost:5174
pnpm dev:server         # 另开一个终端，起 Worker http://localhost:8787（联机才需要）
pnpm storybook          # 组件目录页 http://localhost:6006
```

首页那颗「开始」第一次进站会先走一遍**新手教程**（组牌 → 选英雄 → 一局教学对战，
走完或中途跳过之后就直接进联机房）。菜单里另有 **测试对局**（一个人的调试房，
右下角挂着测试面板）和 **联机对战**（要 `pnpm dev:server`）。

### 本地怎么跑联机

联机要**两个进程**：Vite 发页面，`wrangler dev` 跑权威服务端。
浏览器只连 Vite，`/api`、`/lobby`、`/match/xxxx` 由 Vite 的 `server.proxy` 转给 wrangler
（见 `apps/web/vite.config.ts`）——这样浏览器眼里前后端**同源**，和线上一样，
账号的会话 cookie 才带得上。

第一次要先给服务端配一份本地密钥（这个文件不进仓库）：

```bash
cp packages/server/.dev.vars.example packages/server/.dev.vars
# 把 BETTER_AUTH_SECRET 换成 `openssl rand -base64 32` 的输出；DEV=1 那行留着
```

然后两个终端各起一个（`pnpm dev:server` 会自己先把账号库的表建好），
打开 http://localhost:5174/ 点「联机对战」。进站会自动开一个游客账号（不用注册），
房间页上「匹配 / 开房 / 加入」三条路都通到同一个房间。**两个人要用两个浏览器**
（或者一个无痕窗口）：账号的会话在 cookie 里，同一个浏览器里两个标签页是同一个账号，
第二个会被服务端当成第一个人重连、把第一条连接顶掉。

### 开发页

调试场景放在开发专用页面上（架构 7.2 第 5 条，生产构建剔除）：

| 地址 | 怎么起 | 看什么 |
|---|---|---|
| http://localhost:5174/dev | `pnpm dev` | 开发页索引 |
| http://localhost:5174/dev/duel | `pnpm dev` | 对局场景：切效果档位、看渲染计数和帧率 |
| http://localhost:6006 | `pnpm storybook` | 组件目录页：所有组件、变体、状态 |

组件目录页还是截图回归的输入：每个条目截一张图，样式改动在这里暴露（架构 6.6、6.8）。
怎么加条目、怎么更新基线、CI 怎么比对，见
[`packages/client/dev/storybook/README.md`](packages/client/dev/storybook/README.md)。

## 怎么测

```bash
pnpm typecheck          # 全仓类型检查
pnpm lint               # Biome + dependency-cruiser + knip，任一红则红
pnpm lint:fix           # 能自动修的都修掉（格式、import 排序）
pnpm test               # 单元测试：core 规则和回放 golden、内容覆盖、协议、演出编排、几何与判定
pnpm size               # 包体上限（size-limit）

pnpm --filter @ai-duel/bench interaction          # 对局场景的交互回归（真指针拖拽出牌）
pnpm --filter @ai-duel/client catalog:test        # 组件目录页截图回归
pnpm --filter @ai-duel/bench keyframes            # 剧本关键帧截图回归
pnpm --filter @ai-duel/client e2e                 # 端到端：单机一条，联机两条
```

lint 的三件工具各管一摊：Biome 管格式和单文件行数，dependency-cruiser 管包之间的依赖方向，
knip 管没人用的导出和依赖。

CI 分两档（架构 6.1）：快档 [`ci.yml`](.github/workflows/ci.yml) 每个 PR 都跑
（类型 / lint / 单元测试 / 包体，加上三组开浏览器的截图和交互回归，拆成并行 job）；
慢档 [`slow.yml`](.github/workflows/slow.yml) 跑性能指标、三浏览器一致性、端到端、四端构建。
部署是第三条流水线 [`deploy.yml`](.github/workflows/deploy.yml)，合并 main 就上线。

## 卡面图集

卡面原画不直接进画布，先打成 spritesheet（架构 3.4）。管线用 PixiJS 官方的
[AssetPack](https://pixijs.io/assetpack/)，配置和脚本在 `assets/`：

```bash
pnpm assets:build
```

它做四件事：把 `assets/source/cards` 下的原画统一缩到 512×768、
按 `models` / `skills` / `backs` 三组各打一张图集（页面 2048×2048，输出 webp）、
把产物复制到 `apps/web/public/atlas/` 和 `packages/bench/public/atlas/`，
再把界面底图和音频原样复制到 `apps/web/public/` 下（音频落在 `audio/music/`）。
三组分开打是为了按场景装卸——对局只要 models 和 backs。

全部素材的源在 `assets/source/`，产物（`assets/dist/` 和 `apps/web/public/` 整个目录）
都在 `.gitignore` 里：源头是那些原画和音频，随时能重打，进仓库只会让每次改图都变成
一次几兆的 diff。换了原画、加了新卡、改了图集参数之后重跑一次即可。
详见 [`assets/README.md`](assets/README.md)。

## 文档

| 文档 | 写的是什么 |
|---|---|
| [`docs/正式版架构.md`](docs/正式版架构.md) | 需求、选型、包结构、纪律、迁移顺序。**架构以它为准** |
| [`docs/deploy.md`](docs/deploy.md) | 线上怎么跑起来：域名、Durable Object、免费额度、账号库、自动部署 |
| [`packages/protocol/README.md`](packages/protocol/README.md) | 电线上的消息长什么样、序号怎么算、断线怎么补 |
| [`packages/core/README.md`](packages/core/README.md) | 规则引擎的约定和边界，隐藏信息怎么守 |
| [`docs/AI卡牌对战游戏_游戏机制与流程_V0.3.md`](docs/AI卡牌对战游戏_游戏机制与流程_V0.3.md) | 游戏规则本身 |
| [`docs/design/组件需求单.md`](docs/design/组件需求单.md) | 组件库的需求输入：按钮、边框、面板、弹窗的编号变体 |
| [`docs/legacy/architecture.md`](docs/legacy/architecture.md) | 黑客松版的架构说明，**已废弃**，只作存档 |
