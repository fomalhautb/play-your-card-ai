/**
 * 端到端：从首页进新手教程，按提示走完三段（组牌 → 选英雄 → 教学对战）到完成页。
 * 对应《正式版架构》迁移第 32 条的验收那一条。
 *
 * 它守的是**接线**：步骤表、教程控制器、三路信号（引擎事件 / 舞台 cue / 玩家点击）、
 * 三个场景的语义锚点、引导层——任何一处接错，这条用例都会停在某一步不动，
 * 而那些接缝正是单元测试各自测不到的地方。
 *
 * 点的全是真指针，落点从 `window.__aiDuel.tutorial` 读（教程引导层此刻圈着的就是那几块，
 * 见 e2e/tutorialPage.ts）。唯一走调试口子发指令的是每轮结算那下「确认」——
 * 它不是教程的一步，而真按钮那条路已经由单机那条用例守着了。
 */

import { cellCenter, pickDeckLayout } from '@ai-duel/canvas'
import { expect, type Page, test } from '@playwright/test'
import { VIEWPORT } from './players'
import {
  clickAnchor,
  clickFirstTarget,
  enterTutorial,
  tutorialState,
  untilStep,
} from './tutorialPage'

/**
 * 对战那一段每一步该做什么。没列的那几步是过渡态（等对手出牌、等演出），什么都不用做。
 * 步骤 id 就是 `src/tutorial/steps.ts` 里那张表。
 */
const DUEL_ACTIONS: Record<string, 'tap' | 'play' | 'skill' | 'end-play'> = {
  TUTORIAL_INITIAL_DRAW: 'tap',
  TUTORIAL_R1_KEYWORD: 'tap',
  TUTORIAL_R1_PLAY_AI: 'play',
  TUTORIAL_R1_STAY: 'tap',
  TUTORIAL_R1_END_PLAY: 'end-play',
  TUTORIAL_R1_REVEAL: 'tap',
  TUTORIAL_R1_FOE_DONE: 'tap',
  TUTORIAL_R1_SCORE: 'tap',
  TUTORIAL_R2_REFRESH: 'tap',
  TUTORIAL_R2_TOKEN: 'tap',
  TUTORIAL_R2_DRAW: 'tap',
  TUTORIAL_R2_SKILL: 'skill',
  TUTORIAL_R2_SKILL_HIT: 'tap',
  TUTORIAL_R2_PLAY: 'end-play',
  TUTORIAL_R2_SCORE: 'tap',
  TUTORIAL_R2_TOKEN_RULE: 'tap',
  TUTORIAL_R3_FREE_PLAY: 'end-play',
}

/**
 * 把一张卡池卡拖进牌组栏。
 *
 * **点一下不算加牌**：那一下是放大查看（见 canvas 的 scenes/deck/input.ts），
 * 加牌要么拖进牌组栏、要么点卡角那颗「＋」。这里走拖拽——那是这一页的主操作。
 * 落点按 canvas 导出的版式函数算（同房间页那三颗钮的办法，见 e2e/roomPage.ts）。
 */
async function dragIntoDeck(page: Page, from: { x: number; y: number }): Promise<void> {
  const layout = pickDeckLayout(VIEWPORT.width, VIEWPORT.height, false)
  // 牌组栏正中那一格：落在网格里就算加牌，具体落第几格不影响教学的计数。
  const to = cellCenter(layout.slots, Math.floor(layout.slots.columns * layout.slots.rows) / 2)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // 中间多走几步：拖拽有 4 像素的阈值，一步到位会被当成点击。
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 6,
      from.y + ((to.y - from.y) * step) / 6,
    )
  }
  await page.mouse.up()
}

/** 这一步圈着的第一块的正中。组牌那一段要拿它当拖拽起点。 */
async function firstTargetSpot(page: Page): Promise<{ x: number; y: number }> {
  const rects = await page.evaluate(() => window.__aiDuel?.tutorial?.targets() ?? [])
  const rect = rects[0]
  if (rect === undefined) throw new Error('这一步一块都没圈到')
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
}

/**
 * 结算层那颗「确认」的中心（视口坐标）。
 *
 * 公式抄自 canvas 的 components/SettleLayer.ts：那一层按 **1672×941 的设计尺寸**排好，
 * 再整块等比缩放并在视口里居中（`resize`）；按钮横向居中、竖向压在底栏（高 96）的正中，
 * 也就是设计坐标的 `(836, 941 − 48)`。
 * 和房间页那三颗钮一样，这是画布界面做端到端绕不开的代价（见 e2e/roomPage.ts）。
 */
