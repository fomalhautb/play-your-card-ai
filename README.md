<h1 align="center">出牌吧，AI！</h1>

<p align="center">这题你AI会吗?</p>

<p align="center">
  <a href="https://playyourcardai.online"><strong>playyourcardai.online</strong></a>
  ·
  <a href="https://playyourcardai.online/info">关于本作</a>
</p>

<p align="center">
  <img src="docs/screenshots/home.jpg" alt="出牌吧！AI！首页" width="880">
</p>

## 这是什么

一款以「AI 模型的弱点」为核心机制的双人卡牌对战游戏，打开浏览器就能玩，不用装东西也不用注册。

牌分三种：**AI 牌**是一个个真实的 AI 模型，上场后每回合结束都要答一道题，
答错就被罚下，答对留在场上继续滚分；**技能牌**打出即生效，然后进弃牌区；**英雄牌**在开局前选，每人一张。
题目专挑人类一眼看穿、AI 却真会翻车的那种：偏见、幻觉、误判、过度自信、上下文遗忘。

### 对局界面

<p align="center">
  <img src="docs/screenshots/battle.jpg" alt="对局界面" width="880">
</p>


### 匹配房

<p align="center">
  <img src="docs/screenshots/room.jpg" alt="匹配房界面" width="880">
</p>

### 组建牌组

<p align="center">
  <img src="docs/screenshots/deck.jpg" alt="组建牌组界面" width="880">
</p>

## 黑客松

本作是 **SheNicest 2026 年 8 月黑客松**的参赛作品。
从一张白纸到线上能联机对战的完整成品——规则、美术、前端、部署——全部在**五天之内**完成。

## 团队

石在 · 司马冰清 · 刘利剑 · 叶丁元

## 开始

线上跑的是 `packages/legacy-client`（黑客松版）。要在本地打它，
先在 `packages/legacy-client/.env.local` 里设
`VITE_SERVER_URL=http://127.0.0.1:8787` 让前端连得到转发器。

```bash
pnpm install
pnpm dev:legacy         # 黑客松版客户端 http://localhost:5173
pnpm dev                # 正式版网页壳 apps/web http://localhost:5174（三个入口：测试对局、热座、联机）
pnpm dev:server         # 另开一个终端，起 Worker http://localhost:8787
pnpm storybook          # 组件目录页 http://localhost:6006
pnpm typecheck          # 全仓类型检查
pnpm lint               # Biome + dependency-cruiser + knip，任一红则红
pnpm lint:fix           # 能自动修的都修掉（格式、import 排序）
pnpm test               # 单元测试：core 规则、答题剧本、canvas 的扇形几何与拖拽判定
pnpm assets:build       # 打卡面图集（第一次跑正式版开发页之前要先来一次）

pnpm --filter @ai-duel/client e2e   # 端到端：单机一条，联机两条（两个浏览器打完整局、掉线重连）
```

### 本地怎么跑联机

联机要**两个进程**：Vite 发页面，`wrangler dev` 跑权威服务端。
浏览器只连 Vite，`/api`、`/lobby`、`/match/xxxx` 由 Vite 的 `server.proxy` 转给 wrangler
（见 `apps/web/vite.config.ts`）——这样浏览器眼里前后端**同源**，和线上一样，
账号的会话 cookie 才带得上。

第一次要先给服务端配一份本地密钥（这个文件不进仓库）：

```bash
cp packages/server/.dev.vars.example packages/server/.dev.vars
# 把 BETTER_AUTH_SECRET 换成 `openssl rand -base64 32` 的输出；DEV=1 那行留着
pnpm --filter @ai-duel/legacy-client build   # wrangler 的 assets.directory 指着它，不建起不来
```

然后两个终端各起一个：

```bash
pnpm dev:server   # 先建账号库的表，再 wrangler dev（http://127.0.0.1:8787）
pnpm dev          # http://localhost:5174
```

打开 http://localhost:5174/ 点「联机对战」。进站会自动开一个游客账号（不用注册），
房间页上「匹配 / 开房 / 加入」三条路都通到同一个房间。**两个人要用两个浏览器**
（或者一个无痕窗口）：账号的会话在 cookie 里，同一个浏览器里两个标签页是同一个账号，
第二个会被服务端当成第一个人重连、把第一条连接顶掉。

CI 快档跑这三条（typecheck / lint / test），外加组件目录页的截图回归，见
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)。lint 的三件工具各管一摊：
Biome 管格式和单文件行数，dependency-cruiser 管包之间的依赖方向，knip 管没人用的导出和依赖。
冻结的 `legacy-client` 三个都不看，但它的 typecheck 和测试照跑。

### 正式版现在能玩到哪一步

首页（http://localhost:5174/）上三个入口都通到真对局：
「测试对局」是一个人的调试房，右下角挂着测试面板（加牌、代对手出牌、跳到答题）；
「热座」是一台机器两个人轮流出牌（第 21 条）；
「联机对战」是真的联机——游客登录、大厅发码、权威服务端跑规则（第 27 条，
怎么起两个进程见上面「本地怎么跑联机」）。
房间页现在是最小可用版（三颗钮、一块码、一颗准备），选牌选英雄用的是存档里那一套；
真首页、牌组页、英雄页、教程分别是第 28~32 条的事。

### 开发页

调试场景放在开发专用页面上（架构 7.2 第 5 条，生产构建剔除）：

| 地址 | 怎么起 | 看什么 |
|---|---|---|
| http://localhost:5174/dev | `pnpm dev` | 开发页索引 |
| http://localhost:5174/dev/duel | `pnpm dev` | 对局场景：切效果档位、看渲染计数和帧率（迁移第 18、21 条） |
| http://localhost:6006 | `pnpm storybook` | 组件目录页：所有组件、变体、状态（迁移第 10 条，架构 7.1 第 3 条） |

对局和目录页都要加载卡面图集，所以先跑一次 `pnpm assets:build`，否则画面上一张牌都没有。

组件目录页还是截图回归的输入：每个条目截一张图，样式改动在这里暴露（架构 6.6、6.8）。
怎么加条目、怎么更新基线、CI 怎么比对，见
[`packages/client/dev/storybook/README.md`](packages/client/dev/storybook/README.md)。

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
三个 public 目录的关系见 `assets/README.md`。

## 技术栈

TypeScript + pnpm monorepo，三个包：`core` 是纯规则引擎（无渲染、无 IO），
`legacy-client` 是 Vite + React + GSAP（全部是 DOM，没有画布），
`server` 是一个 Cloudflare Worker，同时干「转发房间消息」和「托管前端静态资源」两件事，
房间状态放在 Durable Object 里。选 Cloudflare 的原因只有一条：免费档能挂长连接且不休眠。

正式版正在重写，包结构以 [`docs/正式版架构.md`](docs/正式版架构.md) 第 7.2 节为准：
`packages/` 下拆成 core、content、protocol、design、platform、canvas、ui、client、server、bench，
`apps/` 下是 web、steam、mobile 三个壳。
上面那个 `legacy-client` 是冻结的黑客松版，不再加功能，
只作为新版的行为规格保留（动画时长、节奏、演出顺序从它那里抄），等正式版追平后整包删掉。
