/**
 * Steam 壳的主进程（迁移第 35 条）。
 *
 * 壳里不写业务：这一整个目录只做四件事——初始化 Steam、把前端产物挂到线上那个源上、
 * 开一个窗口、把三条 IPC 接上。游戏本身是 `@ai-duel/client` 的 `App`，跑在渲染进程里
 *（见 src/renderer/main.tsx）。
 *
 * 顺序是定死的：
 * 1. `initSteam()` **在 `app.whenReady()` 之前**——Steam 覆盖层要往 Chromium 的命令行里
 *    塞开关，而命令行在 ready 之后就定死了（见 src/steam.ts）；
 * 2. ready 之后才装协议处理器（`protocol.handle` 要求如此），而且只装一次；
 * 3. 最后开窗口。
 */

import { join } from 'node:path'
import { app, type BrowserWindow, ipcMain } from 'electron'
import { SHELL_CHANNELS } from './channels'
import { devUrl } from './config'
import { serveSiteFromDisk } from './site'
import { initSteam, steamAuthTicket } from './steam'
import { createGameWindow, startUrlFor } from './window'

/**
 * 前端构建产物在哪。主进程的代码编译到 `dist/main/`，渲染进程的产物在 `dist/renderer/`，
 * 所以从 `__dirname` 往上一层再拐进去。
 */
const RENDERER_ROOT = join(__dirname, '..', 'renderer')

/** 现在开着的那个窗口。macOS 上关掉窗口应用还活着，所以它会在 null 和有值之间来回。 */
let gameWindow: BrowserWindow | null = null

/**
 * 同一时间只准开一个游戏实例。
 *
 * 两个实例会各自连一条大厅 WebSocket、各自抢同一个账号的座位，服务端只会认最后连上的那条
 *（`CLOSE_SUPERSEDED`），玩家看到的是自己把自己顶掉了。第二个实例直接退出，
 * 把已经开着的那个窗口叫到前面来。
 */
function claimSingleInstance(): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => {
    if (gameWindow === null) return
    if (gameWindow.isMinimized()) gameWindow.restore()
    gameWindow.focus()
  })
  return true
}

/**
 * 三条 IPC。渲染进程能碰到本机的全部就是这几条（见 src/preload.ts）。
 *
 * **只装一次**（`ipcMain.handle` 对同一条频道装第二次会抛），所以它认的是
 * 「此刻那个窗口」而不是某一个具体的窗口对象——macOS 上窗口会被关掉再开回来。
 */
function wireIpc(): void {
  ipcMain.handle(SHELL_CHANNELS.steamTicket, () => steamAuthTicket())
  ipcMain.handle(SHELL_CHANNELS.fullscreenSet, (_event, active: boolean) => {
    if (gameWindow === null) return false
    gameWindow.setFullScreen(active)
    return gameWindow.isFullScreen()
  })
}

/**
 * 全屏状态变了就推给渲染进程。
 *
 * 这两条事件是必须的，不能只靠 `fullscreenSet` 回的那个值：玩家还可以按 F11、
 * 点窗口自己的全屏按钮、或者在 macOS 上用触发角退出全屏，那几条路一个都不经过 IPC。
 * 页面里 `document` 那套 `fullscreenchange` 事件在这种情况下一声不响
 *（全屏的是窗口，不是页面里的元素）。
 */
function watchFullscreen(window: BrowserWindow): void {
  const push = (active: boolean): void => {
    window.webContents.send(SHELL_CHANNELS.fullscreenChanged, active)
  }
  window.on('enter-full-screen', () => push(true))
  window.on('leave-full-screen', () => push(false))
}

function openWindow(): void {
  const window = createGameWindow(startUrlFor(devUrl()))
  gameWindow = window
  watchFullscreen(window)
  window.on('closed', () => {
    gameWindow = null
  })
}

function start(): void {
  // 开发时页面由 Vite 发（它自己的代理把 /api 转给 wrangler），不需要接管 https。
  if (devUrl() === null) serveSiteFromDisk(RENDERER_ROOT)
  wireIpc()
  openWindow()
}

if (claimSingleInstance()) {
  // 失败也照跑：没有 Steam 时游戏走游客登录（见 packages/client/src/auth/session.ts）。
  initSteam()

  app.whenReady().then(start, (cause: unknown) => {
    console.error('[shell] 起不来：', cause)
    app.quit()
  })

  /*
   * macOS 上关掉所有窗口不等于退出应用（Dock 里还留着图标，点一下要能开回来），
   * 别的系统上关了就是退了。两条都是各自系统的老规矩。
   */
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => {
    if (gameWindow === null) openWindow()
  })
}
