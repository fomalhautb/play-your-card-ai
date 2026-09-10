/**
 * 「一轮结算」那一段剧本（《正式版架构》6.9 剧本表的第四行）。
 *
 * 演的是：双方结束出牌 → 揭题 → 逐卡打字机作答 → 一行一行盖章 → 比分变化 → 双方确认退场。
 * 它和另外三段不一样的地方在于**全程压着一个全屏层**（结算层），所以这一段真正要拦的是
 * 纪律 3.1 的离屏渲染（必须是 0）和 3.2 的过度绘制（同屏半透明层不超过三层）：
 * 结算层底下还铺着战场和手牌，再叠一层遮罩就顶穿了。
 *
 * 打字机和盖章是逐行推进的，每一行都要新出一段字。热身那一遍（setup）因此格外重要：
 * 「动画期间文字对象重建」那条上限是 0，没热身过的第一遍必然全是新烤的文字。
 *
 * 这一段单开一个文件，和 duel.ts 那三段并列——`scenarios/index.ts` 的注册表把它们拼起来。
 */

import type { Scenario } from './types'

/**
 * 结算之前先在场上摆几个单位。
 *
 * 结算层是**逐个 AI 一行**演的，场上一个都没有的话这一段几乎什么都不演；
 * 两张（我方一张、对方一张）就够把「对」「错」两种判定和上下两侧的队伍都摆出来。
 *
 * 不摆更多是因为这一段本来就是四段里最长的：每张卡都要逐字打完回答和推理再盖章
 *（见 director/timings.ts 的 SETTLE_* 那一批），而一条用例要把整段跑三遍
 *（逐帧记录一遍、堆采样一遍、再重跑一遍验两遍一致）。
 * 四张时这一条在 M2 上就要十几分钟，CI 那台两核跑机装不下。
 */
const SETUP_PLAYS = 2

export const settle: Scenario = {
  name: 'settle',
  description: '一轮结算：揭题、逐卡作答、盖章、比分、双方确认退场',
  async setup(ctx) {
    ctx.scene.setWarmup(true)
    await ctx.act(() => ctx.scene.restart())
    await ctx.act(() => ctx.scene.playCards(SETUP_PLAYS))
    // 热身要把结算层自己那一整套字（题面、每行的回答、判定章、比分）也烤过一遍，
    // 所以这一遍连结算一起跑完，再重开一局摆回被测动作的起点。
    await ctx.act(() => ctx.scene.settleRound())
    await ctx.act(() => ctx.scene.restart())
    await ctx.act(() => ctx.scene.playCards(SETUP_PLAYS))
    ctx.scene.setWarmup(false)
  },
  async run(ctx) {
    await ctx.act(() => ctx.scene.settleRound())
  },
}
