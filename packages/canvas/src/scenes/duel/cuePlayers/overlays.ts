/**
 * 中央横幅和两层全屏过场（抛硬币、英雄技能抵消），外加对局中断时的一次性清场。
 *
 * 三样都是「一条 cue 对一段完整演出」，组件自己知道演多久，这里只把参数递过去。
 * 编排层已经保证它们不会同时立起来（banner.ts 那四道闸门），所以这边不做互斥判断——
 * 真撞上了说明排期错了，那时「后来的盖住先来的」比两层糊在一起好读。
 */

import { dropShowcase } from './showcase'
import type { CuePlayerGroup } from './types'

export const overlayPlayers: CuePlayerGroup<
  'banner' | 'coin-toss' | 'skill-cancel' | 'clear-overlays'
> = {
  banner(ctx, cue) {
    ctx.parts.banner.show(cue.text)
  },

  'coin-toss'(ctx, cue) {
    ctx.parts.coin.play(cue.mineFirst)
  },

  'skill-cancel'(ctx, cue) {
    ctx.parts.cancel.play(cue.title, cue.text)
  },

  /**
   * 对局中断（对手断线）：把所有还立着的层当场收掉。
   *
   * 三个全屏过场都是吃指针事件的层，不收掉玩家会被一层退不掉的遮罩挡死。
   * 展示位上那张临时卡也一起销毁——它是场景自己建的，没人再来接手了。
   */
  'clear-overlays'(ctx) {
    ctx.parts.coin.clear()
    ctx.parts.cancel.clear()
    ctx.parts.settle.clear()
    ctx.parts.banner.clear()
    ctx.parts.reveal.abort()
    ctx.parts.targeting.end()
    ctx.parts.board.clearTargets()
    dropShowcase(ctx)
    ctx.inspectingTile = null
  },
}