const SETTLE_CONFIRM = (() => {
  const design = { width: 1672, height: 941 }
  const scale = Math.min(VIEWPORT.width / design.width, VIEWPORT.height / design.height)
  const left = (VIEWPORT.width - design.width * scale) / 2
  const top = (VIEWPORT.height - design.height * scale) / 2
  return {
    x: left + (design.width / 2) * scale,
    y: top + (design.height - 96 / 2) * scale,
  }
})()

/**
 * 局面停在结算阶段、而玩家还没确认的话，点一下那颗「确认」。
 *
 * **必须点真按钮，不能直接发指令**：直接发的话引擎当场翻篇，而编排层看到阶段离开 settle
 * 就把整条结算演出掐掉（见 canvas 的 director/settleTimeline.ts 的 exitSettle），
 * 于是 `quiz-rows-done` / `quiz-score-shown` 这几条教程等着的信号一条都不会发出来——
 * 教程会卡在「等揭晓演完」那一步上，而画面看着一切正常。
 *
 * 按钮要等演出走到「⑥按钮淡入」才可点，在那之前点下去是空的（钮是灰的），下一轮再点就是。
 */
async function confirmIfSettling(page: Page): Promise<void> {
  const settling = await page.evaluate(() => {
    const view = window.__aiDuel?.match?.view().view
    return view?.phase === 'settle' && !view.settleConfirmed[0]
  })
  if (settling) await page.mouse.click(SETTLE_CONFIRM.x, SETTLE_CONFIRM.y)
}

/** 引擎那边此刻走到哪儿了。只进日志，用例不拿它做判断。 */
async function engineOf(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const view = window.__aiDuel?.match?.view().view
    if (view === null || view === undefined) return '还没开局'
    return `${view.phase}/第 ${view.round} 轮/确认 ${JSON.stringify(view.settleConfirmed)}`
  })
}

/** 等步骤真的换掉。没换（点空了、当时锁着）就返回 false，由调用方再点一次。 */
async function stepChanged(page: Page, from: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // 读不到就是整段已经走完、换到完成页了，那当然算「换掉了」。
    const state = await tutorialState(page)
    if (state === null || state.step !== from) return true
    await page.waitForTimeout(300)
  }
  return false
}

/**
 * 这一步现在做得了吗。
 *
 * 只有等点击那一档要问：提示已经就绪、却正被一层全屏过场盖着时，引导层整层不画
 *（见 canvas 的 `DirectorLocks.cutscene`），那颗「下一步」根本不在 DOM 里。
 * 那时候该做的不是干等，而是先去把结算层那颗「确认」点掉。
 */
async function canAct(page: Page, action: string): Promise<boolean> {
  if (action !== 'tap') return true
  return (await page.getByRole('button', { name: /下一步/ }).count()) > 0
}

/** 做一次这一步要求的动作。 */
async function runAction(page: Page, action: string): Promise<void> {
  if (action === 'tap') {
    // 引导层是 React 的，「下一步」是一颗真按钮。
    await page.getByRole('button', { name: /下一步/ }).click()
    return
  }
  if (action === 'end-play') {
    await clickAnchor(page, 'endTurnButton')
    return
  }
  // 出牌：鼠标点一下手牌就是打出（见 canvas 的 interaction/handPointer.ts）。
  await clickFirstTarget(page)
  if (action !== 'skill') return
  /*
   * 技能牌要选目标：打出那一下只会立起选目标层，还得点一下对手战场上那张 AI。
   * 这一轮对手场上只有一个单位（教学脚本保证），所以点那半块战场的正中就命中它。
   */
  await page.waitForTimeout(500)
  await clickAnchor(page, 'battlefieldFoe')
}

