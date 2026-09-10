/**
 * 对局的三段剧本：开局发牌、连续出牌十次、放大查看。
 *
 * 「一轮结算」在旁边的 settle.ts；6.9 还列了牌组编辑滚动和开包，那两段要等对应场景写出来，
 * 到时候同样各加一个文件、在 scenarios/index.ts 的表上登记一行。
 *
 * ## 每段都先热身一遍
 *
 * `setup` 里跑的是和被测那遍**一模一样**的脚本，只是步长放大十几倍、而且不进指标。
 * 这一遍是必需的，不是优化：纪律 3.5 说的是「文字只创建一次并缓存」，
 * 而一局对局里横幅、比分、Token 读数这些字第一次出现时总要烤一次纹理。
 * 热身之后再测，`textCreated` 和 `textureUploads` 量到的才是**稳态**——
 * 也就是那两条上限（都是 0）真正要拦的东西：运行期还在不停地建新东西。
 *
 * 热身完再 `restart()` 一次，把局面重新摆到被测动作的起点；`deal` 那段的被测动作
 * 本身就是开局，所以它的 `run` 就是那一次 `restart`。
 */

import type { Scenario, ScenarioContext } from './types'

/** `play10` 打几张。五张我方、五张对方，第一轮双方各 5 点 Token 正好够。 */
const PLAY_COUNT = 10

/** `flip` 之前先摆几个单位在场上，好有东西可点。 */
const INSPECT_SETUP_PLAYS = 3

const deal: Scenario = {
  name: 'deal',
  description: '开局：抛硬币过场收尾，双方各五张手牌飞进扇形',
  async setup(ctx) {
    ctx.scene.setWarmup(true)
    await ctx.act(() => ctx.scene.restart())
    ctx.scene.setWarmup(false)
  },
  async run(ctx) {
    await ctx.act(() => ctx.scene.restart())
  },
}

const play10: Scenario = {
  name: 'play10',
  description: '连续出牌十次：我方五张飞向战场，对方五张走强制展示',
  async setup(ctx) {
    ctx.scene.setWarmup(true)
    await ctx.act(() => ctx.scene.restart())
    await ctx.act(() => ctx.scene.playCards(PLAY_COUNT))
    // 热身完把局面摆回起点：被测的是出牌，开局那一段不该混进去。
    await ctx.act(() => ctx.scene.restart())
    ctx.scene.setWarmup(false)
  },
  async run(ctx) {
    await ctx.act(() => ctx.scene.playCards(PLAY_COUNT))
  },
}

/** 依次放大查看三个单位，每个看完关回去。展示层同一时刻只归一条链路用，所以不能同时开三个。 */
async function inspectThree(ctx: ScenarioContext): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await ctx.act(() => ctx.scene.inspect(index))
  }
}

const flip: Scenario = {
  name: 'flip',
  description: '放大查看三张：卡飞到屏幕中央翻正，看完各自飞回原格',
  async setup(ctx) {
    ctx.scene.setWarmup(true)
    await ctx.act(() => ctx.scene.restart())
    await ctx.act(() => ctx.scene.playCards(INSPECT_SETUP_PLAYS))
    await inspectThree(ctx)
    await ctx.act(() => ctx.scene.restart())
    await ctx.act(() => ctx.scene.playCards(INSPECT_SETUP_PLAYS))
    ctx.scene.setWarmup(false)
  },
  async run(ctx) {
    await inspectThree(ctx)
  },
}

export const DUEL_SCENARIOS: Readonly<Record<string, Scenario>> = { deal, play10, flip }
