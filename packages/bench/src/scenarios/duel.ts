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

const play10: Scenario = {
  name: 'play10',
  description: '连续出牌十次，中间穿插 hover',
  async setup(ctx) {
    await ctx.act(() => ctx.scene.deal(12))
  },
  async run(ctx) {
    for (let i = 0; i < 10; i += 1) {
      // 出牌前先扫一眼手牌：真人就是这么点的，而 hover 会让扇形动一下，
      // 正好用来验证「没有补间、只是画面变了」时帧循环也会醒一帧再停。
      ctx.scene.hover(0)
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
