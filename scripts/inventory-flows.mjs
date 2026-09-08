/**
 * 盘点截图要用到的几段交互：有些界面得先操作一下才到得了（进测试对局、关掉全屏提示）。
 * 和取景表 inventory-scenes.mjs 分开放，是为了两个文件都待在 400 行上限之内。
 */

/**
 * 进测试对局，并把回合要到我方手上——「结束出牌」只有轮到我方才是可用态，
 * 而对方是没人操作的空位，只能靠测试面板替他把这一手结束掉。
 */
export async function enterTestMatch(page) {
  await page.getByRole('button', { name: '测试对局' }).click()
  await page.waitForSelector('.battle-frame')
  await dismissFullscreenPrompt(page)
  // 抛硬币演完这个节点才会撤掉；万一这一版没有硬币，detached 立刻满足，不会白等。
  await page.waitForSelector('.coin-toss', { state: 'detached', timeout: 60000 })
  await page.waitForSelector('.hand-fan__slot')
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: '测试面板' }).click()
  for (let i = 0; i < 4; i += 1) {
    // .hand-fan 上的 data-locked 就是「现在轮不到你」。
    if ((await page.locator('.hand-fan[data-locked]').count()) === 0) break
    await page.getByRole('button', { name: '结束出牌' }).click()
    await page.waitForTimeout(1800)
  }
  await page.getByRole('button', { name: '收起面板' }).click()
  await page.mouse.move(2, 2)
  await page.waitForTimeout(600)
}

/** 关掉进对局时那层「全屏更好看」：触屏档才弹，是全屏浮层，不关掉后面什么都点不着。 */
async function dismissFullscreenPrompt(page) {
  if ((await page.locator('.fs-prompt__skip').count()) === 0) return
  await page.locator('.fs-prompt__skip').click()
  await page.waitForTimeout(400)
}
