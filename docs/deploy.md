# 部署说明

> 这份文档写的是**线上怎么跑起来**：域名、Durable Object、免费额度、账号库、自动部署。
> 电线上的消息长什么样、序号怎么算、断线怎么补，以 `packages/protocol/README.md` 为准；
> 服务端自己的目录结构、本地开发和测试见 `packages/server/README.md`。

## 1. 一个 Worker 干两件事

整个项目部署成 **Cloudflare 上的一个 Worker**：

```
                    https://playyourcardai.online
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
      静态资源层（免费、不计 Worker 调用）        Worker 脚本
      /  /assets/*  以及匹配不到的路径            /api/auth/*    账号（better-auth + D1）
      → apps/web/dist                            /lobby         WebSocket 升级（大厅）
                                                 /match/:code   WebSocket 升级（房间）
                                                      │
                                                 Durable Object
                                                 大厅一个全局实例
                                                 房间一个房间码一个实例
```

前端和服务端同域名，所以客户端连 WebSocket 直接用相对路径（`/match/1234`），
线上不依赖 CORS，也不需要维护第二个服务的地址。账号的会话 cookie 也是靠同源才带得上——
本地开发那边为此专门用 Vite 的 `server.proxy` 把两边并成一个源（见 `apps/web/vite.config.ts`）。

选 Cloudflare 的原因就一条：**免费档能挂长连接且不休眠**。
常见的免费 PaaS（Render、Fly 之类）在免费档上会把闲置的实例睡掉，
第一个玩家建完房等对手的那几分钟正好把自己等没了。

## 2. 域名怎么接的

`playyourcardai.online` 在 Namecheap 注册，NS 指到 Cloudflare
（`clayton.ns.cloudflare.com` / `hazel.ns.cloudflare.com`），
zone 就建在跑这个 Worker 的同一个 Cloudflare 账号下。

裸域和 `www` 两个 hostname 都是 **Workers Custom Domain**，直接挂在 Worker 上，
不经过任何反向代理。DNS 记录和边缘证书由 Cloudflare 自动创建和续期，
仓库里唯一要写的就是 `wrangler.jsonc` 的 `routes`：

```jsonc
"routes": [
  { "pattern": "playyourcardai.online", "custom_domain": true },
  { "pattern": "www.playyourcardai.online", "custom_domain": true }
]
```

Worker 原本的 `ai-duel.<你的账号>.workers.dev` 地址**已经停用**：配置里声明了
`routes` 之后，wrangler 部署时会默认关掉 workers.dev 路由（部署日志里有对应警告）。
不恢复它是有意的——**国内 DNS 会污染 `workers.dev`**，买域名就是为了绕开这一点，
留着旧地址只会多一个不可用的入口。真要恢复的话在 `wrangler.jsonc` 里加
`"workers_dev": true` 即可。

## 3. 房间码就是 Durable Object 的名字

服务端不需要自己维护一张全局房间表，「房间」这个概念直接落到了基础设施上：

- `env.MATCH_ROOM.getByName("1234")` 拿到名字叫 `1234` 的那个实例，
  **同一个码永远路由到同一个实例**，不管请求从哪个机房进来。
- 一个房间的两条 WebSocket 一定落在同一个实例里，权威局面也存在这个实例自己的 SQLite 里。
- 大厅相反，是 **全局单实例**（`getByName('global')`，见 `src/lobby/naming.ts`）：
  队列要凑一对人，切成多个实例等于把队列切碎，人一少就永远配不上。

摇码的是大厅（`src/lobby/queue.ts`）：随机四位数字，在自己那张「在用的房间码」表里查重，
连撞十次就回 `no-room-code`。房间收摊时调 `release` 把那一行删掉，码就回到池子里。

## 4. 为什么一定要 WebSocket Hibernation

接受连接时用的是 `ctx.acceptWebSocket(server)`，**不是** `server.accept()`。差别很大：

| | `server.accept()` | `ctx.acceptWebSocket()` |
|---|---|---|
| 空闲时 Durable Object | 一直活着 | 休眠，从内存里卸掉 |
| 空闲时计费 | 一直按时长计 | 不计 |
| 休眠期间的连接 | —— | 不断开，客户端无感 |
| 有消息进来 | 直接进回调 | 唤醒实例，重跑构造函数，再进回调 |

一局牌里大部分时间是玩家在思考，没有任何消息。用 `server.accept()` 的话这段时间会一直烧
免费档那 13,000 GB-s/天的时长额度；用休眠就是零消耗。**这是免费档跑得起来的直接原因。**

