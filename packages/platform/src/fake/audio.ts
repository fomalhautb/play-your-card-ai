/**
 * 音频能力的假实现：不出声，只把每一次调用记下来。
 *
 * 声音是最难自动验的一类效果，所以这里的重点是「该响的时候有没有调、参数对不对」：
 * 剧本跑完一局之后，对着 calls 就能断言音效放的顺序，而不用去听。
 * 声道那条规矩（同一声道只留最新一段）也在这里实现了一遍，测试才验得到。
 */

import type { AudioCapability, Playback, SoundSpec } from '../audio'
import type { Signal } from '../listeners'
import { createSignal } from '../listeners'

export type FakeAudioCall =
  | { kind: 'preload'; sources: readonly string[] }
  | { kind: 'play'; src: string; volume: number; loop: boolean; channel: string | null }
  | { kind: 'stop'; src: string }
  | { kind: 'stopChannel'; channel: string }
  | { kind: 'muted'; muted: boolean }
  | { kind: 'unloadAll' }

export interface FakeAudio extends AudioCapability {
  /** 按发生顺序记下的每一次调用。 */
  readonly calls: readonly FakeAudioCall[]
  /** 现在还在响的地址，按开始播放的先后。 */
  playing(): readonly string[]
  /**
   * 让某个地址上正在响的那一段播完，触发它的 onEnd。
   * 循环音也用它——「转完一圈回到开头」在接口上就是一次 onEnd。
   */
  finish(src: string): void
  /** 改「浏览器肯不肯出声」的状态，并通知订阅者。 */
  setBlocked(blocked: boolean): void
}

interface FakePlayback extends Playback {
  src: string
  ended: Signal<void>
  stopped: boolean
}

export function createFakeAudio(): FakeAudio {
  const calls: FakeAudioCall[] = []
  const active: FakePlayback[] = []
  const channels = new Map<string, FakePlayback>()
  const mutedChanged = createSignal<boolean>()
  const blockedChanged = createSignal<boolean>()
  let muted = false
  let blocked = false

  function drop(playback: FakePlayback): void {
    const index = active.indexOf(playback)
    if (index >= 0) active.splice(index, 1)
    for (const [channel, current] of channels) {
      if (current === playback) channels.delete(channel)
    }
  }

  function play(spec: SoundSpec, options: { channel?: string; volume?: number } = {}): Playback {
    const ended = createSignal()
    const playback: FakePlayback = {
      src: spec.src,
      ended,
      stopped: false,
      stop() {
        if (playback.stopped) return
        playback.stopped = true
        calls.push({ kind: 'stop', src: spec.src })
        drop(playback)
      },
      onEnd: (listener) => ended.add(listener),
    }

    const channel = options.channel ?? null
    if (channel !== null) {
      // 同一声道上的上一段直接掐掉，和 web 实现一个规矩。
      channels.get(channel)?.stop()
      channels.set(channel, playback)
    }
    active.push(playback)
    calls.push({
      kind: 'play',
      src: spec.src,
      volume: options.volume ?? spec.volume ?? 1,
      loop: spec.loop ?? false,
      channel,
    })
    return playback
  }

  return {
    calls,
    play,

    preload(specs) {
      calls.push({ kind: 'preload', sources: specs.map((spec) => spec.src) })
      return Promise.resolve()
    },
    stopChannel(channel) {
      calls.push({ kind: 'stopChannel', channel })
      channels.get(channel)?.stop()
      channels.delete(channel)
    },

    setMuted(next) {
      if (muted === next) return
      muted = next
      calls.push({ kind: 'muted', muted: next })
      mutedChanged.emit(next)
    },
    isMuted: () => muted,
    onMutedChange: (listener) => mutedChanged.add(listener),

    isBlocked: () => blocked,
    onBlockedChange: (listener) => blockedChanged.add(listener),

    unloadAll() {
      calls.push({ kind: 'unloadAll' })
      active.length = 0
      channels.clear()
    },

    playing: () => active.map((playback) => playback.src),
    finish(src) {
      // 拷一份再遍历：onEnd 的监听器多半会顺手停掉这一段，那会改到 active。
      for (const playback of [...active]) {
        if (playback.src !== src) continue
        playback.ended.emit()
        drop(playback)
      }
    },
    setBlocked(next) {
      if (blocked === next) return
      blocked = next
      blockedChanged.emit(next)
    },
  }
}
