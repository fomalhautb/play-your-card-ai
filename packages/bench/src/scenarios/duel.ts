/**
 * 对局的三段剧本：开局发牌、连续出牌十次、翻面。
 *
 * 6.9 列的剧本还有「一轮结算、牌组编辑滚动、开包」，那几段要等对应场景写出来才有得跑，
 * 到时候各加一个文件、在这里的表上登记一行。
 *
 * setup 里的动作不计入指标：它只是把场景摆到被测动作开始前的样子。
 * 比如 play10 要先有牌在手上，但发牌是 deal 那一段的事，不该混进出牌的数字里。
 */

import type { Scenario } from './types'

const deal: Scenario = {
  name: 'deal',
  description: '开局发 8 张',
  async run(ctx) {
    await ctx.act(() => ctx.scene.deal(8))
  },
}

/**
 * hover 时指针压在卡面上的哪儿（0~1，左上角是原点）。
 *
 * 取偏右上的一点而不是正中：倾斜的角度和高光的位置都是按「离卡心多远」算的，
 * 压在正中等于两样都是零，那一路和不给位置没有区别。偏出去七成足够让倾斜到接近满角、
 * 高光落在卡的左下（光心取的是指针的镜像点，见 canvas 的 fx/cardGlare.ts），
 * 又不至于压在边上被夹住。
 */
const HOVER_AT = { rx: 0.72, ry: 0.28 }

const play10: Scenario = {
  name: 'play10',
  description: '连续出牌十次，中间穿插带指针位置的 hover',
  async setup(ctx) {
    await ctx.act(() => ctx.scene.deal(12))
  },
  async run(ctx) {
    for (let i = 0; i < 10; i += 1) {
      /*
       * 出牌前先扫一眼手牌：真人就是这么点的，而 hover 会让扇形动一下，
       * 正好用来验证「没有补间、只是画面变了」时帧循环也会醒一帧再停。
       *
       * 带上指针位置，卡面倾斜和反光才会真的被点亮——不带的话这两条路一帧都跑不到，
       * 反光那次单独的绘制调用和它带来的合批打断就永远不在任何指标里。
       * 收敛不用在这儿数帧：倾斜和反光没收住的时候场景就不算空闲，settle() 会一直推到收住为止。
       */
      ctx.scene.hover(0, HOVER_AT)
      await ctx.settle()
      ctx.scene.hover(null)
      await ctx.settle()
      await ctx.act(() => ctx.scene.playCard(0))
    }
  },
}

const flip: Scenario = {
  name: 'flip',
  description: '翻面三张，其中一张翻回去',
  async setup(ctx) {
    await ctx.act(() => ctx.scene.deal(6))
  },
  async run(ctx) {
    for (const index of [0, 2, 4]) {
      await ctx.act(() => ctx.scene.flip(index))
    }
    // 再翻回去一次：换纹理这条路径两个方向都要走到，才能确认翻面不会重新上传纹理。
    await ctx.act(() => ctx.scene.flip(0))
  },
}

export const DUEL_SCENARIOS: Readonly<Record<string, Scenario>> = { deal, play10, flip }