test('从首页进教程，按提示走完组牌、选英雄和教学对战', async ({ page }) => {
  /*
   * 页面里抛的错原样打出来。这条用例的每一步都是「点一下、等状态变」，
   * 界面真崩了的话表现只是「等不到下一步」，光看超时信息一个字都看不出是哪儿炸的。
   */
  page.on('pageerror', (error) => console.log(`[页面抛错] ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[console.error] ${message.text()}`)
  })

  await enterTutorial(page)

  // ---------- 第一段：组牌 ----------
  // 开场那句停 3.2 秒自己往下走，之后三步各加一张牌。
  await untilStep(page, 'DECK_AI_1')
  for (const next of ['DECK_AI_2', 'DECK_SKILL', 'DECK_READY']) {
    await dragIntoDeck(page, await firstTargetSpot(page))
    await untilStep(page, next)
  }
  // 最后一步圈的是「确认牌组」，点它进下一段。
  await clickFirstTarget(page)

  // ---------- 第二段：选英雄 ----------
  await untilStep(page, 'HERO_PICK')
  // 点霍珀那张卡打开技能详情，详情里那颗「确认英雄」就是下一步圈的地方。
  await clickFirstTarget(page)
  await untilStep(page, 'HERO_CONFIRM')
  await clickFirstTarget(page)

  // ---------- 第三段：教学对战 ----------
  await untilStep(page, 'TUTORIAL_INITIAL_DRAW', 120_000)

  /*
   * 一步步走完二十来步。每一步照 DUEL_ACTIONS 做一次动作，然后等它真的换步；
   * 没换就再来一次——点的那一刻可能正锁着（一段演出还没演完），那一下就落空了。
   *
   * **按时间预算而不是按次数**：跑机上是 SwiftShader 软件渲染，编排层按真实帧间隔推进
   *（每帧最多推 100 毫秒，见 DuelStage 的 MAX_FRAME_MS），帧率掉到几帧时同一段演出能拖长好几倍。
   * 数次数的话「几次才够」就成了一个跟着跑机快慢漂的数字。
   * 七分钟是本机实测的好几倍余量，仍然留在这条用例十分钟的上限之内。
   */
  const deadline = Date.now() + 7 * 60_000
  let last = ''
  let idle = 0
  while (Date.now() < deadline) {
    const state = await tutorialState(page)
    // 读不到那一格 = 教学对战演完、已经换到完成页了（那一屏没有这个口子）。
    if (state === null || state.step === 'TUTORIAL_VICTORY') break
    // 每换一步打一行：这条用例失败时最有用的线索就是「停在哪一步」。
    if (state.step !== last) {
      last = state.step
      console.log(`[教程] ${state.step} ready=${state.ready} · ${await engineOf(page)}`)
    }
    const action = DUEL_ACTIONS[state.step]
    // 过渡态（等对手出牌、等演出）、提示还没出场、提示被过场盖着，这三档都先什么都不做。
    if (action === undefined || !state.ready || !(await canAct(page, action))) {
      /*
       * 结算那颗「确认」只在这一档点。
       *
       * 等提示出场的那几步（`*_SCORE`）正是在等这一下：它们的 readyOn 里有下一轮的
       * `round-banner-done`，而那条要等结算层退场才发得出来。反过来，提示已经出场、
       * 又在等玩家点一下的那几步，屏幕上铺着引导层的点击捕获层——那时候点画布
       * 会被它接走，点不到结算层上。
       */
      await confirmIfSettling(page)
      // 干等着的时候每隔十来秒报一次，顺带把引擎那边的局面也带上：
      // 卡住时最要紧的两条线索就是「教程停在哪一步」和「这一局走到哪儿了」。
      idle += 1
      if (idle % 25 === 0) console.log(`[教程] 等着 ${state.step} · ${await engineOf(page)}`)
      await page.waitForTimeout(400)
      continue
    }
    idle = 0
    await runAction(page, action)
    if (!(await stepChanged(page, state.step, 30_000))) {
      // 没走动就再试一次（下一轮循环）。真的卡死的话下面那条断言会报出停在哪一步。
      await page.waitForTimeout(500)
    }
  }

  // ---------- 完成页 ----------
  // 先确认真的走到终点了：卡在中间的话下面那条断言只会报「找不到标题」，看不出卡在哪儿。
  // 走完的那一刻这一段就换到完成页了，那一屏没有这个口子，所以 null 也算数。
  const finished = await tutorialState(page)
  expect(finished?.step ?? 'TUTORIAL_VICTORY', '教学对战没走到终点').toBe('TUTORIAL_VICTORY')
  // 走完最后一步就自己切到完成页；那一屏是 DOM，比分是教学剧本写死的 3:0。
  await expect(page.getByRole('heading', { name: '教学完成' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('教学对战最终比分')).toBeVisible()
  await expect(page.locator('.tutorial-score__value')).toHaveText('3:0')
})
