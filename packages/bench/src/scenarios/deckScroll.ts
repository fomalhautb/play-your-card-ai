/**
 * 「牌组编辑滚动」剧本（《正式版架构》6.9 表里那一段）：**卡池翻三屏，再拖两张进牌组**。
 *
 * 「翻一屏」两档不是一回事：桌面档往下滚一整个窗口高，手机档翻一页
 *（见 canvas 的 scenes/deck/commands.ts 的 turnScreen）。量的是同一件事——
 * 卡池那一屏整批换掉时的开销：一屏卡的纹理绑定、合批、以及有没有在逐帧建对象。
 * 正式版简化第 4 步之四把桌面档换回滚动之后，这一段在那一档还顺带量到了遮罩和离屏剔除。
 *
 * 拖两张接在后面，是因为那是这一页唯一有逐帧跟随的动作（一张卡跟着指针跑），
 * 也是唯一会让牌组栏整排重排的动作。
 *
 * 和对局那几段一样先热身一遍：热身跑的是**一模一样**的脚本，只是步长放大十几倍、不进指标。
 * 这一遍是必需的——翻一屏时那几行会变的字、卡上的份数角标都要烤一次纹理，
 * 而 `textCreated` 那条上限（0）拦的是「稳态还在建新东西」，不是「第一次建出来」。
 */

import type { BenchDeckActions } from '../scene/contract'
import type { Scenario, ScenarioContext } from './types'

/** 翻几屏。剧本卡池 18 张，三屏足够从头走到尾并停在最后（两档都是）。 */
const PAGES = 3
/** 拖几张。 */
const DRAGS = 2

/** 取构筑页那两个动作。登记错场景时在这里当场抛，而不是静悄悄地什么都不做。 */
function deckOf(ctx: ScenarioContext): BenchDeckActions {
  const actions = ctx.scene.deck
  if (actions === undefined) throw new Error('这段剧本要构筑页场景（Scenario.scene 填 deck）')
  return actions
}

async function script(ctx: ScenarioContext): Promise<void> {
  await ctx.act(() => deckOf(ctx).turnPages(PAGES))
  await ctx.act(() => deckOf(ctx).dragCards(DRAGS))
}

export const deckScroll: Scenario = {
  name: 'deckScroll',
  scene: 'deck',
  description: '牌组编辑：卡池翻三屏，再从卡池拖两张进牌组',
  async setup(ctx) {
    ctx.scene.setWarmup(true)
    await script(ctx)
    // 热身完把这一页摆回起点：被测的是「从头翻三屏」，不是「从最后一屏接着翻」。
    await ctx.act(() => ctx.scene.restart())
    ctx.scene.setWarmup(false)
  },
  run: script,
}
