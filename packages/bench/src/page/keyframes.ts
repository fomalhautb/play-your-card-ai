/**
 * 跑一段剧本，在几个固定的帧号上各抓一张画面。剧本关键帧的截图回归（6.6）用。
 *
 * 单独一个文件而不是塞在 benchApi 里：这件事和「量指标」没有关系，它自己带一套
 * 数帧、插截图、抓齐就掀桌的控制流，和 benchApi 那边逐帧记录的那一套只共用一个驱动。
 */

import type { FrameDriver, Scenario, ScenarioContext } from '../scenarios/index'

/** 一段剧本抓下来的那几张图。 */
export interface KeyframeShots {
  /** PNG 的 data URL，顺序同传进去的帧号。剧本先演完的话会比要的少。 */
  shots: string[]
  /** 抓完最后一张时跑到第几帧。抓齐就收工，不会把剧本跑完。 */
  frames: number
}

export interface CaptureRequest {
  scenario: Scenario
  /** 在哪几帧上抓。帧号从被测动作的第一帧算起，热身那一遍不计。 */
  stops: readonly number[]
  /** 页面那边平时用的驱动。这里会在它外面再包一层来数帧。 */
  driver: FrameDriver
  /** 拿包好的驱动做出剧本上下文（页面侧就是 scenarios 的 createContext）。 */
  context(driver: FrameDriver): ScenarioContext
  /** 抓一张 PNG 的 data URL。必须是同步的，它插在两帧之间跑。 */
  grab(): string
}

/** 抓齐了就用它把剧本从中间掀掉。不是错，只是没有别的办法从 await 链里出来。 */
class KeyframesDone extends Error {}

/**
 * **抓齐最后一张就收工**，不把剧本跑完——最长那一段（play10）一遍是一千五百多帧，
 * 而关键帧都排在前几百帧里，跑完剩下的只是白等。
 * 帧号排到剧本长度之外时抓到的图会比要的少，调用方据此报错。
 */
export async function captureKeyframes(request: CaptureRequest): Promise<KeyframeShots> {
  const { scenario, stops, driver, grab } = request
  let frame = 0
  let capturing = false
  const shots: string[] = []
  /*
   * 包一层驱动：每推一帧就数一下，数到那几个帧号就抓一张。
   *
   * 这么做而不是「跑到第 N 帧停下来、抓完再接着跑」，是因为剧本是一串 await 出来的
   * 异步动作，中途停下再恢复要给驱动加一套闸门。抓图本身是同步的（见 grabFrame.ts），
   * 顺手插在两帧之间就行，剧本自己一无所知。
   */
  const gated: FrameDriver = {
    ...driver,
    step: () => {
      driver.step()
      if (!capturing) return
      frame += 1
      if (!stops.includes(frame)) return
      shots.push(grab())
      if (shots.length === stops.length) throw new KeyframesDone()
    },
  }
  const ctx = request.context(gated)
  // 热身那一遍照跑：不热身的话第一遍全是新烤的文字，画面和稳态那一遍不是同一张。
  await scenario.setup?.(ctx)
  capturing = true
  try {
    await scenario.run(ctx)
  } catch (error) {
    if (!(error instanceof KeyframesDone)) throw error
  }
  return { shots, frames: frame }
}
