/**
 * 联机端到端要用的对局页动作：读局面、替这一端走一步、等整局收场。
 *
 * 「走一步」的规矩只有三条，全部只看局面算得出来，不留任何随机：
 * 1. 轮到我出牌 → 手上有买得起的 AI 牌就打一张，没有就结束出牌；
 * 2. 结算阶段还没确认 → 确认本轮；
 * 3. 别的时候（对方在出牌、正在答题）什么都不做，等下一次轮询。
 *
 * 只打 AI 牌，不打技能牌：一部分技能牌要指定目标（`SkillCard.target`），
 * 而挑目标的规则有四档，抄进用例等于把引擎那段判断再写一遍。
 * 这条用例要守的是「两端的消息接得上」，不是「每张牌都打得对」。
 *
 * 能停下来是因为 Token 只减不增：买得起的牌越打越少，打光就结束出牌
 *（费用是卡面 `tokenCost` 减掉本方的核电站减免，见 core 的 effectivePlayCost）。
 */

import { expect, type Page } from '@playwright/test'
// 这一句同时把 src/dev/debugHook 里那份 `declare global`（window.__aiDuel）带进来。
import type { MatchDebug } from '../src/dev/debugHook'
import { hasDebug, readDebug } from './debugBridge'

/** 这一端此刻的局面。从调试口子的签名反推，那边改了这里跟着变。 */
type MatchSnapshot = ReturnType<MatchDebug['view']>

/** 这一端此刻的局面。 */
export async function matchView(page: Page): Promise<MatchSnapshot> {
  return await readDebug<MatchSnapshot>(page, 'match')
}

/** 走一步的结果，只用来看用例卡在哪一档，不参与判定。 */
type Step = 'play' | 'end' | 'confirm' | 'wait' | 'over'

/**
 * 替这一端走一步。整段在**浏览器里**跑：局面里带着一整份卡池（几十张牌的定义），
 * 每轮询一次就把它搬过 CDP 一趟太贵，而要判「这张牌买不买得起」又非要它不可。
 */
async function step(page: Page): Promise<Step> {
  // 口子不在就当这一步什么都没做：多半是页面刚重载，下一轮轮询它就回来了。
  if (!(await hasDebug(page, 'match'))) return 'wait'
  return await page.evaluate<Step>(() => {
    const match = window.__aiDuel?.match
    if (match === undefined) return 'wait'
    const snapshot = match.view()
    const view = snapshot.view
    const seat = snapshot.seat
    if (view === null || seat === null) return 'wait'
    if (view.phase === 'finished') return 'over'

    if (view.phase === 'settle') {
      if (view.settleConfirmed[seat]) return 'wait'
      match.send({ type: 'CONFIRM_ROUND', player: seat })
      return 'confirm'
    }

    if (view.phase !== 'play' || view.activePlayer !== seat) return 'wait'

    const affordable = view.self.hand.find((card) => {
      const definition = view.catalog.cards[card.cardId]
      if (definition === undefined || definition.kind !== 'ai') return false
      return Math.max(0, definition.tokenCost - view.self.costReduction) <= view.self.tokens
    })
    if (affordable === undefined) {
      match.send({ type: 'END_PLAY', player: seat })
      return 'end'
    }
    match.send({ type: 'PLAY_CARD', player: seat, instanceId: affordable.instanceId })
    return 'play'
  })
}

/**
 * 两端轮着走，直到两边都收场。
 *
 * 每轮之间等一拍：一条指令要走「本端 → 房间对象 → execute → 两端各一份事件」这一整圈，
 * 不等的话下一次轮询读到的还是旧局面，会把同一条指令再发一遍（服务端会拒，
 * 但那会在日志里堆出一大片看着像出了事的 `match:rejected`）。
 *
 * `budget` 是步数上限，纯粹用来在卡住时给一条能读的失败信息，而不是让用例静静地超时。
 * 八轮、两个人、每轮各出几张牌，几百步绰绰有余。
 */
export async function playToFinish(pages: Page[], budget = 400): Promise<void> {
  let lastRound = 0
  for (let taken = 0; taken < budget; taken += 1) {
    const steps = await Promise.all(pages.map((page) => step(page)))
    if (steps.every((one) => one === 'over')) return
    /*
     * 每进一轮打一行。这条用例一跑好几分钟，中间一声不吭的话，
     * 失败时只知道「超时了」，不知道是卡在第一轮还是第七轮——差别很大。
     */
    const round = (await matchView(pages[0] as Page)).view?.round ?? 0
    if (round !== lastRound) {
      lastRound = round
      console.log(`第 ${round} 轮，第 ${taken} 步：${steps.join(' / ')}`)
    }
    // 全在等（多半是答题阶段，服务端两秒半后自动交卷）就多歇一会儿，少刷几百次没用的轮询。
    await pages[0]?.waitForTimeout(steps.every((one) => one === 'wait') ? 800 : 400)
  }
  throw new Error(`走了 ${budget} 步还没收场，多半是有一端卡住了`)
}

/** 两端都到结算页，而且对胜负的说法一致（一个赢家、一个输家，或者两个平局）。 */
export async function expectSameOutcome(pages: Page[]): Promise<void> {
  for (const page of pages) {
    // 用 waitForSelector 而不是 toBeVisible，理由见 roomPage.ts 的 `waitForCanvas`。
    await page.waitForSelector('.match-result', { state: 'visible', timeout: 30_000 })
  }
  const outcomes = await Promise.all(
    pages.map((page) => page.locator('.match-result').getAttribute('data-outcome')),
  )
  const [mine, theirs] = outcomes
  if (mine === 'draw' || theirs === 'draw') {
    expect(outcomes, '一边平局另一边不平局').toEqual(['draw', 'draw'])
    return
  }
  expect([mine, theirs].sort(), '两端对谁赢了的说法对不上').toEqual(['defeat', 'victory'])
}
