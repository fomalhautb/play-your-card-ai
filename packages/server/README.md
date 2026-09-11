# @ai-duel/server

Cloudflare Worker 加 Durable Object。一个脚本里**并排跑着两套服务端**：

| | 路径 | DO 绑定 | 目录 | 状态 |
|---|---|---|---|---|
| 旧转发器 | `/api/room`、`/room/:code` | `ROOM` → `Room` | `src/legacy/` | 冻结，线上还在用 |
| 新房间 | `/match/:code` | `MATCH_ROOM` → `MatchRoom` | `src/room/` | 在写 |
| 新大厅 | `/lobby` | `LOBBY` → `Lobby` | `src/lobby/` | 在写 |
| 账号 | `/api/auth/*` | `AUTH_DB`（D1，不是 DO） | `src/auth/` | 在写 |

旧的是黑客松那版**纯消息转发器**：没有权威状态，规则跑在房主客户端里。
线上的 legacy-client 仍然靠它打联机，`deploy.yml` 每次合并 main 就部署，
所以在《正式版架构》迁移第 38 条（删掉 legacy-client）之前，
`src/legacy/` 里**一行行为都不要改**——类名 `Room` 和绑定名 `ROOM` 更不能改，
Durable Object 是按类名找实例的。

新的是**权威服务端**（需求第 6 条）：规则只在服务端跑，客户端只发指令、
只收过了 `filterEvent` 的事件和自己那份裁剪视图。两套互不相干，各走各的路径和绑定。

部署、域名、免费额度、Hibernation 的取舍写在 `docs/deploy.md`。
电线上的消息长什么样、序号怎么算、JWT 怎么带，全部以 `packages/protocol/README.md` 为准。

## 目录

```
src/
  index.ts            总路由：旧路径进 legacy，/api/auth/* 进账号系统，
                      /match/:code 和 /lobby 进新代码，其余交静态资源
  devMode.ts          「现在跑的是不是本地开发」这一个判断（判据是 .dev.vars 里的 DEV）
  auth/
    betterAuth.ts     账号系统：better-auth 配 D1，开了游客登录和 jwt 两个插件
    routes.ts         /api/auth/* 原样交给 better-auth 的 handler
    verify.ts         验握手那张 JWT 认出 userId：从 D1 读公钥，带缓存
  net/session.ts      大厅和房间共用的连接层：附件、发消息、101 回显、顶号、session:hello
  legacy/
    room.ts           旧转发器的 Room 类（冻结）
    routes.ts         旧转发器的两条 HTTP 路由（冻结）
  room/
    MatchRoom.ts      房间 DO：连接生命周期 + 消息分发 + alarm 回调，不留任何内存状态
    session.ts        房间特有的连接细节：座位标签、按座位发、座位在不在线
    state.ts          SQLite：房间成员关系一行、权威 GameState 一行、两个定时任务的到点时刻一行
    membership.ts     room:loadout / ready / leave / resync / urge、双方就绪后开局、三种建房方式
    commands.ts       match:command：核座位 → execute → 存盘 → 分发
    dispatch.ts       一批事件 → 每座位 filterEvent + viewFor + stripCatalog → match:events
    alarms.ts         一个 DO 只有一个 alarm，两件定时的事怎么共用它
    autopilot.ts      答题：题目揭晓就排 alarm，到点算出该发的 SUBMIT_ANSWERS
    lifecycle.ts      收摊（三种 reason 一个出口）和空房超时
  lobby/
    Lobby.ts          大厅 DO：全局单实例，连接生命周期 + 消息分发 + release RPC
    naming.ts         大厅的实例名和连接标签（单独一份，免得房间反过来 import 大厅那个类）
    queue.ts          SQLite：匹配队列一张表、在用的房间码一张表、摇码
    handlers.ts       五条 lobby:* 消息各自怎么办
test/
  setup.ts            每个测试文件开跑前：建账号库的表、预先生成签名密钥
  accounts.ts         真的走 /api/auth/* 开游客账号、换 token，以及几种伪造 token
  helpers.ts          连 WebSocket、按顺序取消息、读权威局面、叫醒 alarm
  duel.ts             把一局从建房打到 GAME_OVER 的驱动器
  auth.test.ts        游客登录、换 JWT、伪造和过期 token 一律进不去、换密钥
  handshake.test.ts   握手、认证、座位、顶号、版本
  match.test.ts       打完整局，验裁剪、序号、快照、重连
  cheat.test.ts       作弊：借座位、DEBUG_*、SUBMIT_ANSWERS、冒充重连……全部要被拒
  autopilot.test.ts   答题 alarm 和空房超时
  lobby.test.ts       排队配对、私人开房、按码加入、房间码回收
  legacy.test.ts      旧转发器最关键的几条时序，防止改新的时改坏旧的
  smoke.mjs           打真的 wrangler dev 或线上的端到端脚本（不在 CI 里）
```

