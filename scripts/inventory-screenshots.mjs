#!/usr/bin/env node
/**
 * 给组件需求单拍盘点截图（《正式版架构》8 章第 9 条）。
 *
 *   node scripts/inventory-screenshots.mjs                 # 全部重拍
 *   node scripts/inventory-screenshots.mjs --only deck,room  # 只重拍其中几幕
 *
 * 出图落在 docs/design/inventory/，文件名是「幕名__元件名[--状态].webp」，
 * docs/design/组件需求单.md 按这个命名引用，改名之前先看一眼那份文档。
 *
 * 和 scripts/screenshots.mjs 的分工：那个拍四张 README 门面图，这个按**元件**逐个裁，
 * 每个元件再拍普通 / 悬停 / 按下 / 禁用几种状态——需求单要的是「这颗按钮长什么样、
 * 有几个态」，整页图看不出这些。
 *
 * 手机档只拍整页：旧客户端是 1672×941 的死版式整体缩放（见 legacy 的 useStageScale），
 * 手机上不是另一套版式而是同一套被缩小，需求单要的正是这个对比（需求第 3 条）。
 *
 * 拍之前要装浏览器内核：`pnpm exec playwright install chromium`。
 */

import { spawn } from 'node:child_process'
import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { SCENES } from './inventory-scenes.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = path.join(REPO_ROOT, 'docs', 'design', 'inventory')

/** 端口都刻意避开常用档：5173/5174 有别的 worktree 和正式版壳占着，8787 是手动起的转发器。 */
const DEV_PORT = 5373
const RELAY_PORT = 8987

const DESKTOP = { width: 1440, height: 900 }
const MOBILE = { width: 390, height: 844 }

const args = parseArgs(process.argv.slice(2))
const only = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null
const scenes = only ? SCENES.filter((scene) => only.has(scene.name)) : SCENES

if (scenes.length === 0) {
  console.error(`--only 没匹配到任何一幕。可选：${SCENES.map((s) => s.name).join(', ')}`)
  process.exit(1)
}

/** 拍到的文件和没拍到的元件，最后一并汇总——「未截到」那一栏要照这份清单写。 */
const shot = []
const missed = []

await main()

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const needsRelay = scenes.some((scene) => scene.needsRelay)
  const relay = needsRelay ? await startRelay() : null
  const server = await startDevServer()
  const browser = await chromium.launch()
  try {
    for (const scene of scenes) {
      await runScene(browser, scene)
    }
  } finally {
    await browser.close()
    server.stop()
    relay?.stop()
  }
  await report()
}

async function runScene(browser, scene) {
  // 桌面档拍元件 + 整页，手机档只拍整页（两档的差别是版式，不是元件长相）。
  // touch 那一幕例外：竖屏提示只在手机档出得来，它的元件也只能在那一档拍。
  if (scene.touch !== true) await visit(browser, scene, DESKTOP, 'desktop', true)
  if (scene.full.includes('m')) {
    await visit(browser, scene, scene.viewport ?? MOBILE, 'mobile', scene.touch === true)
  }
}

async function visit(browser, scene, viewport, label, withShots) {
  // 每幕开新 context：存档在 localStorage 里，上一幕选过的牌组不该带进下一幕。
  const context = await browser.newContext({ viewport, hasTouch: scene.touch === true })
  const page = await context.newPage()
  try {
    await page.goto(`http://localhost:${DEV_PORT}${scene.path}`, { waitUntil: 'load' })
    if (scene.waitFor) await page.waitForSelector(scene.waitFor, { timeout: 60000 })
    await page.waitForTimeout(scene.settleMs)
    if (scene.prepare) await scene.prepare(page)
    if (scene.full.includes(label === 'desktop' ? 'd' : 'm')) {
      const buf = await page.screenshot({ fullPage: scene.scroll === true })
      await write(buf, `${scene.name}--full-${label}.webp`, 70, 1120)
    }
    if (withShots) {
      for (const item of scene.shots) await captureShot(page, scene, item)
    }
    console.log(`✓ ${scene.name} · ${label}`)
  } catch (error) {
    console.error(`✗ ${scene.name} · ${label}：${String(error).split('\n')[0]}`)
    missed.push(`${scene.name}（整幕）· ${label}：${String(error).split('\n')[0]}`)
  } finally {
    await context.close()
  }
}

async function captureShot(page, scene, [name, selector, states = '', pad = 10, pre]) {
  const base = `${scene.name}__${name}`
  // pre 是「先动别处一下，这个元件才现身」：出牌按钮要先点中那张手牌才会渲染出来。
  if (pre !== undefined) {
    const opener = page.locator(pre.tap ?? pre.click ?? pre.hover).first()
    // tap 和 click 不能混：手牌上「点一下」用鼠标是直接出牌、用手指才是选中
    //（见 legacy 的 HandFan.handleTap），只有真发触摸事件才拍得到那颗「打出」。
    if (pre.tap !== undefined) await opener.tap()
    else if (pre.click !== undefined) await opener.click()
    else await opener.hover({ force: true })
    await page.waitForTimeout(700)
  }
  if (!(await crop(page, selector, `${base}.webp`, pad))) {
    missed.push(`${base}  ${selector}`)
    return
  }
  const target = page.locator(selector).first()
  if (states.includes('h')) {
    await target.hover({ force: true })
    await page.waitForTimeout(400)
    await crop(page, selector, `${base}--hover.webp`, pad)
  }
  if (states.includes('d')) {
    // 禁用态在真实流程里往往要凑特定条件（牌不够、房间没连上），这里直接把属性加上——
    // 拍的是 :disabled 那套样式，和真实触发时是同一份。
    await target.evaluate((node) => node.setAttribute('disabled', ''), { timeout: 5000 })
    await page.waitForTimeout(250)
    await crop(page, selector, `${base}--disabled.webp`, pad)
    await target.evaluate((node) => node.removeAttribute('disabled'), { timeout: 5000 })
  }
  // 按下放在最后：按钮真被按下就可能跳页，跳了之后这一幕剩下的元件就都拍不到了。
  if (states.includes('p')) {
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(220)
    await crop(page, selector, `${base}--press.webp`, pad)
    // 先把指针挪开再松手：按下和松开落在不同元素上，浏览器就不派发 click，
    // 拍一颗「返回」不至于顺带跳走一页。（匾额按钮有 setPointerCapture，这招对它无效，
    // 所以会跳页的匾额按钮一律不排「按下」态，改在 /design 那两颗不跳页的样品上拍。）
    await page.mouse.move(2, 2)
    await page.mouse.up()
    await page.waitForTimeout(200)
  }
  await page.mouse.move(2, 2)
  await page.waitForTimeout(150)
}

