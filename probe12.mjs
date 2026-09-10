import { chromium } from 'playwright'

const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
const col = (i, n) => ({ x: 640, y: 250 + (370 - n * 60 - (n - 1) * 14) + i * 74 + 30 })
const row = (i, n) => ({
  x: 360 + (560 - (n * 184 + (n - 1) * 20)) / 2 + i * 204 + 92,
  y: 250 + 340,
})
const rview = (p) => p.evaluate(() => window.__aiDuel?.room?.view() ?? null)
const mview = (p) => p.evaluate(() => window.__aiDuel?.match?.view() ?? null)
const until = async (p, f, what, ms = 40000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    const v = await f(p)
    if (v) return v
    await p.waitForTimeout(300)
  }
  throw new Error('timeout: ' + what)
}
const mk = async (tag) => {
  const browser = await chromium.launch({ headless: true, args: ARGS })
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`[${tag} pageerror]`, e.message))
  await page.goto('http://127.0.0.1:5178/')
  await page.getByRole('button', { name: '联机对战' }).click()
  await page.waitForSelector('.room-stage canvas')
  await until(page, async (q) => (await rview(q))?.account, `${tag} account`)
  console.log(`[${tag}] 进了房间页`)
  return { browser, ctx, page }
}
const A = await mk('A')
const B = await mk('B')
await A.page.mouse.click(col(1, 3).x, col(1, 3).y)
const code = await until(A.page, async (p) => (await rview(p))?.code, 'code')
console.log('房间码', code)
await B.page.mouse.click(col(2, 3).x, col(2, 3).y)
await B.page.getByLabel('房间码').fill(code)
await B.page.getByRole('button', { name: '进去' }).click()
await until(B.page, async (p) => (await rview(p))?.code, 'B code')
console.log('B 进房了')
for (const [t, x] of [
  ['A', A],
  ['B', B],
]) {
  await until(x.page, async (q) => (await rview(q))?.ready === 'idle', `${t} ready idle`)
  await x.page.mouse.click(row(0, 2).x, row(0, 2).y)
  await until(x.page, async (q) => (await rview(q))?.ready === 'done', `${t} ready done`)
}
console.log('双方就绪')
for (const x of [A, B]) await x.page.waitForSelector('.duel-stage canvas', { timeout: 60000 })
console.log('两端都进对局页')
const step = (p) =>
  p.evaluate(() => {
    const m = window.__aiDuel?.match
    if (!m) return 'no-hook'
    const s = m.view()
    const v = s.view
    const seat = s.seat
    if (!v || seat === null) return 'wait'
    if (v.phase === 'finished') return 'over'
    if (v.phase === 'settle') {
      if (v.settleConfirmed[seat]) return 'wait'
      m.send({ type: 'CONFIRM_ROUND', player: seat })
      return 'confirm'
    }
    if (v.phase !== 'play' || v.activePlayer !== seat) return 'wait'
    const c = v.self.hand.find((h) => {
      const d = v.catalog.cards[h.cardId]
      return (
        d && d.kind === 'ai' && Math.max(0, d.tokenCost - v.self.costReduction) <= v.self.tokens
      )
    })
    if (!c) {
      m.send({ type: 'END_PLAY', player: seat })
      return 'end'
    }
    m.send({ type: 'PLAY_CARD', player: seat, instanceId: c.instanceId })
    return 'play'
  })
let last = ''
for (let i = 0; i < 400; i++) {
  const s = await Promise.all([step(A.page), step(B.page)])
  if (s.every((x) => x === 'over')) {
    console.log('打完了', i)
    break
  }
  const v = await mview(A.page)
  const d = `r${v?.view?.round} ${v?.view?.phase} act=${v?.view?.activePlayer}`
  if (d !== last) {
    last = d
    console.log(i, d, s.join('/'))
  }
  await A.page.waitForTimeout(s.every((x) => x === 'wait') ? 800 : 400)
}
for (const [t, x] of [
  ['A', A],
  ['B', B],
])
  console.log(
    t,
    'result',
    await x.page
      .locator('.match-result')
      .getAttribute('data-outcome')
      .catch(() => 'none'),
  )
await A.browser.close()
await B.browser.close()