## 一局是怎么走的

1. 客户端先连 `/lobby` 拿房间码（见下面「大厅」）。
2. 双方各连一条 WebSocket 到 `/match/:code`，JWT 放在 `Sec-WebSocket-Protocol` 里
   （`jwt.<token>`，服务端 101 只回显 `ai-duel`）。座位由服务端按建房时的名单分。
3. 客户端发 `session:hello`，版本对上回 `session:welcome`。
4. 双方 `room:loadout` + `room:ready`，服务端 `createGame` 并下发 `match:started`。
5. `match:command` → 核座位 → `execute` → 新状态写 SQLite → 事件按座位分别下发。
6. 进答题阶段之后房间自己排一个 alarm，到点替场上的 AI 发 `SUBMIT_ANSWERS`（见下面「alarm」）。
7. `GAME_OVER` 之后房间发 `room:closed{reason:'match-over'}`、关掉连接、把房间码还给大厅。

## 大厅

`/lobby` 是**全局单实例**的 Durable Object（`getByName('global')`，见 `src/lobby/naming.ts`）。
队列要凑一对人，切成多个实例就等于把队列切碎，人一少就永远配不上。
握手和房间完全同一套（同一份 `src/net/session.ts`），差别只有 `session:welcome` 里的
`place` 是 `{kind:'lobby'}`、连接按账号而不是按座位打标签。

三条路进房间，走完都是同一条 `lobby:room`：

| 消息 | 服务端做什么 | `origin` |
|---|---|---|
| `lobby:queue` | 入队；队里够两个人就摇码 → `MatchRoom.setup({players})` → 两个人各发一份码 | `queue` |
| `lobby:create` | 摇码 → `MatchRoom.reserve(code, userId)`（只占 0 号座） | `create` |
| `lobby:join` | 查码表 → `MatchRoom.join(userId)`（占 1 号座，满了回 `room-full`） | `join` |

- 队列按入队时间排，配对的是**先到的两个**，不分池不分段。
- 连接断了当场出队（重连顶掉旧连接的那种不算，见 `handlers.ts` 的 `handleDisconnect`）。
- 拿到 `lobby:room` 之后客户端**自己断开大厅**去连房间，服务端不主动关这条连接。
- 房间码是四位数字（`roomCodeSchema`），摇码时避开码表里还活着的码，
  连撞十次回 `lobby:error no-room-code`。

**房间码怎么回收**：房间收摊时（三种 reason 都算）调 `LOBBY.release(code)` 把码还回去，
由房间通知而不是大厅在外面按时间猜——一局多久打完只有房间知道。
码表里那个岁数上限（六小时）只是兜底，防这条 RPC 丢了之后码被永远占着。
码表最多也就长到一万行（四位码的全集），不需要定期打扫。

## alarm

一个 Durable Object 只有**一个** alarm，房间却有两件定时的事：

| | 排在什么时候 | 到点干什么 |
|---|---|---|
| 答题 | 事件里出现 `QUESTION_REVEALED` 时排 +2.5s | 现读最新局面，还在 quiz 就发 `SUBMIT_ANSWERS` |
| 空房 | 建房时排 +10min，每次检查完还有人就再续一轮 | 一个人都没连着就 `room:closed{idle-timeout}` |

做法是每种任务各记一个到点时刻（存在 SQLite 的 `deadlines` 那一行），
运行时的 alarm 永远对到最早的那个；响了就把到点的那几种摘出来交给各自的处理函数
（`src/room/alarms.ts`）。收摊时两种一起撤掉，对象再也不会被叫醒。

答题延时（2.5 秒，数字沿用旧客户端的 `QUIZ_AUTOPILOT_DELAY_MS`）**只在服务端**，
客户端不需要知道：它演它的「揭晓题目 + AI 作答中」，早了少播一段，晚了多等一会儿，
局面都不会卡住。生成答案集中在 `autopilot.ts` 的 `answersFor` 一个函数里——
将来改成对局中途真去调模型 API 只改那一处（《正式版架构》5.3）。

## 账号与鉴权

账号是 **better-auth 配 Cloudflare D1**（《正式版架构》5.5），全部挂在 `/api/auth/*` 下面。
两种登录方式：**游客**（打开就能玩，不填任何东西就有一个账号 id）和
**Steam**（拿 Steam 客户端给的会话票据换会话，迁移第 35 条，见下一节）。
座位、匹配、重连认的都是同一个账号 id，两条路进来之后完全一样。邮箱 / OAuth 绑定还没做。