代价是「实例被唤醒时构造函数会重跑」，所以**不能把状态放在实例的字段里**。
本项目的做法是类上一个字段都不留：谁连着现查 `ctx.getWebSockets()`，
权威局面和成员关系现查这个实例自己的 SQLite（`src/room/state.ts`）。

心跳也顺手交给运行时：`ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`
让运行时直接回 `pong`，休眠中的实例不会被心跳唤醒。客户端定期发 `ping` 保活即可。
自动应答只认逐字节相等的裸字符串，所以协议里 `ping` / `pong` 特意不是 JSON。

## 5. 协议和断线重连

这两件事整个写在 `packages/protocol/README.md` 里，不在这儿重复：
消息清单、`Sec-WebSocket-Protocol` 里怎么带 JWT、序号怎么算、漏包和重连怎么要快照、
每批事件为什么都带一份视图。客户端那半边在 `packages/client/src/net/`
（`session.ts` 管握手和心跳，`roomClient.ts` / `lobbyClient.ts` 各管一条连接）。

和**部署**有关的只有两条，别的都是协议的事：

- **被拒绝的连接也要先握手成功。** 浏览器的 `WebSocket` 拿不到失败握手的响应体和状态码，
  「房间满了」还是「token 过期了」就没地方说。所以服务端一律先把 101 回出去、
  发一条 `session:rejected` 说明原因、再带着关闭码关掉（`src/net/session.ts` 的 `rejectUpgrade`）。
  客户端因此**不能一看到 `open` 就当进房成功了**，要等第一条消息。
- **WebSocket 升级请求必须能进到 Worker。** 见第 10 节那两条坑（SPA 回退和导航请求）。

## 6. 免费档够不够用

| 额度 | 免费档 | 这个项目怎么花 |
|---|---|---|
| 请求数 | 10 万次/天 | 每条 WebSocket 升级 1 次（大厅一条、房间一条），账号登录 1 次 |
| WebSocket 入站消息 | 按 **20 条消息折算 1 次请求** | 一局牌几百条消息 = 十几次请求 |
| WebSocket 出站消息 | **不计费** | 发下去的那一半白送 |
| CPU 时长 | 13,000 GB-s/天 | 休眠期间不算，实际只有 `execute` 和裁剪视图那几毫秒 |

静态资源本身**完全不计费**，也不占 Worker 调用数（前提是请求没有被 `run_worker_first` 拉进 Worker）。
页面请求就属于这一类：`run_worker_first` 里只有 `/api/*`、`/match/*`、`/lobby` 三条，
前端路由（`/`、`/room`、`/deck`、`/match`……）全部由资源层直接回 index.html。

结论：现在这个量级离额度上限差着好几个数量级。

## 7. 账号库（D1）

账号是 better-auth 配 Cloudflare D1（《正式版架构》5.5，迁移第 25 条），
挂在同一个 Worker 的 `/api/auth/*` 下面，绑定名 `AUTH_DB`。
用 D1 而不是再开一个 Durable Object：账号是全局要查的关系型数据，
而 DO 的 SQLite 是一个实例一份，天然做不了跨实例查询。

**合并这条改动之前，仓库的主人要先做两件事**（都需要 Cloudflare 凭据，别人代劳不了）：

```bash
cd packages/server

# 1) 建库。输出里的 database_id 填进 wrangler.jsonc 的 d1_databases
#    （现在那里是占位符 "<待用户 wrangler d1 create 后填写>"）
npx wrangler d1 create ai-duel-auth

# 2) 生成并写入 better-auth 的主密钥（签会话 cookie、加密 JWT 私钥）
openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
```

建表不用手动跑：`deploy.yml` 里在部署前有一步
`wrangler d1 migrations apply AUTH_DB --remote`，语句在 `packages/server/migrations/`。
这条命令是幂等的，wrangler 按 `d1_migrations` 表记账，跑过的不会再跑。
顺序不能反——新代码一上线就会去查那几张表，表还没建的话第一个来登录的人直接报 500。

`BETTER_AUTH_SECRET` **换掉就等于把已经生成的 JWT 私钥变成一坨解不开的东西**
（它是拿这个密钥加密存在 `jwks` 表里的）。真要换，得连那张表一起清掉让它重新生成，
代价是所有已经发出去的 JWT 立刻作废，玩家重新登录一次。

