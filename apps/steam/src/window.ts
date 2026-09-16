/**
 * 开游戏窗口，并且把它关在门里：只准待在自己那个源上。
 *
 * 三条隔离全部是 Electron 的默认值，这里**明写出来**是因为它们是这个壳的安全底线，
 * 而默认值是会随版本变的：
 * - `contextIsolation`：页面和 preload 各跑各的 JS 上下文，页面拿不到 preload 的东西，
 *   只看得见 `contextBridge` 显式露出去的那一个对象；
 * - `nodeIntegration: false`：页面里没有 `require`、没有 `process`；
 * - `sandbox`：渲染进程跑在操作系统的沙箱里，Chromium 真被打穿了也出不来。
 *
 * 页面里唯一能碰到本机的就是那座桥（src/preload.ts），而桥上只有三样东西。
 */

import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { snapshotArg } from './channels'
import { SITE_ORIGIN } from './config'
import { isSteamAvailable, steamPersonaName } from './steam'

/**
 * 窗口的初始大小。16:9，比 1280×720 大一档——对局界面**宽**超过 768 才走「有侧栏」那一档版式
 *（见 canvas 的 pickLayout），窗口一开就该是玩家真正会看到的那一档。
 */
const DEFAULT_WIDTH = 1440
const DEFAULT_HEIGHT = 810
/** 再小就没法玩了：宽低于这个尺寸对局界面会被挤成另一档版式。 */
const MIN_WIDTH = 1024
const MIN_HEIGHT = 640

export function createGameWindow(startUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // 底色和页面的纸色对齐，省掉「窗口先白一下再变深」那一闪。
    backgroundColor: '#1b1a17',
    // 先不显示，等第一帧画好了再亮出来（下面的 ready-to-show）。
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      /*
       * 开窗口那一刻的状态快照，塞进渲染进程的命令行给 preload 读。
       * 走命令行而不是 IPC：桥上有几样东西必须同步读得到（见 src/channels.ts）。
       */
      additionalArguments: [
        snapshotArg({
          steamAvailable: isSteamAvailable(),
          personaName: steamPersonaName(),
          fullscreen: false,
        }),
      ],
    },
  })

  /*
   * 不给窗口配菜单栏。
   *
   * 默认菜单里有「重新加载」「强制重新加载」「开发者工具」这些，对玩家没有意义；
   * 在 Windows 和 Linux 上它还会占掉窗口顶上一条，把 16:9 的画面压扁。
   * macOS 的菜单在屏幕顶栏上，是应用级的，不受这一句影响。
   */
  window.removeMenu()

  // 等第一帧画好再显示，避免玩家看到一个空白窗口愣几百毫秒。
  window.once('ready-to-show', () => window.show())

  /*
   * 页面只准待在自己那个源上。
   *
   * 玩家点到一个外链时（关于页里的链接），应该在系统浏览器里打开，
   * 而不是把游戏窗口自己导航走——导航走了就再也回不来（没有地址栏，也没有后退键）。
   * `setWindowOpenHandler` 管 `target="_blank"` 和 `window.open`，
   * `will-navigate` 管页面自己改地址那一类。
   */
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === new URL(startUrl).origin) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  void window.loadURL(startUrl)
  return window
}

/** 窗口该加载哪个地址：开发时是开发服务器，否则是挂在本地产物上的那个源。 */
export function startUrlFor(devUrl: string | null): string {
  return devUrl ?? `${SITE_ORIGIN}/`
}
