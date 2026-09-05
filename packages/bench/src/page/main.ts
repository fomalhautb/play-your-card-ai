/**
 * 测量页面的入口：把 `window.__bench` 挂上去。
 *
 * 计数器不在这里装。它必须赶在 Pixi 创建上下文之前，而这个文件的 import 里就有 Pixi，
 * 所以安装那一步放在 install.ts，由 index.html 用**前一个** script 标签单独引入。
 * 详见 index.html 里那段注释。
 *
 * 页面本身不自动跑任何东西——什么时候 init、跑哪段剧本，全由 Playwright 那边说了算。
 */

import type { BenchApi } from './benchApi'
import { createBenchApi } from './benchApi'
import { frameLoop, glCounters } from './install'
import { installRenderProbe } from './renderProbe'

declare global {
  interface Window {
    __bench: BenchApi
  }
}

window.__bench = createBenchApi(glCounters, frameLoop, installRenderProbe())

const status = document.getElementById('status')
if (status) status.textContent = `就绪，可跑的剧本：${window.__bench.segments().join('、')}`