D1 免费档是 5GB 存储、每天 500 万行读 / 10 万行写。一个游客账号占三四行，
握手验签那条查询还带一分钟的内存缓存（`src/auth/verify.ts`），离上限差得远。

## 8. Steam 登录（迁移第 35 条）

Steam 版的壳（`apps/steam`）用 Steam 客户端给的**会话票据**换账号会话，
服务端拿票据去问 Valve「这张票是谁的」（`packages/server/src/auth/steamTicket.ts`）。
网页版和手机版用不到它，不配也不影响部署。

**要真的验票据，仓库的主人得先做两件事**（都要 Steamworks 后台的权限，别人代劳不了）：

```bash
cd packages/server

# 1) 发行商 Web API 密钥。Steamworks 后台 → 用户与权限 → 管理 Groups →
#    你的发行商组 → 「Web API 密钥」。**不是**个人的那把 Steam Web API key，
#    个人密钥调 AuthenticateUserTicket 会被拒。
npx wrangler secret put STEAM_WEB_API_KEY

# 2) 这个游戏的 appId。不是凭据，但走同一条路最省事（生成的 Env 类型看不见它，
#    见 packages/server/env.d.ts）。不配的话默认是 480（Valve 的 SpaceWar 试验田）。
npx wrangler secret put STEAM_APP_ID
```

`STEAM_APP_ID` **两处要填同一个数**：这里一份，壳那边的环境变量一份
（见 `apps/steam/README.md`）。验票据时 Valve 会拿 appId 比对，对不上整张票作废。

没配 `STEAM_WEB_API_KEY` 时的行为按环境分（`src/auth/steamTicket.ts` 里那张表）：
本地开发（`.dev.vars` 里有 `DEV=1`）走「任何票据都收，steamId 由票据算出来」，
**线上一律拒绝**——失败关闭，漏配的后果是「谁都登不进来」，
而不是「随便递一段字符串就是一个新账号」。

所以这两条 secret 是**可选的**：不配，线上的 Steam 登录就是关着的，游客登录照常。

## 9. 自动部署

`.github/workflows/deploy.yml`：push 到 `main` 或者手动触发 → 装依赖 →
`pnpm assets:build` → `pnpm --filter @ai-duel/web build` → 应用账号库迁移 →
在 `packages/server` 里跑 `wrangler deploy`。

**必须先构建前端**：`wrangler.jsonc` 里 `assets.directory` 指向 `../../apps/web/dist`，
而 `dist/` 是 gitignore 掉的，仓库里没有这个目录。
`assets:build` 那一步同理——卡面图集和界面底图落在 `apps/web/public` 下，也是产物、也不进仓库，
少了它构建照样成功，但页面起来是一片空白。

需要在仓库的 Settings → Secrets and variables → Actions 里配**一个** secret：

| Secret | 从哪来 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | https://dash.cloudflare.com/?to=/:account/api-tokens → Create Token → Custom 里选 "Edit Cloudflare Workers" 模板 |

账户 ID 不用配成 secret，它已经写在 `wrangler.jsonc` 的 `account_id` 里了——
那是个标识符，不是凭据，没有 token 拿着它什么也做不了。

"Edit Cloudflare Workers" 模板不一定带 Zone/DNS 权限。万一部署卡在挂 custom domain 那一步报权限
错误，给 token 补上 Zone/DNS 权限，或者把 `wrangler.jsonc` 里的 `routes` 删掉——
域名已经在 Cloudflare 服务端挂好了，删掉不会解绑。

没配 secret 时工作流会**跳过部署并显示成功**，不会变红。这样别人 fork 这个仓库不会看到一片红。

## 10. 踩过的坑

**`exports` 取代了旧的 `migrations` 数组。**
老教程里的 `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["MatchRoom"] }]` 是旧写法，
现在直接在 `exports` 里声明。两者**只能二选一**：同时写上，wrangler 会报
「`migrations` and `exports` are mutually exclusive」直接拒绝部署。

```jsonc
"exports": {
  "MatchRoom": { "type": "durable-object", "storage": "sqlite" },
  "Lobby": { "type": "durable-object", "storage": "sqlite" }
}
```

**删掉一个 Durable Object 类要留墓碑。**
只把那一行从 `exports` 里删掉是不够的——命名空间已经在 Cloudflare 那边建出来了，
配置里突然没有它，wrangler 只会报「有命名空间没有对应的类」。
正确写法是把那一项改成 `state: "deleted"`（旧写法里对应的是 `migrations` 的 `deleted_classes`）：

