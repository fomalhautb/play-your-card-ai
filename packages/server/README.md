# @ai-duel/server

Cloudflare Worker 加 Durable Object。一个脚本里**并排跑着两套服务端**：

| | 路径 | DO 绑定 | 目录 | 状态 |
|---|---|---|---|---|
| 旧转发器 | `/api/room`、`/room/:code` | `ROOM` → `Room` | `src/legacy/` | 冻结，线上还在用 |
| 新房间 | `/match/:code` | `MATCH_ROOM` → `MatchRoom` | `src/room/` | 在写 |
| 新大厅 | `/lobby` | `LOBBY` → `Lobby` | `src/lobby/` | 在写 |

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
  index.ts            总路由：旧路径进 legacy，/match/:code 和 /lobby 进新代码，其余交静态资源
  auth/verify.ts      验 JWT 认出 userId。本 PR 是 HS256 + JWT_SECRET，第 25 条换 better-auth
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
  helpers.ts          签 token、连 WebSocket、按顺序取消息、读权威局面、叫醒 alarm
  duel.ts             把一局从建房打到 GAME_OVER 的驱动器
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

## 本地开发

密钥不进仓库，第一次要自己建一份：

```bash
cp packages/server/.dev.vars.example packages/server/.dev.vars
# 把 JWT_SECRET 改成随便什么够长的串
```

线上那份走 `wrangler secret put JWT_SECRET`，不写进 `wrangler.jsonc`。

```bash
pnpm --filter @ai-duel/legacy-client build   # 先出静态资源，assets.directory 指着它
pnpm dev:server                              # wrangler dev，默认 http://127.0.0.1:8787
```

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

`test/smoke.mjs` 是另一回事——它打真的 `wrangler dev` 或线上，
覆盖面比 vitest 那几个宽（静态资源回退、CORS、跨房间释放），但不在 CI 里：

```bash
pnpm --filter @ai-duel/server smoke
SMOKE_BASE=https://playyourcardai.online pnpm --filter @ai-duel/server smoke
```

## 还没做的

- better-auth + D1 签发 JWT（第 25 条）：现在是 HS256 共享密钥，`verifyToken` 的签名不会变。
- `room:urge` 的 id 查表：那张喊话表还在 legacy-client 里（第 33 条搬进 content），
  搬过来之前只转发不校验，查不到该回的 `unknown-urge` 还发不出来。
- `room:error malformed` 现在一律发，上线前要改成只在开发模式发（见 MatchRoom 里那段注释）。
- 显示名：`createGame` 的 `name` 暂时直接用账号 id，等第 25 条接上账号才有地方取。
