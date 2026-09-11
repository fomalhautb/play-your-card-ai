# @ai-duel/mobile

iOS 和 Android 的 Capacitor 壳（《正式版架构》第 8 节迁移第 36 条）。

Capacitor 套的是**系统 WebView**，跑的是和网页壳同一份网页构建（见第 1 节的选型表）。
《正式版架构》第 1 节写明它是整套方案最弱的一环：iPhone 11 没问题，
2018 年中端安卓走 Chrome WebView 时性能余量最小，接进来之后要盯性能剧本。

**壳里不写业务**：这个包只有入口和构建配置，游戏本身是 `@ai-duel/client` 的 `App`，
和网页壳挂的是同一个东西，只是平台实现换成 `createCapacitorPlatform()`。

## 目录

```
capacitor.config.ts   appId、appName、webDir、系统栏、开发期的 server.url
index.html            viewport-fit=cover（安全区的前提）
vite.config.mts       网页构建，产物落在 dist/
src/
  main.tsx            入口，和 apps/web 那份只差一行
android/              `cap add android` 生成的 Gradle 工程
ios/                  `cap add ios` 生成的 Xcode 工程（SPM，不用 CocoaPods）
```

两个原生工程**进仓库**，构建产物不进（`android/.gitignore`、`ios/.gitignore` 是
`cap add` 自己写的，已经把 `build/`、`.gradle/`、`App/Pods`、`xcuserdata`、
以及复制进去的网页产物都排掉了）。

`android/capacitor.settings.gradle` 和 `android/app/capacitor.build.gradle` 里的路径带着
pnpm store 的版本号，看着很怪——它们是每次 `cap sync` 重新生成的，别手改，
换插件或升级 Capacitor 之后 sync 一次就对了。

## 版本与环境

Capacitor 8（`@capacitor/core` 8.5）。它要求：

| | 要求 |
|---|---|
| Node | 22+ |
| Android | JDK 21、compileSdk / targetSdk 36、minSdk 24、Gradle 8.14.3、AGP 8.13 |
| iOS | Xcode 26+、部署目标 iOS 15 |

装了三个插件：`@capacitor/app`（前后台）、`@capacitor/haptics`（触感），
加上 Capacitor 8 核心自带的 `SystemBars` 和 `CapacitorHttp`（它们不是插件，不用装）。
状态栏、方向锁、存储都**没有**装插件，理由见下面各节。

## 怎么本地跑

前提：先把卡面图集和界面底图打出来（它们不进仓库，见 `assets/README.md`）。

```bash
pnpm assets:build
```

### 只看网页那一半（改前端时用这个）

```bash
pnpm --filter @ai-duel/mobile dev      # Vite 开发服务器，5176
```

浏览器里打开就是游戏本身。`createCapacitorPlatform()` 这时会发现自己不在原生壳里，
退回纯网页实现，所以这条路验不了触感、系统栏和改地址那几件事。

### 安卓真机 / 模拟器

```bash
pnpm --filter @ai-duel/mobile sync:android   # 构建网页 + 复制进原生工程
pnpm --filter @ai-duel/mobile open:android   # 打开 Android Studio
```

命令行直接出 debug 包（CI 跑的就是这一条）：

```bash
cd apps/mobile/android && ./gradlew assembleDebug
# 产物在 app/build/outputs/apk/debug/app-debug.apk
```

要 `ANDROID_HOME` 指向 Android SDK，`JAVA_HOME` 指向 JDK 21。

### iOS 真机 / 模拟器

```bash
pnpm --filter @ai-duel/mobile sync:ios
pnpm --filter @ai-duel/mobile open:ios       # 打开 Xcode
```

不签名构建（CI 上没有这一格，见下面「为什么 CI 里只有安卓」）：