```jsonc
"exports": {
  "Room": { "type": "durable-object", "state": "deleted" }
}
```

**这条墓碑正是本仓库现在的状态。** 黑客松那版纯转发器的 `Room` 类已经随迁移第 38 条删掉，
`wrangler.jsonc` 里给它留了一条 `state: "deleted"`。

> ⚠️ **合并第 38 条之后的第一次部署，会把线上旧房间那个 Durable Object 命名空间
> 连同里面的全部数据一起删除，不可恢复。** 那里面只有黑客松版转发器的房间，
> 没有账号、没有牌组存档（账号在 D1、存档在玩家浏览器本地），所以这是预期内的。
> 部署那一刻正在旧客户端里打的房间会当场断开。

墓碑要**一直留着**，别在后面的 PR 里当成垃圾清掉：删掉那一行等于告诉 Cloudflare
「这个类又回来了」，下次部署它会去找一个已经不存在的导出。

**免费档只有 SQLite 后端的 Durable Object。** `storage` 必须写 `"sqlite"`，
写成 KV 后端在免费账号上会直接部署失败。

**SPA 回退会把 Worker 整个吃掉。**
`not_found_handling: "single-page-application"` 的意思是「匹配不到静态资源就回 index.html」，
而它比 Worker 优先——结果 `/api/auth/*` 和 WebSocket 升级请求全都拿到一份 index.html。
要 Worker 处理的路径必须在 `assets.run_worker_first` 里显式列出来：

```jsonc
"run_worker_first": ["/api/*", "/match/*", "/lobby"]
```

前端的对局页路由是 `/match`（不带房间码），落不进 `/match/*`，仍然由资源层回 index.html。
房间的 WebSocket 端点必然带四位房间码，两者因此分得干干净净，
页面请求一次 Worker 调用都不用花。

**导航请求不会调用 Worker。**
`compatibility_date >= 2025-04-01` 之后，浏览器地址栏跳转产生的请求
（带 `Sec-Fetch-Mode: navigate` 头）会绕过 Worker 脚本，直接由静态资源层处理——
Cloudflare 这么做是为了少算一次计费调用。
WebSocket 升级请求不是导航请求，所以能正常进到 Worker。
上面 `run_worker_first` 里列出来的路径不受这条影响。

## 11. 本地跑和验证

```bash
cp packages/server/.dev.vars.example packages/server/.dev.vars   # 第一次：填 BETTER_AUTH_SECRET
# 第一次还要把本地那个 D1 库的表建起来（库在 packages/server/.wrangler/ 下面，不进仓库）
pnpm --filter @ai-duel/server exec wrangler d1 migrations apply AUTH_DB --local
pnpm dev:server                         # wrangler dev，默认 http://127.0.0.1:8787
```

**本地联调不走 `wrangler dev` 发静态资源**：前端起自己的 Vite（`pnpm dev`），
由它的 `server.proxy` 把 `/api`、`/lobby`、`/match/xxxx` 转给 8787，
浏览器眼里前后端同源，账号的会话 cookie 才带得上（见仓库根 README 的「本地怎么跑联机」）。
只有要验「线上那条路」——静态资源回退、`run_worker_first` 到底拦没拦住——才需要先
`pnpm assets:build && pnpm --filter @ai-duel/web build`，再**直接**起
`pnpm --filter @ai-duel/server exec wrangler dev` 去访问 8787。
这一步不能用 `pnpm dev:server`：那个脚本带着 `--assets ../../apps/web/public`，
发的不是刚构建出来的 `apps/web/dist`（原因见 `packages/server/README.md` 的「本地开发」）。

部署前想确认配置没写错，跑一次不真的上传的构建：

```bash
cd packages/server && npx wrangler deploy --dry-run
```

`BETTER_AUTH_SECRET` 是账号系统的主密钥（见第 7 节），`.dev.vars` 不进仓库。
房间和大厅要靠它验握手那张 JWT（`src/auth/verify.ts`），少了它谁也握不上手。

服务端自己的测试不用先起 `wrangler dev`——它跑在 `@cloudflare/vitest-pool-workers`
起的 workerd 里（Durable Object、SQLite、Hibernation、D1 都是真的那一套），
`pnpm --filter @ai-duel/server test` 就够，已经在 CI 的快档里。
真的把两个客户端连起来打一局是端到端那档：`pnpm --filter @ai-duel/client e2e`。

改了 `wrangler.jsonc` 里的绑定之后要重新生成 `Env` 类型：

```bash
pnpm --filter @ai-duel/server types
```
