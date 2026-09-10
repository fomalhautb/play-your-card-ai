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

## 为什么这样切

接口不是凭空设计的，除触感外每一项都是从旧客户端（`packages/legacy-client`，已冻结）
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
  的最小面来定，将来第 36 条接原生插件时是一一对应的转发。

## web 实现用了什么库

`createWebPlatform()`。三个壳目前都用它——Electron 渲染进程是 Chromium，Capacitor 是系统 WebView。

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

Electron 和 Capacitor 的实现留到迁移第 35、36 条，那时是「以 web 实现为底，换掉其中几项」
（Steam 覆盖层、原生触感、系统安全区），不是另起一套。

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

## 测试

```bash
pnpm --filter @ai-duel/platform test
```

默认跑在 node 环境：接口层和假实现不该碰浏览器 API，环境里根本没有 `window` 才验得出这一点。
要 DOM 的文件在头一行写 `// @vitest-environment happy-dom`。

重连那组给 partysocket 塞了一个假的原生 WebSocket（`test/network.test.ts` 里的 `FakeWebSocket`），
所以握手、断线、业务拒绝的时机全由脚本说了算，不用真起服务器。