```bash
cd apps/mobile/ios/App \
  && xcodebuild -scheme App -destination 'generic/platform=iOS' \
       -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

跑模拟器换成 `-destination 'platform=iOS Simulator,name=iPhone 15'`。
第一次会解 Swift 包（`CapApp-SPM/Package.swift`），要能上网。

### 真机连开发服务器（改前端时想在手机上看）

```bash
CAP_SERVER_URL=http://192.168.1.7:5176 pnpm --filter @ai-duel/mobile sync:android
pnpm --filter @ai-duel/mobile dev
```

**必须是局域网 IP，不能是 localhost**——localhost 在手机上指的是手机自己。
这时 WebView 直接加载电脑上的 Vite，那边自带代理（`/api`、`/lobby`、`/match/1234` 转给
`wrangler dev`），所以和网页壳一样是同源的，下面「同源这件事」的麻烦在这条路上不存在。
改完记得**不带 `CAP_SERVER_URL` 再 sync 一次**，不然打出来的包会一直指着你的电脑。

## 同源这件事（最要紧的一节）

### 现状

手机壳里页面的源是 `capacitor://localhost`（iOS）/ `https://localhost`（安卓），
服务端在 `https://playyourcardai.online`。两者**不同源**，而账号的会话是一个 cookie。

Steam 壳没有这个问题：它用 `protocol.handle('https')` 把本地产物挂到线上那个源上，
硬把页面的 origin 做成了线上域名（见 `apps/steam/src/site.ts`）。同样的招数在 Capacitor 里
**两条路都堵死了**：

- **iOS**：WKWebView 不允许给 `http` / `https` 注册自定义协议处理器（Capacitor 的
  `server.iosScheme` 文档里写死了这条），所以只能用 `capacitor` 这类非标准 scheme。
- **安卓**：`server.hostname` 可以填线上域名，但 Capacitor 的本地服务器是按**主机名**整个拦截的
  （`WebViewLocalServer.isMainUrl`），填了之后 `/api/*` 也会被拦进本地产物里，
  登录请求根本发不出去。

### 怎么做的：三件

1. **改地址**（`packages/platform/src/capacitor/origin.ts`）。客户端照
   `window.location.origin` 拼出来的地址，在平台层被改指到线上那个源。只改主机名是
   `localhost` 且**不带端口**的那些，所以开发期指向 Vite 的那条不受影响。
2. **HTTP 走原生**（同目录 `network.ts`）。`requestJson` 改走 `CapacitorHttp`（核心自带）。
   原生 HTTP 由系统的网络栈发出，不经过 WebView 的同源策略，因此 CORS 那一关自动没有了；
   cookie 存在系统的 cookie 罐里（iOS 的 `HTTPCookieStorage`、安卓的 `CookieManager`），
   跨重启还在。
3. **服务端信任这两个源**（`packages/server/src/auth/betterAuth.ts` 的
   `MOBILE_TRUSTED_ORIGINS`）。better-auth 的来源检查会拿请求的 `Origin` / `Referer` 去比
   `trustedOrigins`，不加的话带着会话 cookie 的 POST 会被整条回 403 `INVALID_ORIGIN`。
   加的是 `capacitor://localhost` 和 `https://localhost`，**线上也在名单里**。
   这是 better-auth 给 Capacitor / Expo 这类壳的官方做法——它的来源匹配专门支持非标准 scheme。
   开发期那种带端口的源**没有**加：真机调试时页面和请求都从 Vite 出去、由它的代理转给
   wrangler，浏览器眼里是同源的，根本走不到这道门。

两条 WebSocket 只改地址不改别的：WebSocket 不受 CORS 管，握手的凭据是子协议里那张 JWT
不是 cookie。

服务端那一侧有测试钉着（`packages/server/test/origin.test.ts`）：两个手机源登得进来、
带着 cookie 登出也过；陌生源带着 cookie 被 403；以及**没有 Origin 头**时的现状——
better-auth 对「没有 cookie 的请求」整条跳过来源检查，所以第一次登录进得来，
但之后带 cookie 的 POST 会被判 `MISSING_OR_NULL_ORIGIN`。

### 还剩什么（只能真机验）

- **原生 HTTP 到底带不带 `Origin` 头。** `CapacitorHttp` 是系统网络栈发的请求，不是浏览器
  发的。带着 → 上面那份名单正好接住；不带 → 登录能过，但登出这类「带 cookie 的 POST」会
  403（上面那条测试就是用来钉这个分界的）。真验出来是后一种的话，最省事的补法是让
  `requestJson` 自己补一个 `Origin: capacitor://localhost`。
