/**
 * 把 `steamworks.js` 包起来：初始化一次，之后只对外露「在不在、昵称、取一张票据」。
 *
 * ## 为什么只在主进程里加载
 *
 * 它是原生模块（napi-rs 编译出来的 `.node`）。要在渲染进程里直接 `require` 它，
 * 就得把 `contextIsolation` 关掉、`nodeIntegration` 打开——那是拿整个渲染进程的隔离
 * 换一个功能，页面里任何一处脚本注入都会变成本机代码执行。
 * 所以它留在主进程，渲染进程只经 preload 那座桥拿结果（见 src/preload.ts）。
 *
 * ## 初始化失败是正常情况
 *
 * Steam 客户端没开、这个 appId 没权限、在 CI 上跑——`init()` 都会抛。
 * 那时整个游戏照样要能玩（走游客登录），所以这里一律吞掉异常、把「没有 Steam」记下来。
 */

import { STEAM_APP_ID, STEAM_TICKET_IDENTITY } from './config'

/**
 * `steamworks.js` 在类型上没导出「init 之后拿到的那个客户端」，这里按用到的两处补一份。
 * 全貌见它包里的 `client.d.ts`。
 */
interface SteamClient {
  localplayer: { getName(): string }
  auth: {
    getAuthTicketForWebApi(identity: string, timeoutSeconds?: number): Promise<SteamTicket>
  }
}

interface SteamModule {
  init(appId?: number): SteamClient
  electronEnableSteamOverlay(disableEachFrameInvalidation?: boolean): void
}

/** 一张取出来的票据。只用到这两个方法。 */
interface SteamTicket {
  getBytes(): Uint8Array
  cancel(): void
}

/** 取票据的等待上限。Steam 客户端在线时是毫秒级，离线登录时会一直等，所以必须封顶。 */
const TICKET_TIMEOUT_SECONDS = 10

let client: SteamClient | null = null
let personaName: string | null = null
/** 上一张还没取消的票据，见 `steamAuthTicket`。 */
let lastTicket: SteamTicket | null = null

/**
 * 初始化 Steam。**必须在 `app.whenReady()` 之前调**：成功之后要开 Steam 覆盖层，
 * 而那一步会往 Chromium 的命令行里塞开关，命令行在 ready 之后就定死了。
 *
 * 返回有没有成功。失败不抛错——没有 Steam 也要能玩。
 */
export function initSteam(): boolean {
  let steamworks: SteamModule
  try {
    // 动态 require 而不是文件顶部的 import：这个模块一加载就会去 dlopen 那个 `.node`，
    // 而在没有对应平台预编译产物的机器上（比如未来某个新架构）那一下就会抛。
    // 放在 try 里，失败也只是「这台机器上没有 Steam」。
    steamworks = require('steamworks.js') as SteamModule
    client = steamworks.init(STEAM_APP_ID)
    personaName = client.localplayer.getName()
  } catch (cause) {
    console.warn('[steam] 初始化失败，按「没有 Steam」处理：', cause)
    client = null
    return false
  }

  try {
    /*
     * Steam 覆盖层（玩家按 Shift+Tab 叫出来的那一层）。
     *
     * 它做两件事：往命令行塞 `in-process-gpu` 和 `disable-direct-composition`
     *（覆盖层要和游戏共用一个 GPU 进程才画得上去），以及给每个窗口挂一个 60Hz 的
     * `webContents.invalidate()`。
     *
     * 那个 60Hz 的重绘和「没动画就停帧」那条纪律（canvas/runtime/frameLoop.ts）是冲突的，
     * 但**不能关**：关掉之后画面完全静止时窗口不再提交新帧，覆盖层会卡在上一帧上，
     * 玩家看到的是一个按了没反应的 Shift+Tab。重绘的只是合成器那一层
     *（Pixi 没画新东西时纹理还是旧的），代价比重跑一遍场景小得多。
     */
    steamworks.electronEnableSteamOverlay()
  } catch (cause) {
    // 覆盖层开不起来不影响玩，只是 Shift+Tab 没反应。
    console.warn('[steam] 覆盖层没能开起来：', cause)
  }
  return true
}

export function isSteamAvailable(): boolean {
  return client !== null
}

export function steamPersonaName(): string | null {
  return personaName
}

/**
 * 现取一张会话票据，转成十六进制字符串交给服务端去验。
 *
 * **每次现取，不缓存**：票据是一次性的（服务端验过就作废）而且有有效期。
 * `identity` 要和服务端验票据时传的那个一样，对不上 Valve 会拒（见 config.ts）。
 */
export async function steamAuthTicket(): Promise<string> {
  if (client === null) throw new Error('Steam 没在跑')
  const ticket = await client.auth.getAuthTicketForWebApi(
    STEAM_TICKET_IDENTITY,
    TICKET_TIMEOUT_SECONDS,
  )
  /*
   * 取到新的之后，把**上一张**取消掉，而不是取完字节就把这一张取消掉。
   *
   * Steam 对「同时活着的票据数」有上限，一张都不取消的话玩家每重连一次就漏一张，
   * 打几局之后再也取不出票据；但立刻取消这一张也不行——`CancelAuthTicket` 是
   *「这张票作废」的意思，而此刻服务端还没拿它去问 Valve，取消了就是自己把自己的票撕了。
   * 所以永远只留最新的那一张活着。
   */
  lastTicket?.cancel()
  lastTicket = ticket
  return [...ticket.getBytes()].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