一次完整的流程是三步：

```bash
# 1) 开一个游客账号，会话在 cookie 里
curl -c cookies.txt -X POST http://127.0.0.1:8787/api/auth/sign-in/anonymous \
  -H 'Content-Type: application/json' -d '{}'

# 2) 用会话换一张握手用的 JWT
curl -b cookies.txt http://127.0.0.1:8787/api/auth/token

# 3) 连 WebSocket 时把它放进子协议：ai-duel, jwt.<token>
```

**签发和验签是分开的两半**，这是这套设计的关键：

| | 谁在做 | 用什么 |
|---|---|---|
| 签发 | `/api/auth/*` 上的 better-auth | D1 `jwks` 表里那把私钥（EdDSA / Ed25519） |
| 验签 | 房间和大厅对象（`src/auth/verify.ts`） | 同一张表里的公钥，直接查 D1，带一分钟缓存 |

两边不共享任何秘密，所以房间对象即使被读走代码也签不出 token。
公钥不走 HTTP 回自己去拿：Worker 请求自己要绕一圈出口，而 D1 绑定在 DO 里直接能用。

`jwks` 表里认不出的 kid 会触发一次重查（新生成的密钥就是这么被认出来的），
查完还是没有就记下这个 kid，同一张坏 token 再来不必再查。

改了插件或者字段之后重新生成建表语句（`migrations/0001_auth.sql`）：
CLI 要在 Node 里加载一份配置，而真正那份要 D1 绑定（只有 Worker 里才有），
所以临时写一份用内存 SQLite 的：

```bash
cat > packages/server/tmp-auth-config.ts <<'EOF'
import { DatabaseSync } from 'node:sqlite'
import { betterAuth } from 'better-auth'
import { anonymous, jwt } from 'better-auth/plugins'

export const auth = betterAuth({
  appName: 'ai-duel',
  secret: 'schema-generation-only-schema-generation-only',
  database: new DatabaseSync(':memory:'),
  plugins: [anonymous(), jwt({ jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } } })],
})
EOF
cd packages/server
npx auth@latest generate --config ./tmp-auth-config.ts --output ./migrations/0001_auth.sql --yes
rm tmp-auth-config.ts
```

插件列表要和 `src/auth/betterAuth.ts` 里的一致，不然生成出来的表会少字段。
Steam 那个插件（`src/auth/steam.ts`）**不用**加进去：它没有自己的表，
steamId 记在 better-auth 自带的 `account` 表里（`providerId` 是 `'steam'`）。
生成的文件没有注释，记得把文件头那段说明补回去。

### Steam 登录

`POST /api/auth/sign-in/steam`，体是 `{ "ticket": "<十六进制>" }`，成功之后会话落在 cookie 里，
之后和游客那条完全一样（`/api/auth/token` 换 JWT → 握手）。实现分两个文件：

| 文件 | 做什么 |
|---|---|
| `src/auth/steamTicket.ts` | 验票据，回一个 steamId。票据本身是不透明的二进制，只有 Valve 验得了 |
| `src/auth/steam.ts` | better-auth 插件：steamId → 找到或建立账号 → 发会话 |

验票据有三种环境，判据先看密钥再看 `DEV`：

| `STEAM_WEB_API_KEY` | `DEV` | 行为 |
|---|---|---|
| 有 | 无所谓 | 真的去问 Valve 的 `ISteamUserAuth/AuthenticateUserTicket` |
| 没有 | 有 | **开发模式**：任何十六进制票据都收，steamId 由票据摘要出来（前缀 `dev-`） |
| 没有 | 没有 | 一律拒绝（失败关闭） |

开发模式让本机**没有 Steam 客户端也测得了整条路**：同一张票据永远算出同一个账号，
不同票据算出不同账号（所以开两个进程就能当两个人对打）。
线上漏配密钥时是「谁都登不进来」而不是「随便递一段字符串就是一个新账号」。

密钥怎么配见 `docs/deploy.md` 的「Steam 登录」一节；壳那半边（取票据）见 `apps/steam/README.md`。

## 本地开发

密钥不进仓库，第一次要自己建一份：

```bash
cp packages/server/.dev.vars.example packages/server/.dev.vars
# 把 BETTER_AUTH_SECRET 换成 `openssl rand -base64 32` 的输出
```

线上那份走 `wrangler secret put BETTER_AUTH_SECRET`，不写进 `wrangler.jsonc`。

```bash
pnpm --filter @ai-duel/legacy-client build   # 先出静态资源，assets.directory 指着它
pnpm dev:server                              # 先建账号库的表，再 wrangler dev（127.0.0.1:8787）
```

