import { describe, expect, it } from 'vitest'
import { diffCounters, diffScene, summarize, zeroCounters } from '../src/metrics/diff'
import type { FrameRecord, GlCounters } from '../src/metrics/types'

const counters = (patch: Partial<GlCounters>): GlCounters => ({ ...zeroCounters(), ...patch })

const frame = (
  index: number,
  phase: FrameRecord['phase'],
  gl: Partial<GlCounters>,
  scene: Partial<FrameRecord['scene']> = {},
  rafRequests = 0,
): FrameRecord => ({
  index,
  phase,
  gl: counters(gl),
  scene: { textCreated: 0, renders: 0, frameRequests: 0, ...scene },
  rafRequests,
})

describe('diffCounters', () => {
  it('累计值做差', () => {
    const before = counters({ drawCalls: 10, bindTexture: 4 })
    const after = counters({ drawCalls: 13, bindTexture: 9 })
    const delta = diffCounters(before, after)
    expect(delta.drawCalls).toBe(3)
    expect(delta.bindTexture).toBe(5)
  })

  it('常驻纹理内存取快照值而不是差值', () => {
    // 它是「现在占了多少」这个水位，不是速率。做差会得到 0，
    // 于是「常驻纹理内存」这条上限永远通过——那正是这条断言要挡住的回归。
    const before = counters({ textureBytes: 1_000_000 })
    const after = counters({ textureBytes: 1_000_000 })
    expect(diffCounters(before, after).textureBytes).toBe(1_000_000)
  })

  it('删纹理导致的下降也照实反映', () => {
    const before = counters({ textureBytes: 900 })
    const after = counters({ textureBytes: 400 })
    expect(diffCounters(before, after).textureBytes).toBe(400)
  })
})

describe('diffScene', () => {
  it('三个计数器都是累计值，直接减', () => {
    const delta = diffScene(
      { textCreated: 3, renders: 100, frameRequests: 90 },
      { textCreated: 3, renders: 101, frameRequests: 92 },
    )
    expect(delta).toEqual({ textCreated: 0, renders: 1, frameRequests: 2 })
  })
})

describe('summarize', () => {
  const frames: FrameRecord[] = [
    frame(0, 'action', { drawCalls: 5, batchBreaks: 3, textureUploads: 1, textureBytes: 100 }),
    frame(
      1,
      'action',
      { drawCalls: 9, batchBreaks: 7, syncCalls: 2, textureBytes: 300 },
      {
        renders: 1,
        textCreated: 1,
      },
    ),
    frame(2, 'idle', { drawCalls: 0, textureBytes: 250 }, { renders: 0, frameRequests: 0 }),
    frame(3, 'idle', { drawCalls: 0, textureBytes: 250 }, { renders: 1, frameRequests: 2 }, 3),
  ]

  it('峰值只看动作帧，空转帧不参与', () => {
    const summary = summarize('play10', frames)
    expect(summary.maxDrawCalls).toBe(9)
    expect(summary.maxBatchBreaks).toBe(7)
    expect(summary.textureUploads).toBe(1)
    expect(summary.syncCalls).toBe(2)
    expect(summary.textCreated).toBe(1)
  })

  it('空闲那几条只看空转帧', () => {
    const summary = summarize('play10', frames)
    // 动作帧里的 renders 不能算进 idleRenders，否则「空闲时帧循环为 0」永远失败。
    expect(summary.idleRenders).toBe(1)
    expect(summary.idleFrameRequests).toBe(2)
    expect(summary.idleRafRequests).toBe(3)
    expect(summary.renders).toBe(1)
  })

  it('常驻纹理内存取全程峰值，结束值取最后一帧', () => {
    const summary = summarize('play10', frames)
    expect(summary.peakTextureBytes).toBe(300)
    expect(summary.endTextureBytes).toBe(250)
  })

  it('一帧都没有时不崩，全是 0', () => {
    const summary = summarize('empty', [])
    expect(summary.frames).toBe(0)
    expect(summary.peakTextureBytes).toBe(0)
    expect(summary.endTextureBytes).toBe(0)
  })
})