- **Set-Cookie 存不存得住、跨重启还在不在。** 两个系统的 cookie 罐行为不一样，本机验不了。
- **请求体会不会被原生层再包一层。** `requestJson` 传下去的 `body` 已经是序列化好的字符串。

## 横屏是怎么锁的

**写死在原生工程里，不调插件**：

- 安卓：`android/app/src/main/AndroidManifest.xml` 的 `android:screenOrientation="sensorLandscape"`；
- iOS：`ios/App/App/Info.plist` 的 `UISupportedInterfaceOrientations`（两组都只留横屏），
  外加 `UIRequiresFullScreen`——不写的话 iPad 会为了支持分屏而忽略方向限制。

写死比运行时锁可靠：应用从启动第一帧就是横的，不会先竖着画一帧再转过来，
也不用管系统的旋转锁定开没开。代价是 `platform.fullscreen.canLockOrientation()` 恒为 false
（确实没有运行时那一步），竖屏提示那颗「一键横屏」按钮于是不出现——反正屏幕也转不到竖的。

所以**没有装 `@capacitor/screen-orientation`**。

## 系统栏和安全区

系统状态栏和导航栏在启动时就藏起来，由 `capacitor.config.ts` 里
`plugins.SystemBars.hidden: true` 一条声明做掉，壳里不写代码。`SystemBars` 是 Capacitor 8
**核心自带**的，所以也**没有装 `@capacitor/status-bar`**（那个插件现在只剩
`setBackgroundColor` / `setOverlaysWebView` 这类边到边之前的老用法）。

安全区两边的来源不一样，platform 的探针两个都读、取大的那个：

- **iOS**：`env(safe-area-inset-*)`，前提是 `index.html` 里那条 `viewport-fit=cover`，
  以及 `capacitor.config.ts` 里 `ios.contentInset: 'never'`（不让 WebView 自己再让一次）。
- **安卓**：`--safe-area-inset-*` CSS 变量，由 `plugins.SystemBars.insetsHandling: 'css'` 注入。
  安卓 WebView 在边到边模式下 `env()` 会报 0，只能靠它。

验的办法：拿一台有刘海的机器（或者模拟器里选 iPhone 15 / Pixel 带挖孔的那几款）横过来，
看画面左右两侧有没有被摄像头切掉的内容。数字可以在 WebView 的调试控制台里读
（安卓：Chrome 的 `chrome://inspect`；iOS：Safari 的「开发」菜单）。

## 存储为什么还是 localStorage

**没有装 `@capacitor/preferences`**：那个插件的读写是**异步**的，而
`StorageCapability`（`packages/platform/src/storage.ts`）是同步的，接口一改所有调用方都要跟着改。
换来的好处是「数据存在 UserDefaults / SharedPreferences 里」，而 WebView 的 localStorage
本来就在应用自己的容器里、跟着应用一起备份，并没有那么脆。不值这个价。

## 图标和启动图

`assets/source/icon.svg`（站点图标）生成的，**先顶上**：

```bash
pnpm --filter @ai-duel/mobile assets:icons
```

底色用的是 `--color-page-background`（`#0d1117`），和 `capacitor.config.ts` 里两个
`backgroundColor` 是同一个值——启动到第一帧画出来之间露的就是它。
真正的图标是上线前的事。

## 为什么 CI 里只有安卓

慢档（`.github/workflows/slow.yml`）里有 `build-android` 一格：ubuntu 跑机上
`./gradlew assembleDebug`，apk 传 artifact 留三天。

iOS **没有**这一格：`xcodebuild` 只能在 macOS 跑机上跑，而 macOS 跑机比 Linux 贵十倍，
四端里它是唯一一个必须靠人工在本机验的（见上面的 `xcodebuild` 命令）。

## 还没做的

- **签名与上架**。安卓的 release 签名、iOS 的开发者证书和描述文件都没配，
  现在只出得了 debug / 不签名的包。
- **性能剧本没有跑过真机**。《正式版架构》第 1 节点名的「2018 年中端安卓」还没试过，
  接进来之后要盯（6.9 的确定性指标现在只在跑机的无头 Chromium 上跑）。
- **深链接**。房间码分享（`/match/1234`）在手机上还只能靠手输，没有配 App Links /
  Universal Links。
- **返回键**。安卓的物理返回键现在是默认行为（退出应用），没有接进路由。
