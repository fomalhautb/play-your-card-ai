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

/*
 * 手牌那五张在屏幕上的位置，按 1280×900 的桌面档版式算出来的
 *（公式见 canvas 的 scenes/duel/layout/desktopLayout.ts 和 layout/fanMath.ts）：
 *
 *   侧栏宽 306 → 战场那一栏从 x=306 起、宽 974，手牌扇形的锚点在它正中 x=793；
 *   手牌整排缩放 974/1000 ≈ 0.974，锚点压在视口底边 y=900，整排再抬起 32×0.974 ≈ 31；
 *   五张牌按 95 的间距铺开（fanMath 的 GAP_PER_CARD），换算到屏幕上约 92.5 一格。
 *
 * 所以按在卡底往上 90 像素处，稳稳落在那张牌上（卡高 225×0.974 ≈ 219）。
 */
const FAN = { centerX: 793, stepX: 92.5, y: 780 }
/** 松手的地方：战场正中，在出牌区里（出牌区下沿约 y=736，上沿约 y=114）。 */
const DROP = { x: 793, y: 400 }
/**
 * 一处「点了什么都不会发生」的空地：侧栏那块玩家面板上。
 *
 * 用来收掉可能立起来的选目标层——那一层铺满全屏、点哪儿都是取消。
 * 不能拿战场当空地：点战场上的格子会打开放大查看，那反而多一层要收的东西。
 */
const IDLE_SPOT = { x: 60, y: 500 }

/** 拖第 index 张手牌（0 是最左边那张）到出牌区。 */
async function dragCard(page: Page, index: number): Promise<void> {
  const from = { x: FAN.centerX + FAN.stepX * (index - 2), y: FAN.y }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // 中间多走几步是因为拖拽有 4 像素的阈值，一步到位反而可能被当成点击。
  for (let step = 1; step <= 5; step += 1) {
    await page.mouse.move(
      from.x + ((DROP.x - from.x) * step) / 5,
      from.y + ((DROP.y - from.y) * step) / 5,
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

/** 不是我出牌就把出牌权交出去——测试房对面座位上没有人，他不会自己点。 */
async function ensureMyTurn(page: Page): Promise<void> {
  if ((await statusText(page)).includes('行动方 我')) return
  await page.getByRole('button', { name: '结束出牌' }).click()
  await expect.poll(() => statusText(page)).toContain('行动方 我')
}

test('从首页开一局测试对局，拖牌出牌，一路打到结算页', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '测试对局' }).click()
  // 画布起来了才算进了对局页。图集要现下，给足时间。
  await expect(page.locator('.duel-stage canvas')).toBeVisible({ timeout: 60_000 })

  await page.getByRole('button', { name: '测试面板' }).click()
  const status = page.getByTestId('dev-status')
  await expect(status).toContainText('第 1/')

  // 第一步：真的拖一张牌出去。
  const handCount = page.getByTestId('dev-hand-count')
  const before = Number(await handCount.textContent())
  expect(before).toBeGreaterThan(0)

  let played = false
  /*
   * 一张张试过去、试两圈，判据是「手牌少了一张」。这不是在掩盖不稳定，两条都是真规矩：
   *
   * - **换着牌试**：手上五张里可能好几张现在打不出去——要选目标的技能牌（拖出去只会
   *   立起选目标层）、Token 不够的贵牌（引擎直接拒）。手牌是洗出来的，赌不了运气。
   * - **每次等满 2.8 秒**：出牌那一下编排层就把演出锁上了，指令被拒时那把锁靠
   *   PLAY_LOCK_FALLBACK_MS（2.5 秒）兜底放开，没等满的话下一次拖拽会被锁挡掉，
   *   白白浪费一张牌的机会。开局那段（抛硬币 3.54 秒 + 发牌）同样是锁着的，
   *   头一两次拖不动是正常的。
   */
  const order = [2, 1, 3, 0, 4]
  for (let attempt = 0; attempt < order.length * 2 && !played; attempt += 1) {
    await setPanel(page, true)
    await ensureMyTurn(page)
    await setPanel(page, false)
    // 先点一下空地，把上一次可能立起来的选目标层收掉（那一层点哪儿都是取消）。
    await page.mouse.click(IDLE_SPOT.x, IDLE_SPOT.y)
    await dragCard(page, order[attempt % order.length] ?? 2)
    await page.waitForTimeout(2800)
    await setPanel(page, true)
    played = Number(await handCount.textContent()) < before
  }
  expect(played, '把五张手牌轮着拖了两圈都没能打出去一张').toBe(true)

  /*
   * 第二步：把剩下的轮次走完。
   *
   * 每一轮「跳到答题 → 等自动交卷 → 双方确认」。题库 8 道题，所以最多 8 轮就一定收场
   *（先到 3 分会更早结束，那时循环从上面那条判断跳出去）。
   */
  const result = page.locator('.match-result')
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

  // 点「回首页」真的回得去，而且这一局被丢掉了（再进 /match 会被弹回首页）。
  await result.getByRole('button', { name: '回首页' }).click()
  await expect(page.getByRole('button', { name: '测试对局' })).toBeVisible()
})