/** 按元件的包围盒裁一张图，四周留 pad。元件不在页面上或被裁没了就返回 false。 */
async function crop(page, selector, file, pad) {
  const target = page.locator(selector).first()
  if ((await target.count()) === 0) return false
  // 长页面（/design 那种）上的元件多半在首屏之下，不先滚进视口的话裁出来是一片空白：
  // 下面那次 screenshot 用的 clip 是视口坐标，落在视口外的部分根本没有像素。
  await target.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
  const box = await target.boundingBox()
  if (box === null) return false
  const view = page.viewportSize()
  const left = Math.max(0, box.x - pad)
  const top = Math.max(0, box.y - pad)
  const right = Math.min(view.width, box.x + box.width + pad)
  const bottom = Math.min(view.height, box.y + box.height + pad)
  if (right - left < 4 || bottom - top < 4) return false
  const buf = await page.screenshot({
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  })
  await write(buf, file, 88)
  return true
}

/**
 * 统一存成 webp：这批图只在 Markdown 里当参照看，png 一张整页要 1MB 出头，
 * 而需求单里有几十张，仓库得一直背着它们。
 */
async function write(buffer, file, quality, maxWidth) {
  let image = sharp(buffer)
  if (maxWidth !== undefined) image = image.resize({ width: maxWidth, withoutEnlargement: true })
  await image.webp({ quality }).toFile(path.join(OUT_DIR, file))
  shot.push(file)
}

async function report() {
  const names = await readdir(OUT_DIR)
  let bytes = 0
  for (const name of names) bytes += (await stat(path.join(OUT_DIR, name))).size
  console.log(
    `\n出图 ${shot.length} 张，目录里共 ${names.length} 个文件，合计 ${(bytes / 1048576).toFixed(2)} MB`,
  )
  if (missed.length === 0) return
  console.log(`\n没拍到的 ${missed.length} 项（需求单里标「未截到」）：`)
  for (const line of missed) console.log(`  · ${line}`)
}

/** 起截图专用的 dev server，顺手把转发器地址指到本地，/room 那一幕要靠它拿房间码。 */
async function startDevServer() {
  return startProcess({
    label: 'dev server',
    port: DEV_PORT,
    cwd: path.join(REPO_ROOT, 'packages', 'legacy-client'),
    argv: ['exec', 'vite', '--port', String(DEV_PORT), '--strictPort'],
    env: { ...process.env, VITE_SERVER_URL: `http://127.0.0.1:${RELAY_PORT}` },
    probePath: '/',
  })
}

/** 起截图专用的转发器。探活打的就是页面进来要房间码的那个接口，能返回码才算真能用。 */
async function startRelay() {
  // wrangler 启动时会校验静态资源目录存不存在，客户端没 build 过它就直接退出；
  // 截图的页面由 vite 提供，走不到这个目录，空目录就够它过这一关。
  await mkdir(path.join(REPO_ROOT, 'packages', 'legacy-client', 'dist'), { recursive: true })
  return startProcess({
    label: '转发器',
    port: RELAY_PORT,
    cwd: path.join(REPO_ROOT, 'packages', 'server'),
    argv: ['exec', 'wrangler', 'dev', '--port', String(RELAY_PORT)],
    env: process.env,
    probePath: '/api/room',
  })
}

/**
 * 起一个后台进程，等它在自己的端口上应答，返回一个能关掉它的把手。
 *
 * detached + 杀整个进程组：pnpm 会再 fork 出真正的 vite / wrangler，只杀 pnpm 的话
 * 子进程会活下来占着端口，下次跑脚本就撞端口冲突。
 */
async function startProcess({ label, port, cwd, argv, env, probePath }) {
  console.log(`起${label}（端口 ${port}）…`)
  const child = spawn('pnpm', argv, { cwd, env, stdio: 'ignore', detached: true })
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      // 已经自己退了就没什么可杀的。
    }
  }
  process.on('exit', stop)

  const url = `http://localhost:${port}${probePath}`
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return { stop }
    } catch {
      // 还没起来，接着轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  stop()
  throw new Error(`${label} 90 秒还没起来（${url}）`)
}

/** 只认 `--key value` 和 `--key=value` 两种写法，够这个脚本用了。 */
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const eq = arg.indexOf('=')
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1)
    } else {
      out[arg.slice(2)] = argv[i + 1]
      i += 1
    }
  }
  return out
}
