/**
 * 剧本的驱动循环和注册表。
 *
 * 6.9 的前提是「脚本化性能场景」：没有确定性的剧本，所有数字都是噪声。
 * 驱动写法是固定的——发起动作，然后一帧一帧 step() 到动作的 Promise 兑现，再推到空闲。
 *
 * 现在有对局那三段（duel.ts）加一轮结算（settle.ts）。牌组编辑滚动、开包以后各加一个文件，
 * 在 SCENARIOS 里登记一下就能单独跑。
 */

import type { BenchScene } from '../scene/contract'
import { DUEL_SCENARIOS } from './duel'
import { settle } from './settle'
import type { FrameDriver, Scenario, ScenarioContext } from './types'

export type { FrameDriver, Scenario, ScenarioContext } from './types'
export { FRAME_MS } from './types'

/** 单段剧本最多推多少帧。推不完说明动作的 Promise 永远不兑现，早点报错比挂死强。 */
const MAX_FRAMES = 3000

/**
 * 让微任务队列跑干净再进下一帧。
 *
 * 不能只 `await Promise.resolve()`：动作里是 `await Promise.all(...)` 接着又起新补间，
 * 这条链要好几个微任务才走到「新补间已经建好」。少等一步，循环会在动画其实还没完的时候
 * 看到 isIdle() 为 true 就退出，然后卡在 await 上——时钟由我们推，没人能再推动它。
 *
 * 用 MessageChannel 而不是 setTimeout：setTimeout 嵌套超过 5 层会被浏览器钳到 4 毫秒，
 * 一段几百帧的剧本要多花好几秒。
 */
let taskChannel: MessageChannel | null = null
let pendingTask: (() => void) | null = null

function nextTask(): Promise<void> {
  // 一个通道复用到底。每帧新建一个 MessageChannel 是几百字节的垃圾，
  // 而「稳态每帧堆分配」量的是场景，骨架自己不该出现在那个数里。
  if (!taskChannel) {
    taskChannel = new MessageChannel()
    taskChannel.port1.onmessage = () => {
      const resolve = pendingTask
      pendingTask = null
      resolve?.()
    }
  }
  return new Promise((resolve) => {
    pendingTask = resolve
    taskChannel?.port2.postMessage(null)
  })
}

async function pump(driver: FrameDriver, until: () => boolean, label: string): Promise<void> {
  let frames = 0
  while (!until()) {
    if (frames >= MAX_FRAMES) throw new Error(`剧本「${label}」推了 ${MAX_FRAMES} 帧还没结束`)
    frames += 1
    if (driver.manual) driver.step()
    else await driver.waitFrame()
    await nextTask()
  }
}

export function createContext(scene: BenchScene, driver: FrameDriver): ScenarioContext {
  return {
    scene,
    async act(start) {
      let settled = false
      const done = start().then(() => {
        settled = true
      })
      await pump(driver, () => settled, '动作')
      await done
      await pump(driver, () => scene.isIdle(), '收尾')
    },
    async settle() {
      await pump(driver, () => scene.isIdle(), '收尾')
    },
  }
}

/** 剧本跑完之后的空转：这几帧里 renders 和 frameRequests 必须不再增长（纪律 3.6）。 */
export async function runIdle(driver: FrameDriver, frames: number): Promise<void> {
  for (let i = 0; i < frames; i += 1) {
    if (driver.manual) driver.step()
    else await driver.waitFrame()
    await nextTask()
  }
}

export const SCENARIOS: Readonly<Record<string, Scenario>> = { ...DUEL_SCENARIOS, settle }

export function scenarioNames(): string[] {
  return Object.keys(SCENARIOS)
}
