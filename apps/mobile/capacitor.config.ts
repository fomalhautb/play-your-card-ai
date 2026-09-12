import type { CapacitorConfig } from '@capacitor/cli'

/**
 * iOS / Android 壳的全部配置。`cap sync` 会把这里的值写进两个原生工程
 *（Android 是 `android/app/src/main/assets/capacitor.config.json`，iOS 是 `App/App/capacitor.config.json`），
 * 所以改这份文件之后要重新 sync 才生效。
 *
 * ## 页面的源，以及为什么这里**没有**配 `server.hostname`
 *
 * Steam 壳把本地产物挂到了线上那个域名下面，图的是同源（见 apps/steam/src/site.ts）。
 * Capacitor 里同样的招数两条路都走不通：
 * - iOS 的 WKWebView 不让给 https 注册协议处理器，`server.iosScheme` 只能是非标准 scheme，
 *   页面的源必然是 `capacitor://localhost`；
 * - Android 上 `server.hostname` 填线上域名倒是能改源，但 Capacitor 的本地服务器是按主机名
 *   整个拦截的，填了之后 `/api/*` 也被拦进本地产物里，登录那几条请求根本发不出去。
 *
 * 所以这份配置保留默认的本机源，改地址这件事放在平台层做
 *（见 packages/platform/src/capacitor/origin.ts）。剩下的那半个问题——跨源的会话 cookie
 * ——见 README 的「同源这件事」。
 */

/**
 * 开发时直接加载的地址，真机调试用。
 *
 * 形如 `CAP_SERVER_URL=http://192.168.1.7:5176 pnpm --filter @ai-duel/mobile sync:android`。
 * **必须是局域网 IP 不是 localhost**：localhost 在手机上指的是手机自己。
 * 不给就走「本地产物 + 线上服务端」那条，也就是打包之后的样子。
 */
const devUrl = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  /*
   * 反着写的域名。这个值同时是 Android 的包名和 iOS 的 bundle id，**一旦上架就不能再改**
   *（改了等于换一个应用，老用户收不到更新）。
   */
  appId: 'online.playyourcardai.app',
  // 桌面上图标下面那行字。不用「出牌吧，AI！」是因为全角标点在两个系统的应用名里都会被挤掉或者截断。
  appName: '出牌吧AI',
  /*
   * 网页产物在哪。是这个包自己的 `dist/`，不是 `../web/dist`——
   * 两个壳差的正是入口那一行（平台实现不同），理由见 vite.config.mts 的文件头。
   */
  webDir: 'dist',
  // 页底色，两个系统各一份。和 --color-page-background 同一个值：
  // 启动到第一帧画出来之间那一瞬间露的是它，不设的话露的是白色，黑底游戏上非常刺眼。
  android: {
    backgroundColor: '#0d1117',
  },
  ios: {
    backgroundColor: '#0d1117',
    /*
     * 关掉 WebView 自己的滚动和回弹。整个游戏是一块铺满屏幕的画布，没有可滚的东西，
     * 而 iOS 默认的橡皮筋效果会让玩家拖手牌时整个页面跟着晃。
     */
    scrollEnabled: false,
    /*
     * 不让 WebView 自动给内容加安全区内边距。
     * 让开多少由代码自己算（`env(safe-area-inset-*)`，见 platform 的 safeArea），
     * 两边都让一次的话刘海那边会空出双份。
     */
    contentInset: 'never',
  },
  ...(devUrl === undefined
    ? {}
    : {
        server: {
          url: devUrl,
          // 开发服务器是明文 http，安卓从 API 28 起默认不许。只在指定了 CAP_SERVER_URL 时才开。
          cleartext: true,
        },
      }),
  plugins: {
    SystemBars: {
      /*
       * 启动就把状态栏和导航栏藏起来，不用壳里写代码。
       * 横版游戏被卡住的正是高度，少两条栏画面就大一圈。
       * 玩家从屏幕边缘划出来的那一下是系统的临时手势，手一松自己收回去。
       */
      hidden: true,
      /*
       * 安卓上注入一组 `--safe-area-inset-*` CSS 变量。默认就是 'css'，写出来是因为
       * **安全区全靠它**：安卓 WebView 在边到边模式下 `env(safe-area-inset-*)` 会报 0，
       * 那时刘海和底部手势条就没人让位了。platform 的探针两个来源取大的那个
       *（见 packages/platform/src/web/safeArea.ts）。
       */
      insetsHandling: 'css',
    },
  },
}

export default config
