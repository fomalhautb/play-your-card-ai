# @ai-duel/server

Cloudflare Worker 加 Durable Object。一个脚本里**并排跑着两套服务端**：

| | 路径 | DO 绑定 | 目录 | 状态 |
|---|---|---|---|---|
| 旧转发器 | `/api/room`、`/room/:code` | `ROOM` → `Room` | `src/legacy/` | 冻结，线上还在用 |
| 新房间 | `/match/:code` | `MATCH_ROOM` → `MatchRoom` | `src/room/` | 在写 |

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
  index.ts            总路由：旧路径进 legacy，/match/:code 进新房间，其余交静态资源
  auth/verify.ts      验 JWT 认出 userId。本 PR 是 HS256 + JWT_SECRET，第 25 条换 better-auth
  legacy/
    room.ts           旧转发器的 Room 类（冻结）
    routes.ts         旧转发器的两条 HTTP 路由（冻结）
  room/
    MatchRoom.ts      房间 DO：连接生命周期 + 消息分发，不留任何内存状态
    session.ts        一条连接的身份（挂在 serializeAttachment 上）、座位标签、发消息
    state.ts          SQLite：房间成员关系一行、权威 GameState 一行
    membership.ts     room:loadout / ready / leave / resync / urge，以及双方就绪后开局
    commands.ts       match:command：核座位 → execute → 存盘 → 分发
    dispatch.ts       一批事件 → 每座位 filterEvent + viewFor + stripCatalog → match:events
test/
  helpers.ts          签 token、连 WebSocket、按顺序取消息、读权威局面
  duel.ts             把一局从建房打到 GAME_OVER 的驱动器
  handshake.test.ts   握手、认证、座位、顶号、版本
  match.test.ts       打完整局，验裁剪、序号、快照、重连
  cheat.test.ts       作弊：借座位、DEBUG_*、SUBMIT_ANSWERS、冒充重连……全部要被拒
  legacy.test.ts      旧转发器最关键的几条时序，防止改新的时改坏旧的
  smoke.mjs           打真的 wrangler dev 或线上的端到端脚本（不在 CI 里）
```

## 一局是怎么走的

1. 大厅（迁移第 24 条，还没有）配对成功后调 `MATCH_ROOM.getByName(code).setup({ players })`，
   把两个座位分别属于哪个账号定死。本 PR 只有测试调它。
2. 双方各连一条 WebSocket 到 `/match/:code`，JWT 放在 `Sec-WebSocket-Protocol` 里
   （`jwt.<token>`，服务端 101 只回显 `ai-duel`）。座位由服务端按 `setup` 的名单分。
3. 客户端发 `session:hello`，版本对上回 `session:welcome`。
4. 双方 `room:loadout` + `room:ready`，服务端 `createGame` 并下发 `match:started`。
5. `match:command` → 核座位 → `execute` → 新状态写 SQLite → 事件按座位分别下发。
6. 答题阶段本 PR 由 RPC `submitAnswers()` 触发（迁移第 23 条改成 DO 的 alarm）。
7. `GAME_OVER` 之后房间发 `room:closed{reason:'match-over'}` 并关掉连接。

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

- 大厅 DO、匹配、房间码分配（迁移第 24 条）：现在只能靠 `setup` RPC 建房。
- 答题 autopilot 的 alarm（第 23 条）：现在是 RPC。
- better-auth + D1 签发 JWT（第 25 条）：现在是 HS256 共享密钥，`verifyToken` 的签名不会变。
- `room:urge` 的 id 查表：那张喊话表还在 legacy-client 里（第 33 条搬进 content），
  搬过来之前只转发不校验，查不到该回的 `unknown-urge` 还发不出来。
- 房间空太久自己收摊（`room:closed` 的 `idle-timeout`）：要 alarm，和第 23 条一起做。
