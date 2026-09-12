/**
 * Steam 能力的 Electron 实现：把桥上的三样原样转过来。
 *
 * 这一层薄得几乎没有内容，留着是因为**真正的实现在主进程**——`steamworks.js` 是原生模块，
 * 渲染进程里加载不了（加载得了也意味着要关掉 `contextIsolation`，那是拿整个渲染进程换一个功能）。
 * 所以这里的活只有「把桥的形状翻译成七项能力那套形状」。
 */

import type { SteamCapability } from '../steam'
import type { ShellSteamBridge } from './bridge'

export function createElectronSteam(bridge: ShellSteamBridge): SteamCapability {
  return {
    isAvailable: () => bridge.available,
    authTicket: () => bridge.authTicket(),
    personaName: () => bridge.personaName,
  }
}
