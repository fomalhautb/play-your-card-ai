# @ai-duel/steam

Steam 版的 Electron 壳（《正式版架构》第 8 节迁移第 35 条）。

选 Electron 的原因是它自带 Chromium——Steam 上只有一种渲染引擎，不用管各家浏览器的差异
（见第 1 节的选型表）。

**壳里不写业务**：这个包只有入口和构建配置，游戏本身是 `@ai-duel/client` 的 `App`，
和网页壳挂的是同一个东西，只是平台实现换成 `createElectronPlatform()`。

## 目录

```
src/
  main.ts       主进程入口：初始化 Steam → 挂前端产物 → 开窗口 → 接三条 IPC
  config.ts     站点源、appId、票据 identity、哪些路径归服务端
  site.ts       protocol.handle('https')，把本地构建产物挂到站点那个源上
  window.ts     BrowserWindow：三条隔离、导航白名单、窗口尺寸
  steam.ts      steamworks.js：初始化、昵称、取票据
  channels.ts   主进程和 preload 之间那几条 IPC 频道的名字
  preload.ts    contextBridge 暴露 window.aiDuelShell（沙箱里跑，不 import 别的文件）
  renderer/
    main.tsx    渲染进程入口，和 apps/web 那份只差一行
e2e/            Playwright 的 Electron 冒烟用例
electron-builder.yml
```

主进程和 preload 由 **tsc 直接编译成 CommonJS**（落在 `dist/main/`），
渲染进程由 **Vite** 打包（落在 `dist/renderer/`）。两半的模块格式正好相反，所以有两份 tsconfig，
理由写在 `tsconfig.json` 里。这是仓库里唯一一个真的用 tsc 产出 JS 的包。

## 怎么本地跑

前提：先把卡面图集和界面底图打出来（它们不进仓库）。

```bash
pnpm assets:build
```

### 连开发服务器（改前端时用这个）

两个终端：

```bash
pnpm --filter @ai-duel/steam dev      # Vite 开发服务器，5175
pnpm --filter @ai-duel/steam start    # 开窗口，连上面那个
```

开发服务器自己有一份代理，把 `/api`、`/lobby`、`/match/1234` 转给 `wrangler dev`
（默认 `http://127.0.0.1:8787`，用 `SERVER_URL` 换一个），和网页壳那份是一回事。
服务端怎么起见 `packages/server/README.md`。

### 用打好的产物（改壳时用这个）

```bash
pnpm --filter @ai-duel/steam preview
```

这一条会先构建再开窗口，页面来自本地磁盘、**源是线上那个域名**，
`/api` 和两条 WebSocket 真的走网络。理由见下一节。

### 打包

```bash
pnpm --filter @ai-duel/steam pack:dir      # 当前系统，只出解包后的目录
pnpm --filter @ai-duel/steam pack:linux    # AppImage
```

产物在 `apps/steam/release/`（不进仓库）。三个目标都**不签名**——签名要开发者证书，
那是上线前的事。CI 慢档里有同样的三格（`.github/workflows/slow.yml` 的 `build-steam`）。

### 冒烟用例

```bash
pnpm --filter @ai-duel/steam smoke
```

真的把壳启动一次，看窗口开出来、首页画布画出来。**只在本机跑，没进 CI**：
判据要一个真能用的 WebGL，而跑机没有独显，Electron 里那套软件光栅的开关试过几种组合都
起不来渲染器（详见 `e2e/smoke.spec.ts` 的文件头）。

## 页面为什么不是 `file://`

打包之后页面**不是**从 `file://` 加载的，而是由主进程用 `protocol.handle('https', ...)`
把本地构建产物「挂」到线上那个源（默认 `https://playyourcardai.online`）下面，
只有 `/api/*`、`/lobby`、`/match/1234` 这几条路径照常走网络（见 `src/site.ts`）。

**只为一件事：同源。** 账号的会话在 cookie 里，而 cookie、CORS、better-auth 的来源检查
全都认源。页面要是 `file://`，`window.location.origin` 就是 `"file://"`，
发给正式域名的请求全是跨源的，cookie 根本不会带上——整条登录链当场断掉。
客户端那一层压根没有 `credentials` 这个口子，也是同一条前提的一部分
（见 `packages/platform` 的 `network.ts`）。

