/**
 * 主进程和 preload 之间那几条 IPC 频道的名字，以及开窗口时塞给 preload 的那份快照。
 *
 * **preload 不 import 这个文件**，它自己抄了一份同样的字面量（见 src/preload.ts 的文件头）：
 * 沙箱里的 preload 只能 `require('electron')` 和几个内建模块，加载不了同目录的文件。
 * 改这里的任何一个名字都要去 preload 里改同一个。
 */

export const SHELL_CHANNELS = {
  /** 渲染进程要一张 Steam 会话票据。`invoke`/`handle`，回十六进制字符串。 */
  steamTicket: 'shell:steam-ticket',
  /** 渲染进程要进 / 退全屏。`invoke`/`handle`，回操作之后的实际状态。 */
  fullscreenSet: 'shell:fullscreen-set',
  /** 主进程告诉渲染进程全屏状态变了。玩家按 F11、点窗口按钮时也走这条。 */
  fullscreenChanged: 'shell:fullscreen-changed',
} as const

/**
 * 开窗口那一刻的状态快照，走 `webPreferences.additionalArguments` 塞进渲染进程的命令行。
 *
 * 为什么不用 IPC 问：桥上有几样东西必须是**同步**读得到的
 *（`steam.available`、`fullscreen.isActive()`，见 platform 的 electron/bridge.ts），
 * 而 `ipcRenderer.invoke` 是异步的、`sendSync` 会卡住渲染进程。
 * 命令行参数在 preload 跑起来之前就在那儿了，读它一行同步代码就够。
 */
export interface ShellSnapshot {
  steamAvailable: boolean
  personaName: string | null
  fullscreen: boolean
}

/** 快照在渲染进程命令行里的前缀。preload 里抄了同一个字面量。 */
const SNAPSHOT_ARG_PREFIX = '--ai-duel-shell='

/** 把快照拼成一个命令行参数。 */
export function snapshotArg(snapshot: ShellSnapshot): string {
  return `${SNAPSHOT_ARG_PREFIX}${JSON.stringify(snapshot)}`
}