`pnpm dev:server` 里那一步建表是 `wrangler d1 migrations apply AUTH_DB --local`，
每次都跑一遍：已经建过的话 wrangler 自己会说「没有要应用的迁移」，比让人记住一条前置命令省事。

### `DEV` 那一行是什么

`.dev.vars` 里除了密钥还有一行 `DEV=1`。它是「现在跑的是不是本地开发」的判据
（`src/devMode.ts`）：`wrangler deploy` 不会把 `.dev.vars` 带上去，所以线上必然没有它。
现在有两处按它分岔，两处都是「开发时宽一点、线上一律收紧」：

| 开关 | 开发 | 线上 |
|---|---|---|
| `room:error malformed` | 回给客户端，好让人知道自己发错了 | 静默丢弃（见 `src/room/session.ts`） |
| 跨源请求 | 额外信任 `localhost:*` / `127.0.0.1:*` | 只信 `baseURL` 自己那个源（见 `src/auth/betterAuth.ts`） |

跨源那一条本地非有不可：页面来自 Vite，而 `wrangler dev` 会按 `wrangler.jsonc` 里那条
`routes` 把请求 URL 重写成正式域名，两边的源怎么都对不上。

### 前端连本地服务端

正式版客户端不直连 8787，走 Vite 的 `server.proxy`（见 `apps/web/vite.config.ts` 和仓库根
README 的「本地怎么跑联机」）：浏览器眼里前后端同源，账号的会话 cookie 才带得上。

本地那个 D1 库在 `packages/server/.wrangler/` 下面（不进仓库）。
换过 `BETTER_AUTH_SECRET` 之后旧的私钥就解不开了，把整个目录删掉重来最省事。

改了 `wrangler.jsonc` 里的绑定之后重新生成 `Env` 类型：

```bash
pnpm --filter @ai-duel/server types
```

`Env` 是两份拼起来的：`worker-configuration.d.ts` 是生成的绑定，
`env.d.ts` 是手写的密钥（生成器看不见 `.dev.vars`，写进生成的那份下次会被覆盖掉）。

## 测试

```bash
pnpm --filter @ai-duel/server test
```

跑在**真的 workerd 里**（`@cloudflare/vitest-pool-workers`，《正式版架构》6.7）：
Durable Object、SQLite、WebSocket Hibernation、升级请求的头都是真的那一套，
配置从 `wrangler.jsonc` 读。不需要先起 `wrangler dev`，也不需要静态资源。
D1 也是真的：miniflare 按 `AUTH_DB` 那条绑定现建一个内存库，
`test/setup.ts` 在每个测试文件开跑前把 `migrations/` 里的表建好。

测试里**没有「测试专用签发」**：token 一律真的走 `/api/auth/*` 换（见 `test/accounts.ts`）。
以前那版是测试自己拿共享密钥签，结果验签那条路只有测试走过，签发方一换就全瞎了。
测试里说的 `'alice'`、`'bob'` 是**标签**，背后是 better-auth 随机生成 id 的游客账号。

有一处要知道：这个 pool 每条用例跑完会把存储回滚，账号那几行会没掉，
但 JWT 是自包含的（验签只看签名和 `sub`，不查账号表），所以上一条用例拿到的 token
在下一条里照样能用。密钥那一行是在 setup 里生成的，回滚不掉。

`test/smoke.mjs` 是另一回事——它打真的 `wrangler dev` 或线上，
覆盖面比 vitest 那几个宽（静态资源回退、CORS、跨房间释放），但不在 CI 里：

```bash
pnpm --filter @ai-duel/server smoke
SMOKE_BASE=https://playyourcardai.online pnpm --filter @ai-duel/server smoke
```

## 还没做的

- 账号只有游客一种：邮箱 / OAuth 绑定还没接，Steam 票据换 JWT 是第 35 条。
  换句话说现在**换个浏览器就是另一个人**，清了 cookie 也一样。
  正式版客户端就是这么用的：进站自动开一个游客号（见 client 的 `src/auth/session.ts`）。
- `room:urge` 的 id 查表：那张喊话表还在 legacy-client 里（第 33 条搬进 content），
  搬过来之前只转发不校验，查不到该回的 `unknown-urge` 还发不出来。
- 显示名：`createGame` 的 `name` 暂时直接用账号 id。better-auth 的 `user` 表里
  其实有一列 `name`（游客登录时随机生成一个），但那要按 `sub` 回查一次 D1，
  而房间对象现在一次 D1 都不查——等真要显示昵称时再一起接（第 27、31 条）。
