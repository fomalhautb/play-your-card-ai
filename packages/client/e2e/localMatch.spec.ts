/**
 * 单机端到端：从首页点进测试对局，拖一张牌出去，再用测试面板把整局走到结算页。
 * 对应《正式版架构》6.11 里「单机模式一条」那一条。
 *
 * 它守的是**接线**，不是演出：driver、演出编排层、画布场景、React 那几层之间任何一处
 * 接错了，这条用例都过不去——而那些接缝正是单元测试各自测不到的地方
 *（每一层自己都有测试，但「合起来能不能打完一局」只有真跑一遍才知道）。
 *
 * 拖牌走的是**合成指针**（真的 pointerdown / move / up），不是往场景里灌函数调用：
 * Pixi 的事件系统认的就是这几个 DOM 事件，绕过它等于把最容易坏的那一段跳过去。
 *
 * 答题不用管：进答题阶段 2.5 秒后自动交卷（见 src/match/quizAutopilot.ts）。
 */

import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { enterTestMatch, openHome } from './homePage'
import { centerOf, inertSpot, type Spot, stageBox, stageHits } from './stagePage'

/** 对局那块画布。所有落点都是相对它算的（见 stagePage.ts）。 */
const STAGE = '.duel-stage canvas'

/**
 * 落点一律**从 Pixi 场景树上反查**，不在这里抄版式公式，也不调版式函数现算。
 *
 * 这里从前写死过一组按 1280×900 推出来的坐标，版式一改就点空——正式版简化第 4 步之二
 * 把桌面档改回「1672×941 死版式 + 整块缩放」时就踩了这一下：扇形锚点、每张牌的间距全变了。
 * 之后改成调 canvas 的版式函数，还是得在这儿复刻一遍「扇形第 n 张的卡心在哪儿」那段几何
 *（卡以底边中点为原点也为旋转轴，外侧那几张是歪的），而那段几何只要组件一改就又对不上。
 * 现在问场景自己：按 label 找到对象，再用 Pixi 的命中测试验一遍那个坐标真的会命中它
 *（实现见 canvas 的 runtime/hitProbe.ts，bench 的交互用例读的是同一份）。
 */

/**
 * 此刻点得到的那些手牌，按屏幕上从左到右排。
 *
 * 限定在扇形（`hand-fan`）底下：战场上打出去的卡 label 是同一个前缀，
 * 不限定的话打出第一张之后「第 2 张手牌」就可能指到场上那张去。
 */
async function handSpots(page: Page): Promise<Spot[]> {
  return await stageHits(page, STAGE, 'card:', 'hand-fan')
}

/**
 * 松手的地方：**我方那一排格子**的中心。
 *
 * 不取整块战场的正中：那一点离出牌区下沿还有一大截，「下沿够不够低」这件事它量不到——
 * 而玩家真会把牌放下去的位置是自己那一排（贴着战场下沿）。2026-09-16 那次出牌区下沿
 * 收到战场外框上、鼠标拖拽却把整张牌画在指针上方，正是这条用例没抓住的那个洞。
 *
 * 怎么取：空着的战场上 `board-grid` 的包围盒只有中线那一条横杆（横贯整格、竖直居中，
 * 见 canvas 的 BoardGrid），所以它给的是战场的横向范围和**竖直中心**；
 * 我方那一排就夹在这条中线和手牌之间，取两者正中即可——设计尺寸下算出来离那一排
 * 真正的中心只差两个像素，照样稳稳落在格子带上。
 */
async function dropSpot(page: Page): Promise<Spot> {
  const midline = await stageBox(page, STAGE, 'board-grid')
  const fan = await stageBox(page, STAGE, 'hand-fan')
  return { x: centerOf(midline).x, y: (centerOf(midline).y + fan.y) / 2 }
}

/** 拖最右边那张手牌（也就是刚用测试面板加进来的那张）到出牌区。 */
async function dragCard(page: Page): Promise<void> {
  const from = (await handSpots(page)).at(-1)
  if (from === undefined) throw new Error('一张手牌都点不到')
  const drop = await dropSpot(page)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // 中间多走几步是因为拖拽有 4 像素的阈值，一步到位反而可能被当成点击。
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(
      from.x + ((drop.x - from.x) * step) / 5,
      from.y + ((drop.y - from.y) * step) / 5,
    )
  }
  await page.mouse.up()
}

/** 现在轮到谁：测试面板的状态行里那一段。 */
async function statusText(page: Page): Promise<string> {
  return (await page.getByTestId('dev-status').textContent()) ?? ''
}

/**
 * 展开 / 收起测试面板。
 *
 * 拖牌之前必须收起来：面板贴在右下角，展开时正好压住手牌右边那两张（它是 DOM，
 * 盖在画布上面，指针事件都被它截走）。
 */
async function setPanel(page: Page, open: boolean): Promise<void> {
  if ((await page.getByTestId('dev-status').isVisible()) === open) return
  await page.getByRole('button', { name: open ? '测试面板' : '收起面板' }).click()
}

/**
 * 往我方手上加一张**确定打得出去**的牌，并返回加完之后的手牌张数。
 *
 * 不从洗出来的那五张里挑：里面可能好几张现在打不出去（要选目标的技能牌拖过去只会立起
 * 选目标层、贵牌引擎直接拒），赌运气的话「拖拽到底通不通」就永远藏在「这张牌不该打出去」
 * 后面。GPT-3.5 是 2 费的普通 AI 牌，开局 5 点 Token 一定买得起，也不用选目标。
 * 面板发的是 `DEBUG_ADD_CARD`，走的是和正常抽牌一样的 `execute` 路径。
 */
