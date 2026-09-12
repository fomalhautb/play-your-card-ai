/**
 * 展示位那张临时卡的共用收尾。
 *
 * 屏幕中央同一时刻只有一张展示卡（编排层保证：强制展示、我方技能亮相、放大查看三条链路
 * 严格互斥，见 director/reveal.ts）。它由某条 cue 建出来、由另一条 cue 收掉，
 * 两条之间隔着一段虚拟时间，所以「谁负责销毁」必须写在一处，否则不是漏销毁就是销毁两次。
 */

import type { DuelContext } from '../context'
import { killAndDestroy } from '../disposal'

/**
 * 把展示位上那张卡收掉。
 *
 * 组件那边（`RevealOverlay` 的 landTo / fade / abort）演完只把卡从层里摘出去、不销毁——
 * 它本来就不管卡从哪来（canvas 不管资源从哪来），所以销毁归这里。
 */
export function dropShowcase(ctx: DuelContext): void {
  const card = ctx.showcased
  if (card === null) return
  ctx.showcased = null
  killAndDestroy(ctx.deps.animator, card)
}
