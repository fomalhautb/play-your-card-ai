/**
 * 四首循环背景音乐，一次只响一首。
 *
 * 界面只说「这一页该听哪首」，切歌、不重开、循环回绕通知都在这里。
 * 播放走 `platform.audio`，这个模块只持有「现在放的是哪一首」这一点状态。
 *
 * 是 .m4a（AAC 96 kbps）而不是 mp3：同样的听感省掉一半体积。换/加曲目先转格式，
 * 别把 mp3 丢进 assets/source/music/（见 assets/README.md）。
 */

import type { Platform, Playback } from '@ai-duel/platform'
import { volumeOf } from './loudness'

export type MusicTrack = 'beginning' | 'room' | 'cardsSelecting' | 'match'

/**
 * 每首曲子的地址。
 *
 * 音量照旧版的 0.9，再按整套声音的基准缩一次（见 loudness.ts）：
 * 背景音乐要压在人声和音效底下，这个配比是旧版调好的。
 *
 * 导出是给 test/assetManifests.test.ts 用的：它核对这四个地址和 assets/source/music/ 下的
 * 文件对不对得上。改文件名而没改这里的话，进那一页只是安静，一个错都不报。
 */
export const MUSIC_TRACKS: Record<MusicTrack, string> = {
  beginning: '/audio/music/beginning.m4a',
  room: '/audio/music/room.m4a',
  cardsSelecting: '/audio/music/cards_selecting.m4a',
  match: '/audio/music/match.m4a',
}

const MUSIC_VOLUME = volumeOf(0.9)

/** 背景音乐独占的声道：切歌时 platform 会自己把上一首掐掉，这里不用手动停。 */
const MUSIC_CHANNEL = 'music'

/** 换歌时的淡入，避免上一首戛然而止、下一首硬切进来。 */
const CROSSFADE_MS = 400

interface Current {
  track: MusicTrack
  playback: Playback
  /** 退订这一首的循环回绕通知。切歌时要摘掉，否则上一首的监听器会一路攒下去。 */
  unsubscribe: () => void
}

let current: Current | null = null
/** 订阅「某一首循环回了开头」的人。按曲目分开记，首页那句问候只关心 beginning。 */
const replayListeners = new Map<MusicTrack, Set<() => void>>()

/**
 * 让这一页独占一首循环背景音乐。
 *
 * 已经在放同一首就什么都不做——这是这个函数最要紧的一条：路由每重挂一次组件就重开一次的话，
 * 玩家在同一段音乐里来回切页面会听到它反复从头开始。
 */
export function playTrack(platform: Platform, track: MusicTrack): void {
  if (current?.track === track) return
  current?.unsubscribe()

  const playback = platform.audio.play(
    { src: MUSIC_TRACKS[track], loop: true, volume: MUSIC_VOLUME },
    { channel: MUSIC_CHANNEL, fadeInMs: CROSSFADE_MS },
  )
  // 循环音每转一圈也算一次 onEnd（platform 的 Playback 说明），首页那句问候就靠它接力。
  const unsubscribe = playback.onEnd(() => {
    for (const listener of [...(replayListeners.get(track) ?? [])]) listener()
  })
  current = { track, playback, unsubscribe }
}

/**
 * 停掉背景音乐。离开最后一个有音乐的界面时调；正常的换页只要调 playTrack 换一首。
 *
 * 淡出而不是直接停：直接停会在音乐正响着的时候咔一声。
 */
export function stopMusic(): void {
  if (current === null) return
  current.unsubscribe()
  current.playback.stop(CROSSFADE_MS)
  current = null
}

/** 现在放的是哪一首；没在放是 null。给界面判断和测试用。 */
export function currentTrack(): MusicTrack | null {
  return current?.track ?? null
}

/**
 * 订阅一首背景音乐从曲尾循环回曲首，返回退订函数。
 *
 * 首次开播不通知，只有真的绕回去才通知：首页那句问候在挂载时自己排一次，
 * 之后每绕一圈再排一次（见 sounds.ts 的 `HOME_INTRO_DELAY_MS`）。
 */
export function onTrackReplay(track: MusicTrack, listener: () => void): () => void {
  let listeners = replayListeners.get(track)
  if (listeners === undefined) {
    listeners = new Set()
    replayListeners.set(track, listeners)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && replayListeners.get(track) === listeners) {
      replayListeners.delete(track)
    }
  }
}

/** 只给测试用：把「现在放的是哪一首」清掉，让每个用例都从没放过音乐开始。 */
export function resetMusicForTest(): void {
  current?.unsubscribe()
  current = null
  replayListeners.clear()
}
