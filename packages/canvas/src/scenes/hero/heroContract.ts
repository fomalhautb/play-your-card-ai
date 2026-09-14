/**
 * 选英雄页场景对外的契约：入参、要摆的那份状态、能发出的操作、句柄。
 *
 * 单独成文件的理由同 `duelContract.ts` / `roomContract.ts`：它是**跨包的约定**，
 * 装配层（`packages/client/src/screens/HeroScreen.tsx`）和组件目录页都按它写。
 *
 * ## 这一页是**受控**的
 *
 * 场景既不导航也不写存档，甚至不自己记「现在选中谁」——那一份状态由装配层持有，
 * 通过 `setView` 摆进来。旧版 `HeroScreen` 也是受控的（选完之后去哪、存不存全由调用方决定），
 * 因为同一份界面有两条入口：独立页、匹配房里的一步。
 * 场景自己记状态的话，这两条入口就得各自去猜它现在记着什么。
 *
 * 唯一由场景自己管的是**悬停**：那是纯粹的画面反馈，出了这一页没有任何意义。
 */

import type { Platform } from '@ai-duel/platform'
import type { Texture } from 'pixi.js'

/** 一位英雄。数据来自 `content` 的 HEROES，由装配层查好连原画一起传进来。 */
export interface HeroEntry {
  id: string
  name: string
  enName: string
  /** 人物简介。 */
  text: string
  skillName: string
  skillText: string
  /** 技能的使用定位。没有就不摆那一段。 */
  roleText?: string
  /**
   * 技能还没实装。这几位**照原位渲染**但置灰禁选：少渲染一张会让后面所有卡对错人，
   * 而且玩家会以为这个游戏只有四位英雄（旧版 HeroScreen 同一处的理由）。
   */
  comingSoon?: boolean
  /** 整张人物卡的原画（2:3）。名字和边框都画在图里，所以摆出来是一个普通精灵。 */
  art: Texture
}

export interface HeroView {
  /** 现在选中谁。详情里那颗「确认英雄」发的就是它。null 表示还没选过。 */
  selectedId: string | null
  /** 技能详情开在谁身上；null 是关着。 */
  detailId: string | null
  /**
   * 摆不摆「确认英雄」。
   *
   * 从匹配房的横幅点进来是**纯查看**，选谁都不会被记下，那时候摆一颗「确认」
   * 就是承诺一件做不到的事（旧版靠「传没传 onConfirm」区分同一件事）。
   */
  confirmable: boolean
}

/** 玩家在这一页上能做的事。装配层收到之后自己决定怎么办。 */
export type HeroAction =
  /** 点开某位的技能详情。 */
  | { kind: 'open'; hero: string }
  /** 关掉详情（点遮罩、点详情里的返回）。 */
  | { kind: 'close' }
  /** 在详情里按了「确认英雄」。存不存、存到哪由装配层决定。 */
  | { kind: 'confirm'; hero: string }
  /** 左上角那颗返回。 */
  | { kind: 'back' }

export interface HeroSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3）。 */
  resolution: number
  /** 七位英雄，顺序就是摆放顺序（`content` 的 HEROES 键序，那边有约定）。 */
  heroes: HeroEntry[]
  /** 整页的背景图。不给就只有一层底色。 */
  background?: Texture
  /** 触感和音效。不给就静音、不震动（目录页就是这么跑的）。 */
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /** true 时不注册任何真实时间源，只靠 step() 推进。 */
  manualClock?: boolean
  /** 指针是不是粗的。它和视口短边一起决定走哪一档版式（同对局场景）。 */
  coarsePointer?: boolean
}

export interface HeroScene {
  /** 摆一份状态。同一份摆两次不会重建。 */
  setView(view: HeroView): void
  /** 玩家按了某颗钮。全局只有一个回调，后设的顶掉前一个。 */
  onAction(callback: (action: HeroAction) => void): void
  /**
   * 把指针停在第 index 张卡上（null 是不停）。只给目录页用——那边没有真指针。
   */
  hoverCard(index: number | null): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /** 没有动画在跑；此时帧循环必须停（3.6）。 */
  isIdle(): boolean
  /** 视口变了，两档版式各按各的重排。 */
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的。 */
  destroy(): void
}
