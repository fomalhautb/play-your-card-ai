/**
 * 渲染进程和主进程之间那座桥：`window.aiDuelShell`。
 *
 * 页面里唯一能碰到本机的就是这一个对象，上面只有三样东西（Steam、全屏、壳的种类）。
 * 消费它的是 `packages/platform/src/electron/`，那边有一份**一模一样的形状声明**
 *（`ShellBridge`），改一处要一起改——跨包只走包入口，而库不能反过来依赖壳。
 *
 * ## 这个文件为什么不 import 同目录的别的文件
 *
 * preload 跑在**沙箱**里（`sandbox: true`，见 src/window.ts）。沙箱里的 preload 只有一个
 * 阉割过的 `require`，加载得了 `electron` 和几个 Node 内建模块，加载不了同目录的源文件。
 * 所以下面那三条频道名和那个参数前缀是从 src/channels.ts **抄**过来的，改名要两处一起改。
 *
 * ## 为什么快照走命令行而不是 IPC
 *
 * 桥上有两样必须**同步**读得到：`steam.available` 和 `fullscreen.isActive()`
 *（七项能力里这几个方法本身就是同步的）。`ipcRenderer.invoke` 是异步的，
 * `sendSync` 会把渲染进程卡住。命令行参数在 preload 跑起来之前就在那儿了，读它不花任何时间。
 */

import { contextBridge, ipcRenderer } from 'electron'

/** 抄自 src/channels.ts 的 `SHELL_CHANNELS`。 */
const CHANNEL_STEAM_TICKET = 'shell:steam-ticket'
const CHANNEL_FULLSCREEN_SET = 'shell:fullscreen-set'
const CHANNEL_FULLSCREEN_CHANGED = 'shell:fullscreen-changed'
/** 抄自 src/channels.ts 的 `SNAPSHOT_ARG_PREFIX`。 */
const SNAPSHOT_ARG_PREFIX = '--ai-duel-shell='

interface ShellSnapshot {
  steamAvailable: boolean
  personaName: string | null
  fullscreen: boolean
}

/** 主进程开窗口时塞进命令行的那份状态。读不到就按「什么都没有」算。 */
function readSnapshot(): ShellSnapshot {
  const fallback: ShellSnapshot = { steamAvailable: false, personaName: null, fullscreen: false }
  const arg = process.argv.find((entry) => entry.startsWith(SNAPSHOT_ARG_PREFIX))
  if (arg === undefined) return fallback
  try {
    return { ...fallback, ...(JSON.parse(arg.slice(SNAPSHOT_ARG_PREFIX.length)) as ShellSnapshot) }
  } catch {
    return fallback
  }
}

const snapshot = readSnapshot()
/** 全屏状态的本地副本，主进程一推就更新。`isActive()` 读的就是它。 */
let fullscreen = snapshot.fullscreen
/** 订阅 `onChange` 的人。用 Set 是为了同一个函数注册两次只留一份，退订也就不会误删别人的。 */
const listeners = new Set<(active: boolean) => void>()

ipcRenderer.on(CHANNEL_FULLSCREEN_CHANGED, (_event, active: boolean) => {
  fullscreen = active
  // 先拷一份再遍历：监听器在回调里退订自己是常见写法，直接遍历原 Set 会漏掉后面的人。
  for (const listener of [...listeners]) listener(active)
})

contextBridge.exposeInMainWorld('aiDuelShell', {
  kind: 'electron',
  steam: {
    available: snapshot.steamAvailable,
    personaName: snapshot.personaName,
    authTicket: (): Promise<string> => ipcRenderer.invoke(CHANNEL_STEAM_TICKET) as Promise<string>,
  },
  fullscreen: {
    isActive: (): boolean => fullscreen,
    set: (active: boolean): Promise<boolean> =>
      ipcRenderer.invoke(CHANNEL_FULLSCREEN_SET, active) as Promise<boolean>,
    onChange: (listener: (active: boolean) => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  },
})
