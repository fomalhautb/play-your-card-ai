/**
 * 七段音效：首页问候、按钮点击、技能选目标，以及四句「催一催」人声。
 *
 * 加载和播放全走 `platform.audio`，这里只留「有哪几段、多响、走哪个声道」这张表。
 * 地址是 `pnpm assets:build` 分发到壳 public 下的产物路径（源在 assets/source/music/，
 * 见 assets/README.md）。
 */

import type { UrgeId } from '@ai-duel/content'
import type { Platform, Playback, SoundSpec } from '@ai-duel/platform'
import { volumeOf } from './loudness'

export type SoundId =
  | 'homeIntro'
  | 'buttonClick'
  | 'skillTargeting'
  | 'urgeCanYouDoIt'
  | 'urgeHurryUp'
  | 'urgeComeOn'
  | 'urgeQuestionAi'

/**
 * 每段音效的地址和音量。倍数照抄旧版，换算见 loudness.ts。
 *
 * `homeIntro` 和 `urgeQuestionAi` 是同一个文件：首页那句问候就是「这题你 AI 会吗」，
 * 它在两个地方以两种身份出现（问候语、一句喊话），所以列两条。
 * platform 按地址缓存，同一个文件只会下载和解码一次。
 */
export const SOUNDS: Record<SoundId, SoundSpec> = {
  homeIntro: { src: '/audio/music/question-ai.m4a', volume: volumeOf(2) },
  buttonClick: { src: '/audio/music/mouse-click-sound.m4a', volume: volumeOf(2) },
  skillTargeting: { src: '/audio/music/skill-jiejie.m4a', volume: volumeOf(1) },
  urgeCanYouDoIt: { src: '/audio/music/urge-can-you-do-it.m4a', volume: volumeOf(3) },
  urgeHurryUp: { src: '/audio/music/urge-hurry-up.m4a', volume: volumeOf(3) },
  urgeComeOn: { src: '/audio/music/urge-come-on.m4a', volume: volumeOf(3) },
  urgeQuestionAi: { src: '/audio/music/question-ai.m4a', volume: volumeOf(3) },
}

/**
 * 人声声道。
 *
 * 同一个声道上同时只响一段（platform 的 `PlayOptions.channel`）：连点「催一催」时
 * 新的一句把没播完的上一句掐掉，否则几段人声会叠着响，一句都听不清。
 * 首页问候也走这个声道，理由一样——它本身就是四句人声里的一句。
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

/** 哪句喊话放哪一段录音。写成 Record 而不是查表函数：漏了一句 TypeScript 当场报错。 */
const URGE_SOUND: Record<UrgeId, SoundId> = {
  canYouDoIt: 'urgeCanYouDoIt',
  hurryUp: 'urgeHurryUp',
  comeOn: 'urgeComeOn',
  questionAi: 'urgeQuestionAi',
}

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

/** 首页那句问候。和喊话共用人声声道，正在放的喊话会被它掐掉，反之亦然。 */
export function playHomeIntro(platform: Platform): Playback {
  return platform.audio.play(SOUNDS.homeIntro, { channel: VOICE_CHANNEL })
}

/**
 * 放一句「催一催」。
 *
 * 抽哪一句由调用方决定（content 的 `pickUrgeId`）——这一句要同步给对面，
 * 随机数只能摇一次，不能两端各摇各的。
 */
export function playUrge(platform: Platform, id: UrgeId): Playback {
  return platform.audio.play(SOUNDS[URGE_SOUND[id]], { channel: VOICE_CHANNEL })
}
