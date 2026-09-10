/**
 * 真浏览器里的交互回归（《正式版架构》6.6 第 2 条、迁移第 19 条）。
 *
 * 「合成指针事件模拟拖拽出牌、点选目标，断言场景发出的指令」这条要求拆成两半：
 * 纯逻辑那一半在 canvas 的 `test/duelInput.test.ts`（vitest，替身组件），
 * 这一半跑的是**真的**——真的 DOM 指针事件、真的 Pixi 命中测试、真的卡面几何。
 * 两边合起来才盖住整条路：那边保证「判定对」，这边保证「点得到」。
 *
 * 为什么放在 bench 而不是目录页：这里已经有一整套「把真场景在浏览器里跑起来」的骨架
 *（页面、图集、手动时钟、window.__bench），目录页那条是截图比对，加交互只会把两件事搅在一起。
 *
 * 它不产出任何指标，所以单独一个 project（playwright.config.ts 的 `interaction`）。
 * 几分钟就跑完，进 CI **快档**的 `scene` job（确定性指标那组太慢，在慢档）。
 * 跑法：`pnpm --filter @ai-duel/bench interaction`。
 */

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { DECK, SEED } from '../src/node/profiles'
import type { BenchInitOptions } from '../src/page/benchApi'
import { INTERACTION_DECK, INTERACTION_SKILL } from '../src/scene/duelScript'
import { dealHand, handCards, hitPoints, openBench, sceneCommands, settleScene } from './harness'

/**
 * 两档画布尺寸。
 *
 * 桌面档取 1280×800 而不是剧本那档 1920×1080：视口里放得下才点得到，而短边 800 仍在
 * 断点 768 以上，走的还是桌面档版式（见 canvas 的 layout/pickLayout.ts）。
 * 手机档就用真尺寸 390×844。
 */
const DESKTOP = { width: 1280, height: 800 }
const MOBILE = { width: 390, height: 844 }

/** 画布上方还有一行状态文字（见 index.html），所以视口要比画布高出一截。 */
const CHROME_HEIGHT = 80

function initOptionsFor(size: { width: number; height: number }): BenchInitOptions {
  return {
    profile: 'interaction',
    width: size.width,
    height: size.height,
    resolution: 1.5,
    tier: size.width >= 768 ? 'high' : 'low',
    seed: SEED,
    deck: [...DECK],
    // 手动时钟：帧由我们自己推。真指针事件是异步来的，中间要有确定的推帧时机。
    manualClock: true,
    scene: 'duel',
    // 换一副带技能牌的牌组，不然摸不到能选目标的牌（见 scene/duelScript.ts）。
    duelDeck: [...INTERACTION_DECK],
  }
}

/** 画布在视口里的位置。所有指针坐标都要过这一道。 */
async function canvasOrigin(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox()
  if (box === null) throw new Error('页面上没有画布')
  return { x: box.x, y: box.y }
}

/** 把场景摆到「开局发完牌、可以出牌」那一刻，并返回画布原点。 */
async function openDealt(
  page: Page,
  size: { width: number; height: number },
): Promise<{ x: number; y: number }> {
  await page.setViewportSize({ width: size.width + 40, height: size.height + CHROME_HEIGHT })
  await openBench(page)
  await page.evaluate(
    async (options) => window.__bench.init(options as BenchInitOptions),
    initOptionsFor(size),
  )
  await dealHand(page)
  return canvasOrigin(page)
}

/** 某张手牌现在按哪个视口坐标点得到。点不到（被别的牌压着）就直接失败。 */
async function pointOnCard(
  page: Page,
  origin: { x: number; y: number },
  instanceId: string,
): Promise<{ x: number; y: number }> {
  const points = await hitPoints(page, `card:${instanceId}`)
  const point = points[0]
  if (point === undefined) throw new Error(`手牌 ${instanceId} 现在点不到`)
  return { x: origin.x + point.x, y: origin.y + point.y }
}

/** 现在点得到的那些卡各是谁。选目标那一步要从里面挑一张真点得着的当目标。 */
async function hittableCards(page: Page): Promise<string[]> {
  const points = await hitPoints(page, 'card:')
  return points.map((one) => one.label.slice('card:'.length))
}

/**
 * 落区里的一点。
 *
 * 落区的几何归版式管，这里不重算，取一个「一定在里面」的点：战场中央。
 * 战场整块都在落区内（两者都是「顶栏之下、手牌之上」那一片，见 canvas 的 desktopLayout.ts），
 * 而战场空着的时候那儿没有任何东西挡着指针。
 */
function dropPoint(
  origin: { x: number; y: number },
  size: { width: number; height: number },
): { x: number; y: number } {
  return { x: origin.x + size.width / 2, y: origin.y + size.height * 0.4 }
}

/** 拖一张牌到落区松手（鼠标）。中间分几步走，起拖阈值才过得去。 */
async function dragWithMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
}

/** 同一件事的触屏版。Playwright 的 touchscreen 只有 tap，拖拽要自己发触摸事件。 */
async function dragWithTouch(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const client = await page.context().newCDPSession(page)
  const at = (x: number, y: number) => ({ x: Math.round(x), y: Math.round(y) })
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [at(from.x, from.y)],
  })
  for (let i = 1; i <= 8; i += 1) {
    const t = i / 8
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [at(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)],
    })
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await client.detach()
}