好处不止登录：前端资源全在本地，启动不用下载；WebSocket 不经过协议处理器，一直是真连接。
代价是**离线时打不开**——`/api/auth/get-session` 会失败，账号进不去，
虽然首页画得出来但联机和单机都进不到（单机本身不需要服务端，但首页菜单没有离线分支）。
真要做离线单机，是另一条路子：把会话换成不依赖 cookie 的凭据。

用 `AI_DUEL_ORIGIN` 换一个源（预发布、冒烟用例）。

## Steam 那半边

### 票据怎么流动

```
Steam 客户端 ──getAuthTicketForWebApi()──▶ 主进程（src/steam.ts）
                                              │ 十六进制字符串
                                              ▼  preload 的桥
                                          渲染进程（platform 的 electron/steam.ts）
                                              │ POST /api/auth/sign-in/steam
                                              ▼
                                          服务端 ──▶ Valve 的 AuthenticateUserTicket
                                              │        （只有它验得了这张票）
                                              ▼ steamId → 找到或建立账号 → 会话 cookie
                                          /api/auth/token → JWT → WebSocket 握手
```

客户端说自己是谁一律不算数：唯一的凭据是那张票，而只有 Valve 验得了它。
服务端那半边见 `packages/server/README.md` 的「Steam 登录」。

### `steamworks.js` 只在主进程里加载

它是原生模块（napi-rs 打的 `.node`）。要在渲染进程里直接 `require` 它，就得关掉
`contextIsolation`、打开 `nodeIntegration`——那是拿整个渲染进程的隔离换一个功能。
所以它留在主进程，渲染进程只经 `window.aiDuelShell` 那座桥拿结果。
桥的形状在 `src/preload.ts` 和 `packages/platform/src/electron/bridge.ts` **各写了一份**，
改一处要一起改（跨包只走包入口，而库不能反过来依赖壳）。

预编译的 `.node` 和 Steam 的动态库（`libsteam_api.dylib` / `.so` / `steam_api64.dll`）
都在这个 npm 包里，**不用另外去 Steamworks 下 SDK**；Node-API 的 ABI 跨版本稳定，
也不需要 `electron-rebuild`。打包时它整个目录从 asar 里解出来（asar 是只读归档，`dlopen`
打不开里面的文件），见 `electron-builder.yml` 的 `asarUnpack`。

### 怎么换成真的 app id

现在默认是 **480**（Valve 的 SpaceWar）：每个 Steam 账号都「拥有」它，
所以不等自己的 appId 批下来就能把整条路跑通。

换成真的要改**两处，而且必须是同一个数**：

| 哪一边 | 怎么配 |
|---|---|
| 壳 | 环境变量 `STEAM_APP_ID`（打包时注入，或者在 Steam 的启动参数里给） |
| 服务端 | `STEAM_APP_ID`，见 `docs/deploy.md`「Steam 登录」 |

验票据时 Valve 会拿 appId 比对，对不上整张票作废。
取票据时那个 `identity` 字符串同理（`src/config.ts` 的 `STEAM_TICKET_IDENTITY`
和服务端 `src/auth/steamTicket.ts` 里那个）。

### 没有 Steam 的时候

Steam 客户端没开、appId 没权限、在跑机上跑——`init()` 都会抛，那时壳照常开窗口，
`platform.steam` 是 undefined，客户端走**游客登录**（见 `packages/client/src/auth/session.ts`）。
整个游戏一样能玩，只是账号不跟着 Steam 走。

## 还没做的

- **图标**。`electron-builder` 现在用的是 Electron 的默认图标（打包日志里有一句
  `default Electron icon is used`）。要换的话在 `apps/steam/build/` 下放 `icon.icns` /
  `icon.ico` / `icon.png`，`electron-builder.yml` 不用改。
- **签名与公证**。三个目标都不签名，上线前要补 mac 的开发者证书和公证、Windows 的代码签名。
- **Steam 的 depot 上传**。打出来的目录怎么传上 Steam（`steamcmd` / SteamPipe）不在这个包里。
- **富存在（Rich Presence）、成就、云存档**。`steamworks.js` 都支持，接不接是产品决定。
