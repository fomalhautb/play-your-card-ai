/**
 * 音效、背景音乐和静音开关的行为。
 *
 * 声音是最难自动验的一类效果，所以断言的是「该响的时候调了没有、参数对不对」：
 * 假平台的 audio 把每一次调用按顺序记在 `calls` 上（见 platform 的 fake/audio.ts）。
 */

import type { FakePlatform } from '@ai-duel/platform'
import { createFakePlatform } from '@ai-duel/platform'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  currentTrack,
  MUSIC_TRACKS,
  onTrackReplay,
  playTrack,
  resetMusicForTest,
  stopMusic,
} from '../src/audio/music'
import { restoreMuted, setMuted, toggleMuted } from '../src/audio/mute'
import { playButtonClick, playSkillTargeting, preloadSounds, SOUNDS } from '../src/audio/sounds'

const MUTED_KEY = 'ai-duel-muted.v1'

let platform: FakePlatform

/** 只挑 `play` 那几条，别的调用（preload、stop）不参与顺序断言。 */
function plays(): { src: string; channel: string | null; volume: number }[] {
  return platform.audio.calls.flatMap((call) =>
    call.kind === 'play' ? [{ src: call.src, channel: call.channel, volume: call.volume }] : [],
  )
}

beforeEach(() => {
  platform = createFakePlatform()
})

afterEach(() => {
  // 「现在放的是哪一首」是模块级状态，跨用例活着，不清的话下一个用例的第一次切歌会被当成重复。
  resetMusicForTest()
})

describe('音效', () => {
  it('预取一次把三段全带上', async () => {
    await preloadSounds(platform)
    expect(platform.audio.calls[0]).toEqual({
      kind: 'preload',
      sources: Object.values(SOUNDS).map((spec) => spec.src),
    })
  })

  it('按钮点击不占声道（连点就是要叠着响），技能音占自己的声道', () => {
    playButtonClick(platform)
    playButtonClick(platform)
    playSkillTargeting(platform)
    playSkillTargeting(platform)
    const calls = plays()
    expect(calls.slice(0, 2).every((call) => call.channel === null)).toBe(true)
    expect(calls.slice(2).every((call) => call.channel === 'skill')).toBe(true)
    // 两下点击都还在响，技能音只剩最新那一下。
    expect(platform.audio.playing()).toHaveLength(3)
  })

  it('音量都落在 0~1 内，相对关系照旧版：问候 = 点击 > 技能', () => {
    // platform 的 SoundSpec 上限就是 1，旧版那种倍数增益整套缩下来（见 audio/loudness.ts）。
    for (const spec of Object.values(SOUNDS)) {
      expect(spec.volume).toBeGreaterThan(0)
      expect(spec.volume).toBeLessThanOrEqual(1)
    }
    expect(SOUNDS.homeIntro.volume).toBe(SOUNDS.buttonClick.volume)
    expect(SOUNDS.buttonClick.volume).toBeGreaterThan(SOUNDS.skillTargeting.volume ?? 0)
  })
})

describe('背景音乐', () => {
  it('第一次切歌开播，同一首再调一次不重开', () => {
    playTrack(platform, 'beginning')
    playTrack(platform, 'beginning')
    // 路由每重挂一次组件就重开一次的话，玩家来回切页面会听到音乐反复从头开始。
    expect(plays()).toEqual([
      { src: MUSIC_TRACKS.beginning, channel: 'music', volume: expect.any(Number) },
    ])
    expect(currentTrack()).toBe('beginning')
  })

  it('换一首会掐掉上一首，同一时刻只响一首', () => {
    playTrack(platform, 'beginning')
    playTrack(platform, 'match')
    expect(platform.audio.playing()).toEqual([MUSIC_TRACKS.match])
    expect(currentTrack()).toBe('match')
  })

  it('stopMusic 之后什么都不放，再切同一首会重新开播', () => {
    playTrack(platform, 'room')
    stopMusic()
    expect(currentTrack()).toBeNull()
    playTrack(platform, 'room')
    expect(plays()).toHaveLength(2)
  })

  // 首页那句问候就接在这上面：不是只在第一次播放时响，而是每绕回开头再响一次。
  it('循环回绕会通知订阅者，只通知那一首的订阅者', () => {
    const beginning: string[] = []
    const match: string[] = []
    onTrackReplay('beginning', () => beginning.push('绕了一圈'))
    onTrackReplay('match', () => match.push('绕了一圈'))

    playTrack(platform, 'beginning')
    platform.audio.finish(MUSIC_TRACKS.beginning)
    expect(beginning).toHaveLength(1)
    expect(match).toEqual([])
  })

  it('退订之后不再收到通知；切歌也不会让上一首的通知落到新曲子头上', () => {
    const heard: string[] = []
    const off = onTrackReplay('beginning', () => heard.push('绕了一圈'))
    playTrack(platform, 'beginning')
    off()
    platform.audio.finish(MUSIC_TRACKS.beginning)
    expect(heard).toEqual([])

    const onMatch: string[] = []
    onTrackReplay('match', () => onMatch.push('绕了一圈'))
    playTrack(platform, 'match')
    // 上一首已经被掐掉了，它的 finish 不该再惊动谁。
    platform.audio.finish(MUSIC_TRACKS.beginning)
    expect(onMatch).toEqual([])
  })
})

describe('静音开关', () => {
  it('没存过时默认有声', () => {
    restoreMuted(platform)
    expect(platform.audio.isMuted()).toBe(false)
  })

  // 玩家关掉声音多半是「这台机器上一直别响」的意思，只存在内存里的话刷新一次就白关了。
  it('关掉之后存下来，下次启动装回去', () => {
    setMuted(platform, true)
    expect(platform.storage.entries.get(MUTED_KEY)).toBe('true')

    const next = createFakePlatform()
    next.storage.setRaw(MUTED_KEY, 'true')
    restoreMuted(next)
    expect(next.audio.isMuted()).toBe(true)
  })

  it('toggleMuted 来回拨，每一下都记下来', () => {
    toggleMuted(platform)
    expect(platform.audio.isMuted()).toBe(true)
    toggleMuted(platform)
    expect(platform.audio.isMuted()).toBe(false)
    expect(platform.storage.entries.get(MUTED_KEY)).toBe('false')
  })

  it('存档里是坏数据时当没存过', () => {
    platform.storage.setRaw(MUTED_KEY, '"是"')
    restoreMuted(platform)
    expect(platform.audio.isMuted()).toBe(false)
  })

  it('存储整个不可用时照样能静音，只是记不下来', () => {
    platform.storage.setBroken(true)
    expect(() => setMuted(platform, true)).not.toThrow()
    expect(platform.audio.isMuted()).toBe(true)
  })
})
