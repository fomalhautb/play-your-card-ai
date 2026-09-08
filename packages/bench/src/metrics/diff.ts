/**
 * 计数器快照的差分和汇总。纯函数，不碰浏览器，单元测试直接在 Node 里跑。
 *
 * 页面侧在每次 step() 前后各取一次快照，用这里的 diff 得到「这一帧干了什么」；
 * 一段剧本跑完再用 summarize 压成几个数，Playwright 那边拿它和 thresholds.ts 比。
 */

import type { DuelPrototypeCounters } from '../scene/contract'
import type { FrameRecord, GlCounters, SceneDelta, SegmentSummary } from './types'

/** 全零的计数器，安装计数器和 reset 时都用它当起点。 */
export function zeroCounters(): GlCounters {
  return {
    drawElements: 0,
    drawArrays: 0,
    drawInstanced: 0,
    drawCalls: 0,
    bindTexture: 0,
    textureSwitches: 0,
    useProgram: 0,
    programSwitches: 0,
    blendFunc: 0,
    blendSwitches: 0,
    batchBreaks: 0,
    bindFramebuffer: 0,
    offscreenBinds: 0,
    texImage2D: 0,
    texSubImage2D: 0,
    compressedTexImage2D: 0,
    textureUploads: 0,
    textureBytes: 0,
    compileShader: 0,
    linkProgram: 0,
    readPixels: 0,
    getError: 0,
    getParameter: 0,
    syncCalls: 0,
  }
}

/**
 * 两次快照的差。
 *
 * `textureBytes` 特殊：它是「现在常驻多少字节」这个水位，不是累计调用次数，
 * 做差得到的是净增减、掩盖掉真实占用，所以这里直接取 after 的值。
 * 想看某一帧有没有新传纹理，看 textureUploads。
 */
export function diffCounters(before: GlCounters, after: GlCounters): GlCounters {
  const out = zeroCounters()
  for (const key of Object.keys(out) as Array<keyof GlCounters>) {
    out[key] = after[key] - before[key]
  }
  out.textureBytes = after.textureBytes
  return out
}

/**
 * 场景自己那几个计数器的差。它们都是累计值，直接减。
 *
 * 契约里的 `activeMs` 在这里被丢掉（返回类型 SceneDelta 就是「去掉它之后的样子」）：
 * 它是墙钟时间，两遍跑不可能一样，而 FrameRecord 里的每个数最后都要进
 * 「两遍完全一致」那条断言。丢在这里而不是在汇总那步，是因为这是它唯一的入口。
 */
export function diffScene(before: DuelPrototypeCounters, after: DuelPrototypeCounters): SceneDelta {
  return {
    textCreated: after.textCreated - before.textCreated,
    renders: after.renders - before.renders,
    frameRequests: after.frameRequests - before.frameRequests,
  }
}

const sum = (frames: FrameRecord[], pick: (f: FrameRecord) => number) =>
  frames.reduce((acc, f) => acc + pick(f), 0)

const max = (frames: FrameRecord[], pick: (f: FrameRecord) => number) =>
  frames.reduce((acc, f) => Math.max(acc, pick(f)), 0)

/**
 * 把一段剧本的逐帧记录压成汇总。
 *
 * 动作帧和空闲帧分开统计：上限那几条只管动作期间，空闲那几条反过来只管动作跑完之后。
 * 两边混在一起算，「空闲时帧循环为 0」这条就永远测不出来。
 */
export function summarize(segment: string, frames: FrameRecord[]): SegmentSummary {
  const action = frames.filter((f) => f.phase === 'action')
  const idle = frames.filter((f) => f.phase === 'idle')
  const last = frames[frames.length - 1]

  return {
    segment,
    frames: frames.length,
    idleFrames: idle.length,
    maxDrawCalls: max(action, (f) => f.gl.drawCalls),
    maxBatchBreaks: max(action, (f) => f.gl.batchBreaks),
    maxTextureSwitches: max(action, (f) => f.gl.textureSwitches),
    maxProgramSwitches: max(action, (f) => f.gl.programSwitches),
    maxBlendSwitches: max(action, (f) => f.gl.blendSwitches),
    maxOffscreenBinds: max(action, (f) => f.gl.offscreenBinds),
    textureUploads: sum(action, (f) => f.gl.textureUploads),
    shaderCompiles: sum(action, (f) => f.gl.compileShader),
    programLinks: sum(action, (f) => f.gl.linkProgram),
    syncCalls: sum(action, (f) => f.gl.syncCalls),
    textCreated: sum(action, (f) => f.scene.textCreated),
    peakTextureBytes: max(frames, (f) => f.gl.textureBytes),
    endTextureBytes: last ? last.gl.textureBytes : 0,
    idleRenders: sum(idle, (f) => f.scene.renders),
    idleFrameRequests: sum(idle, (f) => f.scene.frameRequests),
    idleRafRequests: sum(idle, (f) => f.rafRequests),
    renders: sum(action, (f) => f.scene.renders),
  }
}
