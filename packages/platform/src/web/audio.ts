/**
 * 音频能力的网页实现，底下是 howler.js。
 *
 * 为什么用 howler 而不是直接写 Web Audio：旧代码为了让声音在手机上正常响，自己写了
 * 三段绕——首次点击前静默解锁 AudioContext、把 ArrayBuffer 和解码结果各缓存一份、
 * 播完之后手工 disconnect 掉 source 和 gain（黑客松版的 src/ui/soundEffects.ts）。
 * 这三件事 howler 都包好了，而且它还多解决两个我们迟早会撞上的问题：
 * Web Audio 不可用时自动退回 <audio> 元素，以及淡入淡出。
 * 它是 HTML5 游戏里用得最多的音频库，接口小、无依赖，正合「不造轮子」。
 *
 * 没选 @pixi/sound：它能力上也够，但会把 Pixi 拖进 platform。platform 是给三个壳共用的，
 * 不该知道画布用的是哪个渲染引擎。
 */

import { Howl, Howler } from 'howler'
import type { AudioCapability, Playback, PlayOptions, SoundSpec } from '../audio'
import { createSignal } from '../listeners'

export function createWebAudio(): AudioCapability {
  /** 一个地址一个 Howl，多次播放共用同一份解码结果。 */
  const howls = new Map<string, Howl>()
  /** 每个声道上正在响的那一段。 */
  const channels = new Map<string, Playback>()
  const mutedChanged = createSignal<boolean>()
  const blockedChanged = createSignal<boolean>()
  let muted = false
  let blocked = readBlocked()
  /** 已经盯上 AudioContext 的状态了没有。它是**懒建**的，见 watchContext。 */
  let watching = false

  /**
   * 盯住 AudioContext 的状态变化——那就是「浏览器肯不肯出声」的变化。
   * howler 自己会在首次点击时静默解锁，这里只负责把结果报给界面。
   *
   * 要反复调而不是建的时候订一次：**howler 在第一次真的要出声之前根本不建 AudioContext**
   *（那之前 `Howler.ctx` 是 null）。只在 createWebAudio 里订一次的话，
   * 谁都订不上——应用一启动就建平台，那时一段音频都还没加载。
   */
  function watchContext(): void {
    if (watching) return
    const ctx = audioContext()
    if (ctx === null) return
    watching = true
    ctx.addEventListener('statechange', syncBlocked)
    syncBlocked()
  }

  function syncBlocked(): void {
    const next = readBlocked()
    if (next === blocked) return
    blocked = next
    blockedChanged.emit(next)
  }

  watchContext()

  function howlFor(spec: SoundSpec): Howl {
    const existing = howls.get(spec.src)
    if (existing !== undefined) return existing
    // loop 和音量都不写在这里，改成每次播放时按 id 单独设：
    // 同一个地址可能既当循环 BGM 又当一次性音效（比如试听），构造时定死就撞车了。
    const howl = new Howl({ src: [spec.src] })
    howls.set(spec.src, howl)
    // 第一段音频一建，AudioContext 就有了，这时才订得上它的状态。
    watchContext()
    return howl
  }

  function play(spec: SoundSpec, options: PlayOptions = {}): Playback {
    const howl = howlFor(spec)
    const id = howl.play()
    howl.loop(spec.loop ?? false, id)

    const volume = clamp(options.volume ?? spec.volume ?? 1)
    const fadeInMs = options.fadeInMs ?? 0
    if (fadeInMs > 0) {
      howl.volume(0, id)
      howl.fade(0, volume, fadeInMs, id)
    } else {
      howl.volume(volume, id)
    }

    const channel = options.channel
    const playback: Playback = {
      stop(fadeOutMs) {
        if (fadeOutMs !== undefined && fadeOutMs > 0) {
          // fade 事件在淡出走完时来，那时才真的停——直接 stop 会把淡出截断。
          howl.once('fade', () => howl.stop(id), id)
          howl.fade(volume, 0, fadeOutMs, id)
        } else {
          howl.stop(id)
        }
        if (channel !== undefined && channels.get(channel) === playback) channels.delete(channel)
      },
      onEnd(listener) {
        const handler = (): void => listener()
        howl.on('end', handler, id)
        return () => {
          howl.off('end', handler, id)
        }
      },
    }

    if (channel !== undefined) {
      // 同一个声道上的上一段直接掐掉，不淡出：新的一句已经开口了，
      // 旧的再拖着淡出就是两个人一起说话。
      channels.get(channel)?.stop()
      channels.set(channel, playback)
    }
    return playback
  }

  return {
    play,

    preload(specs) {
      // Howl 建出来就开始下载（howler 默认 preload），所以这里只是等它们各自有结果。
      // 永不 reject：加载失败的音只是不出声，不能挡住调用方的流程。
      const each = specs.map(
        (spec) =>
          new Promise<void>((resolve) => {
            const howl = howlFor(spec)
            if (howl.state() === 'loaded') {
              resolve()
              return
            }
            howl.once('load', () => resolve())
            howl.once('loaderror', () => resolve())
          }),
      )
      return Promise.all(each).then(() => undefined)
    },

    stopChannel(channel) {
      channels.get(channel)?.stop()
      channels.delete(channel)
    },

    setMuted(next) {
      if (muted === next) return
      muted = next
      Howler.mute(next)
      mutedChanged.emit(next)
    },
    isMuted: () => muted,
    onMutedChange: (listener) => mutedChanged.add(listener),

    isBlocked: () => blocked,
    onBlockedChange: (listener) => blockedChanged.add(listener),

    unloadAll() {
      Howler.unload()
      howls.clear()
      channels.clear()
    },
  }
}

/**
 * howler 的 AudioContext，还没建出来时是 null。
 *
 * 两种情况下拿不到它：**还没加载过任何一段音频**（howler 是懒建的，这是最常见的一种），
 * 以及环境根本没有 Web Audio（老浏览器、测试用的假 DOM，那时 howler 退回 <audio> 元素）。
 * 类型上它标的是必有，实际会给出 null，所以这里连 undefined 一起收口成 null——
 * 少了这一道，`ctx !== undefined` 会把 null 放过去，取 `ctx.state` 当场抛
 *（应用一启动建平台就会踩到）。
 */
function audioContext(): AudioContext | null {
  return (Howler.ctx as AudioContext | null | undefined) ?? null
}

/** 浏览器还拦着不肯出声。没有 AudioContext 时谈不上被拦，算不拦。 */
function readBlocked(): boolean {
  const ctx = audioContext()
  return ctx !== null && ctx.state !== 'running'
}

function clamp(volume: number): number {
  return Math.min(1, Math.max(0, volume))
}
