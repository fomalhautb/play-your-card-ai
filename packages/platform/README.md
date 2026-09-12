# @ai-duel/platform

平台能力接口，以及它们的实现。《正式版架构》第 2 节第 5 条：网络、音频、存储、图片加载、
全屏、安全区、触感都从这里走，场景和界面代码不直接碰浏览器对象，换平台时只换实现。

这个包不依赖任何别的包，被 `canvas`、`ui`、`client`、`bench` 依赖。

## 七项能力

每一项一个文件，接口和实现分开。订阅一律「传回调、返回退订函数」，不出现 `window`、
`document`、`HTMLElement` 这类类型。

| 文件 | 接口 | 主要方法 |
|---|---|---|
| `network.ts` | `NetworkCapability` | `openSocket`、`requestJson`、`onForeground` |
| `audio.ts` | `AudioCapability` | `play`、`preload`、`stopChannel`、`setMuted` / `isMuted` / `onMutedChange`、`isBlocked` / `onBlockedChange`、`unloadAll` |
| `storage.ts` | `StorageCapability` | `read`、`write`、`remove`（都吃 `StorageSlot`） |
| `images.ts` | `ImagesCapability` | `load`、`loadAll`、`loadInBackground`、`isSettled`、`get`、`release` |
| `fullscreen.ts` | `FullscreenCapability` | `isSupported`、`canLockOrientation`、`isActive` / `onChange`、`enterLandscape`、`exit`、`isStandalone` |
| `safeArea.ts` | `SafeAreaCapability` | `metrics`、`onChange`、`isCoarsePointer` |
| `haptics.ts` | `HapticsCapability` | `isSupported`、`impact`、`selection`、`notification` |

`platform.ts` 把七项打成一个 `Platform`，应用入口构造一次往下传。

## 第八项：Steam（可选）

`steam.ts` 的 `SteamCapability`（`isAvailable`、`authTicket`、`personaName`）是**可选的**
（`Platform.steam?`）——七项能力每个壳都有、只是实现不同，而 Steam 只有 Steam 那个壳有，
网页和手机壳根本没有对应的东西。所以它不写成「另外两个壳返回恒假的实现」：那样调用方
分不出「装了 Steam 但没开」和「这个壳压根不是 Steam 版」，而这两种情况界面上要说的话不一样。

票据的用法见《正式版架构》5.5：客户端拿它换服务端的会话，服务端拿它去问 Steam 这张票是谁的。
客户端自己说的 steamId 一律不算数。

## 为什么这样切

接口不是凭空设计的，除触感外每一项都是从旧客户端（黑客松版，已随迁移第 38 条删掉）
实际用到的操作反推的。切法上有几处刻意和旧代码不一样：

- **HTTP 只有「取一份 JSON」一个方法。** 全站的 HTTP 就是账号那三条（游客登录、拿会话、
  换握手用的 JWT），别的都走 WebSocket。它不暴露 `credentials`：会话在 cookie 里，
  而同源请求本来就带 cookie，而**同源是这套部署的前提**（线上前后端是同一个 Worker，
  本地开发由 Vite 代理伪装成同源）。这条边界写在这里，是为了让「客户端为什么不自己 `fetch`」
  有个明确出处——要跨源就来补这一层，不要在调用处开口子。
- **网络只到「帧」为止。** 旧代码把重连、心跳、可靠送达的信封、断线宽限期挤在
  `src/net/socket.ts` 一个文件里。看得懂协议的那半边（心跳内容、序号、房间语义）属于 `client`，
  这里只留「连接还在不在、字符串送不送得出去」。留给上层的抓手是 `reconnect()` 和
  `onForeground()`——弱网下最难受的「半开连接」要靠这两个才识破得了。
  地址（`url()`）和子协议（`protocols()`）都是**函数**，每次连接现取一遍：
  升级请求上唯一能塞凭据的地方就是子协议头（见 protocol 的 handshake.ts），
  而凭据是短时效的，挂久了重连必须现换一张。这一层不认识凭据长什么样。
- **静音开关不碰存储。** 旧代码 `ui/audioMute.ts` 直接把它写进 localStorage。这里音频只持有
  「现在响不响」，要不要记到下次进游戏是设置层的事，走存储能力。两项能力因此互不认识。
- **音量上限是 1。** 旧代码为了把几段录得偏轻的人声放大到 2~3 倍，绕开 audio 元素直接用
  Web Audio 的 GainNode。那是素材没做响度归一化的补丁，正式版在构建期统一响度，
  运行时不需要「超过 100%」这种东西。