async function addPlayableCard(page: Page): Promise<number> {
  const before = Number(await page.getByTestId('dev-hand-count').textContent())
  await page.locator('.dev-panel select').selectOption({ label: 'GPT-3.5' })
  // 面板上「加 1 张」有两颗，己方那一行排在前面（见 client 的 dev/DevPanel.tsx）。
  await page.getByRole('button', { name: '加 1 张' }).first().click()
  await expect
    .poll(async () => Number(await page.getByTestId('dev-hand-count').textContent()))
    .toBe(before + 1)
  return before + 1
}

/** 不是我出牌就把出牌权交出去——测试房对面座位上没有人，他不会自己点。 */
async function ensureMyTurn(page: Page): Promise<void> {
  if ((await statusText(page)).includes('行动方 我')) return
  await page.getByRole('button', { name: '结束出牌' }).click()
  await expect.poll(() => statusText(page)).toContain('行动方 我')
}

test('从首页开一局测试对局，拖牌出牌，一路打到结算页', async ({ page }) => {
  /*
   * 首页整页画在画布上（迁移第 30 条），DOM 里没有「测试对局」那颗钮，
   * 所以进对局这一步是按坐标点的——落点由 canvas 导出的版式函数算（见 homePage.ts）。
   */
  await openHome(page)
  await enterTestMatch(page)

  await page.getByRole('button', { name: '测试面板' }).click()
  const status = page.getByTestId('dev-status')
  await expect(status).toContainText('第 1/')

  // 第一步：真的拖一张牌出去。
  const handCount = page.getByTestId('dev-hand-count')
  expect(Number(await handCount.textContent())).toBeGreaterThan(0)
  await ensureMyTurn(page)
  const before = await addPlayableCard(page)

  let played = false
  /*
   * 拖的每一次都是**同一张确定打得出去的牌**（见 addPlayableCard），落点是**我方那一排
   * 格子的中心**（见 dropSpot）。所以「这张牌本来就不该打出去」和「落点没对准」这两条
   * 借口都没有了：只要拖拽这条链是通的，第一次就该成功。判据是「手牌少了一张」。
   *
   * 还留着重试和时间预算，只为一件这条用例看不见的事：**开局那段是锁着的**
   *（抛硬币 3.54 秒 + 发牌），而它按真实帧间隔推进、每帧最多推 100 毫秒
   *（见 DuelStage 的 MAX_FRAME_MS）。跑机上是 SwiftShader 软件渲染，帧率掉到几帧时
   * 这段 8 秒的开局能拖到几十秒，前面几次拖拽全落在锁上。数次数的话，「几次才够」
   * 就成了一个跟着跑机快慢漂的数字；数时间才是这条用例真正想说的：
   * **一分钟之内总该把这张牌打出去**。
   *
   * 每次等满 2.8 秒：出牌那一下编排层就把演出锁上了，指令被拒时那把锁靠
   * PLAY_LOCK_FALLBACK_MS（2.5 秒）兜底放开，没等满的话下一次拖拽会被锁挡掉。
   */
  const deadline = Date.now() + 60_000
  while (!played && Date.now() < deadline) {
    await setPanel(page, true)
    await ensureMyTurn(page)
    await setPanel(page, false)
    /*
     * 先点一下空地，把上一次可能立起来的选目标层收掉（那一层点哪儿都是取消）。
     * 空地每轮现扫：场上多了一张牌、或者哪层浮层立着，上一轮的空地就不一定还空着。
     */
    const idle = await inertSpot(page, STAGE)
    await page.mouse.click(idle.x, idle.y)
    await dragCard(page)
    await page.waitForTimeout(2800)
    await setPanel(page, true)
    played = Number(await handCount.textContent()) < before
  }
  expect(played, '一分钟之内把一张 2 费的 AI 牌拖到我方那排格子上，一次都没打出去').toBe(true)

  /*
   * 第二步：把剩下的轮次走完。
   *
   * 每一轮「跳到答题 → 等自动交卷 → 双方确认」。题库 8 道题，所以最多 8 轮就一定收场
   *（先到 3 分会更早结束，那时循环从上面那条判断跳出去）。
   */
  const result = page.locator('.result')
  for (let round = 0; round < 10; round += 1) {
    if (await result.isVisible()) break
    await page.getByRole('button', { name: '跳到答题' }).click()
    // 自动交卷要等 2.5 秒，加上演出，给到 30 秒。
    await expect(status).toContainText('结算', { timeout: 30_000 })
    await page.getByRole('button', { name: '确认本轮' }).click()
    await expect.poll(() => statusText(page)).not.toContain('结算')
  }

  // 结算页出来了，而且给了两条出路。
  await expect(result).toBeVisible()
  await expect(result.getByRole('button', { name: '再来一局' })).toBeVisible()
  await expect(result.getByRole('button', { name: '回首页' })).toBeVisible()

  /*
   * 点「回首页」真的回得去。判据是首页那块画布又出现了——首页整页在画布上，
   * DOM 里没有任何一颗按钮可以拿来当路标（这也是这条断言从「看得见『测试对局』」
   * 改成「看得见画布」的原因）。
   */
  await result.getByRole('button', { name: '回首页' }).click()
  await expect(page.locator('.home-stage canvas')).toBeVisible({ timeout: 60_000 })
})
