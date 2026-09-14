/**
 * 三段音效：首页问候、按钮点击、技能选目标。
 *
 * 加载和播放全走 `platform.audio`，这里只留「有哪几段、多响、走哪个声道」这张表。
 * 地址是 `pnpm assets:build` 分发到壳 public 下的产物路径（源在 assets/source/music/，
 * 见 assets/README.md）。
 */

import type { Platform, Playback, SoundSpec } from '@ai-duel/platform'
import { volumeOf } from './loudness'

export type SoundId = 'homeIntro' | 'buttonClick' | 'skillTargeting'

/** 每段音效的地址和音量。倍数照抄旧版，换算见 loudness.ts。 */
export const SOUNDS: Record<SoundId, SoundSpec> = {
  homeIntro: { src: '/audio/music/question-ai.m4a', volume: volumeOf(2) },
  buttonClick: { src: '/audio/music/mouse-click-sound.m4a', volume: volumeOf(2) },
  skillTargeting: { src: '/audio/music/skill-jiejie.m4a', volume: volumeOf(1) },
}

/**
 * 人声声道。
 *
 * 同一个声道上同时只响一段（platform 的 `PlayOptions.channel`）。
 * 现在走这个声道的只有首页那句问候：它是一段人声，而背景音乐循环回开头时会再响一次，
 * 上一遍还没播完就该被掐掉，不能两句叠着响。
 */
const VOICE_CHANNEL = 'voice'

/** 技能音走自己的声道：它和人声可以同时响，但自己连点时该只留最新那一下。 */
const SKILL_CHANNEL = 'skill'

/**
 * 首页问候在背景音乐开播多久之后响。
 *
 * 3620 ms 是对着 beginning.m4a 的前奏数出来的：这一句要落在第一段旋律的空档上。
 * 每次背景音乐循环回开头都要重新数一遍（见 music.ts 的 `onTrackReplay`）。
 */
export const HOME_INTRO_DELAY_MS = 3620

/**
 * 预取全部音效，第一次点击不必再等网络。
 *
 * 永不抛错（platform 保证）：音效是反馈层，加载失败不能挡住按钮自己的操作。
 */
export function preloadSounds(platform: Platform): Promise<void> {
  return platform.audio.preload(Object.values(SOUNDS))
}

/** 全站按钮的那一颗点击声。不占声道：连点时几下叠着响是对的，那就是「点了好几下」。 */
export function playButtonClick(platform: Platform): Playback {
  return platform.audio.play(SOUNDS.buttonClick)
}

/** 玩家点出一张必须指定对方 AI 的技能牌、进入选目标态时播放。 */
export function playSkillTargeting(platform: Platform): Playback {
  return platform.audio.play(SOUNDS.skillTargeting, { channel: SKILL_CHANNEL })
}

/** 首页那句问候。走人声声道，上一遍还没播完就会被这一遍掐掉。 */
export function playHomeIntro(platform: Platform): Playback {
  return platform.audio.play(SOUNDS.homeIntro, { channel: VOICE_CHANNEL })
}