- **安全区、视口、方向、像素比是一份快照。** 它们总是一起变（转屏、进出全屏、地址栏收起来），
  分成几个订阅会让调用方为同一次变化重排好几遍。
- **图片交出 `ImageBitmap`。** Pixi 拿它直接建纹理，不用再解码一次；接口里不出现 Pixi 的任何类型。
  界面要地址时用 `displayUrl`，别拿 `url` 自己拼——将来壳从本地读图时它会变。
- **触感是唯一凭空定的一项。** 旧代码全站没有用过 `navigator.vibrate`。接口照 Capacitor Haptics
  的最小面来定，第 36 条接原生插件时果然是一一对应的转发，接口一个字没改。

## web 实现用了什么库

`createWebPlatform()`。网页壳直接用它，另外两个壳以它为底再各换掉三项（见下面两节）。

- **网络：[partysocket](https://github.com/partykit/partysocket)。** Cloudflare 维护的重连
  WebSocket，API 和原生一样，断线重连、退避、连接超时、断线期间的发送队列都在里面。
  旧客户端用的就是它，真实弱网表现是已知的。退避参数调过：首次和重试退避 500 毫秒起
  （默认 1~5 秒随机，对抖动来说太慢）、封顶 5 秒、握手超时 8 秒。
- **音频：[howler.js](https://howlerjs.com/)。** 旧代码为了让声音在手机上正常响，自己写了三段绕：
  首次点击前静默解锁 AudioContext、音频数据和解码结果各缓存一份、播完手工 disconnect 掉节点。
  这三件事 howler 都包好了，还多解决两个迟早会撞上的问题（Web Audio 不可用时退回 `<audio>`、
  淡入淡出）。没选 `@pixi/sound`：它会把 Pixi 拖进 platform，而这个包不该知道画布用哪个引擎。
- **存储：localStorage，没引库。** 要做的只是「按键存取一个字符串」，形状本来就对得上；
  idb 那类库解决的是异步、大对象、结构化查询，几 KB 的存档用不上。
- **图片：`fetch` + `createImageBitmap`，没引库。** 现成的加载器（Pixi Assets 那类）会把纹理和
  渲染引擎一起绑进来。顺带甩掉了旧代码里「页面切后台时 `decode()` 一直不结算」那段绕——
  `createImageBitmap` 不吃这个亏。
- **全屏、安全区、触感：浏览器 API，没引库。** 特性检测和降级从旧代码搬过来（`ui/fullscreen.ts`、
  `ui/viewportVars.ts`），坑都在注释里。

## electron 实现

`createElectronPlatform()`（迁移第 35 条，`src/electron/`）。它**以网页实现为底**，只换三项：

- `fullscreen`：要全屏的是**窗口**，不是页面里的那一块。`document.requestFullscreen()` 在
  Electron 里能用，但标题栏和窗口边框还在；而且玩家按 F11、点窗口按钮、macOS 上用触发角退出时，
  浏览器那套 `fullscreenchange` 一声不响。状态只能由主进程推过来。
- `haptics`：桌面上没有可震的东西。不沿用网页实现是因为 `navigator.vibrate` 在 Chromium 里
  **存在**、调用也不报错，只是什么都不发生——那样设置页会摆出一个按了没反应的开关。
- `steam`：第八项，只有这个壳有。

这三项底下都是同一座桥：`window.aiDuelShell`，由 `apps/steam/src/preload.ts` 经
`contextBridge` 挂上去。`steamworks.js` 是原生模块，只能在主进程里加载——要在渲染进程里
直接 `require` 它就得关掉 `contextIsolation`，那是拿整个渲染进程换一个功能。
桥的形状在 `src/electron/bridge.ts` 和 preload 里**各写了一份**，改一处要一起改
（跨包只走包入口，而库不能反过来依赖壳）。

桥不在的时候（没有 preload——端到端用例、直接用浏览器打开构建产物）`createElectronPlatform()`
退回纯网页实现，`platform.steam` 于是是 undefined，客户端走游客登录那条路。

## capacitor 实现

`createCapacitorPlatform()`（迁移第 36 条，`src/capacitor/`）。同样**以网页实现为底**，换三项。

**它不在包的主入口里**，在第二个入口 `@ai-duel/platform/capacitor`
（`package.json` 的 `exports` 里声明的）。理由只有一条：它 import 了 `@capacitor/core`，
而那个包是有副作用的（模块一加载就往 window 上挂东西），打包器摇不掉。
挂在主入口上的话，网页壳的产物里会白白多出一份用不到的 Capacitor 运行时——
实测 `apps/web` 从 1,026.84 kB 涨到 1,035.03 kB（gzip 319.07 → 322.21）。
壳那边也隔了一层：`apps/` 下的壳只许依赖 client，所以手机壳走的是
`@ai-duel/client/capacitor`（见 `packages/client/src/capacitor.ts`）。

三项是：

- `network`：三件事。**地址**要改指线上——手机壳里页面的源是 `capacitor://localhost`
  （iOS 的 WKWebView 不让给 https 注册协议处理器，只能用非标准 scheme），而客户端是照
  `window.location.origin` 拼地址的；Steam 壳那招「把本地产物挂到线上那个源上」在这儿做不到，
  理由见 `src/capacitor/origin.ts`。**HTTP 走原生**（`CapacitorHttp`，核心自带不用装插件）：
  改完地址请求就是跨源的，而会话是一个 cookie；原生 HTTP 不经过 WebView 的同源策略，
  cookie 存在系统的罐子里。只换 `requestJson` 这一个口子，不开那个会把全局 `fetch` 整个换掉的
  开关。**前后台**听 `@capacitor/app` 的 `appStateChange`，因为 iOS 的 WKWebView 切后台时
  不保证发 `visibilitychange`。
- `fullscreen`：全屏 = 藏系统状态栏和导航栏（`SystemBars`，也在核心里）。页面全屏在 WebView 里
  调了什么也看不出来——WebView 本来就铺满整个窗口。方向锁恒为 false：横屏是原生工程里写死的，
  没有运行时那一步。
- `haptics`：转发给 `@capacitor/haptics`。网页那份在 iPhone 上什么都做不了（iOS Safari 至今
  不支持 `navigator.vibrate`），安卓上也只有「震多少毫秒」一个旋钮。

**`safeArea` 没有换**，虽然它是手机上最要紧的一项：探针那条 padding 是
`max(env(safe-area-inset-*), var(--safe-area-inset-*, 0px))`，两个来源取大的那个——
iOS 报得准的是前者，安卓靠 Capacitor 注入的后者（`plugins.SystemBars.insetsHandling: 'css'`）。
一份实现两边都对。

不在原生壳里跑的时候（浏览器里打开同一份产物、测试）`createCapacitorPlatform()` 退回纯网页实现。

跨源那一半在服务端接住：better-auth 的 `trustedOrigins` 里有手机壳这两个源
（`packages/server/src/auth/betterAuth.ts` 的 `MOBILE_TRUSTED_ORIGINS`，有测试钉着）。
整条链路和还要真机验的东西写在 `apps/mobile/README.md` 的「同源这件事」。

## 假实现

`createFakePlatform()`，不碰任何浏览器 API。给测试和 `bench` 的性能剧本用——剧本要的是稳定
可复现，真实的网络和音频抖动只会污染帧时间。能摆布的东西：

- **网络**：连接什么时候握手成功、什么时候断、断的是什么码；收到哪一帧；HTTP 答什么；
  何时「回到前台」。发出去的帧、每次连接算出来的地址和取到的子协议都按顺序记着。
  状态机照着 partysocket 的行为写，两边跑同一组断言。
- **音频**：不出声，把每一次调用按顺序记进 `calls`；能让某一段「播完」（循环音转完一圈也是它）。
- **存储**：内存 Map，键的算法和 web 实现共用；能塞一段手改过的原文，也能装成「碰一下就炸」的浏览器。
- **图片**：每张图什么时候到货、成功还是失败由脚本定；「一批图怎么等」用的是和 web 实现同一份算法。
- **全屏**：支持不支持、能不能锁方向、是不是从主屏幕启动，三种设备组合都摆得出来。
- **安全区**：随手改其中几项，值真的变了才通知。
- **触感**：记账，设备不支持时不记（和真实现的空操作对齐）。
- **Steam**：在不在、下一张票据是什么（`null` 表示取票据会失败）、昵称，以及取过几次票据。
  **默认 `isAvailable()` 是 false**，和另外七项不一样——`createFakePlatform()` 建出来的是一台
  普通机器，大多数用例要验的正是「没有 Steam 时走游客那条路」。

## 测试

```bash
pnpm --filter @ai-duel/platform test
```

默认跑在 node 环境：接口层和假实现不该碰浏览器 API，环境里根本没有 `window` 才验得出这一点。
要 DOM 的文件在头一行写 `// @vitest-environment happy-dom`。

重连那组给 partysocket 塞了一个假的原生 WebSocket（`test/network.test.ts` 里的 `FakeWebSocket`），
所以握手、断线、业务拒绝的时机全由脚本说了算，不用真起服务器。