test.describe('鼠标', () => {
  test('把一张 AI 牌拖进落区松手，场景发出 PLAY_CARD', async ({ page }) => {
    const origin = await openDealt(page, DESKTOP)
    const hand = await handCards(page)
    const ai = hand.find((one) => one.cardId !== INTERACTION_SKILL)
    expect(ai, '开局手牌里应当有 AI 牌').toBeDefined()
    if (ai === undefined) return

    await dragWithMouse(
      page,
      await pointOnCard(page, origin, ai.instanceId),
      dropPoint(origin, DESKTOP),
    )
    expect(await sceneCommands(page)).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: ai.instanceId },
    ])
  })

  test('拖到落区外松手，一条指令都不发', async ({ page }) => {
    const origin = await openDealt(page, DESKTOP)
    const hand = await handCards(page)
    const ai = hand.find((one) => one.cardId !== INTERACTION_SKILL)
    if (ai === undefined) throw new Error('开局手牌里没有 AI 牌')

    // 顶栏那一条在落区上沿之外：拖上去松手等于「我不打了」。
    await dragWithMouse(page, await pointOnCard(page, origin, ai.instanceId), {
      x: origin.x + DESKTOP.width / 2,
      y: origin.y + 20,
    })
    expect(await sceneCommands(page)).toEqual([])
  })

  test('技能牌拖进落区先选目标，点中候选手牌才发出带目标的 PLAY_CARD', async ({ page }) => {
    const origin = await openDealt(page, DESKTOP)
    const hand = await handCards(page)
    const skill = hand.find((one) => one.cardId === INTERACTION_SKILL)
    if (skill === undefined) throw new Error('开局手牌里没有那张技能牌')

    await dragWithMouse(
      page,
      await pointOnCard(page, origin, skill.instanceId),
      dropPoint(origin, DESKTOP),
    )
    // 第一步只进选目标态，指令还没发。
    expect(await sceneCommands(page)).toEqual([])

    /*
     * 第二步：点一张候选手牌。
     *
     * 目标要**这时候**才挑，不能开局就定死：那张技能牌已经离开扇形、停在拖拽层上，
     * 而拖拽层压在手牌之上，它正好盖住旁边那张。挑一张此刻真点得到的，
     * 才是玩家在屏幕上做得出来的操作。
     */
    await settleScene(page)
    const candidate = (await hittableCards(page)).find((one) => one !== skill.instanceId)
    if (candidate === undefined) throw new Error('选目标态下一张候选手牌都点不到')

    const point = await pointOnCard(page, origin, candidate)
    await page.mouse.click(point.x, point.y)
    expect(await sceneCommands(page)).toEqual([
      {
        type: 'PLAY_CARD',
        player: 0,
        instanceId: skill.instanceId,
        targetInstanceId: candidate,
      },
    ])
  })

  /*
   * 「结束出牌」这颗按钮只有真浏览器这边测得到：指令是场景在装配按钮时接上的
   *（canvas 的 scenes/duel/DuelScene.ts 的 onEndPlay），不经过 input.ts，
   * 那边 vitest 的假上下文里按钮是个替身，只测得到灰不灰。
   */
  test('点「结束出牌」按钮，场景发出 END_PLAY', async ({ page }) => {
    const origin = await openDealt(page, DESKTOP)
    const button = (await hitPoints(page, 'button:end-play'))[0]
    if (button === undefined) throw new Error('「结束出牌」按钮现在点不到')

    await page.mouse.click(origin.x + button.x, origin.y + button.y)
    expect(await sceneCommands(page)).toEqual([{ type: 'END_PLAY', player: 0 }])
  })

  test('选目标时点空白处，取消掉，一条指令都不发', async ({ page }) => {
    const origin = await openDealt(page, DESKTOP)
    const hand = await handCards(page)
    const skill = hand.find((one) => one.cardId === INTERACTION_SKILL)
    if (skill === undefined) throw new Error('开局手牌里没有那张技能牌')

    await dragWithMouse(
      page,
      await pointOnCard(page, origin, skill.instanceId),
      dropPoint(origin, DESKTOP),
    )
    await settleScene(page)
    // 战场空着，那一片除了压暗层什么都没有——压暗层不吃事件，这一下落到舞台上就是取消。
    await page.mouse.click(origin.x + DESKTOP.width / 2, origin.y + 200)
    expect(await sceneCommands(page)).toEqual([])

    // 取消之后再点那张候选手牌就只是普通的一次点击，不该补发一条带目标的指令。
    const candidate = (await hittableCards(page)).find((one) => one !== skill.instanceId)
    if (candidate === undefined) throw new Error('取消之后一张手牌都点不到')
    const point = await pointOnCard(page, origin, candidate)
    await page.mouse.click(point.x, point.y)
    expect(await sceneCommands(page)).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: candidate },
    ])
  })
})

test.describe('触屏', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('手指拖进落区松手，同样发出 PLAY_CARD', async ({ page }) => {
    const origin = await openDealt(page, MOBILE)
    const hand = await handCards(page)
    const ai = hand.find((one) => one.cardId !== INTERACTION_SKILL)
    if (ai === undefined) throw new Error('开局手牌里没有 AI 牌')

    await dragWithTouch(
      page,
      await pointOnCard(page, origin, ai.instanceId),
      dropPoint(origin, MOBILE),
    )
    expect(await sceneCommands(page)).toEqual([
      { type: 'PLAY_CARD', player: 0, instanceId: ai.instanceId },
    ])
  })

  test('手指点一下只把牌抬起来，不出牌', async ({ page }) => {
    const origin = await openDealt(page, MOBILE)
    const hand = await handCards(page)
    const ai = hand.find((one) => one.cardId !== INTERACTION_SKILL)
    if (ai === undefined) throw new Error('开局手牌里没有 AI 牌')

    const point = await pointOnCard(page, origin, ai.instanceId)
    // 手指划过屏幕太容易蹭出一次点击，而出牌不可撤销——触屏的轻点只抬牌
    // （规则在 canvas 的 interaction/handPointer.ts 的 handleUp）。
    await page.touchscreen.tap(point.x, point.y)
    expect(await sceneCommands(page)).toEqual([])
  })
})
