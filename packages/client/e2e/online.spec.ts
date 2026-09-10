/**
 * 联机端到端：两个浏览器上下文，一个开房、一个按码进房，打完整局；再验一次掉线重连。
 * 对应《正式版架构》6.11 的「Playwright 开两个页面：建房、对战、结算走完」。
 *
 * 这两条守的是**接缝**，而且是只有两台机器凑齐才暴露得出来的那几道：
 * 游客登录换 JWT、大厅发码、房间分座位、序号对账、断线重连之后的重同步、
 * 两端对胜负的说法一致。每一层自己都有单元测试，但「合起来能不能打完一局」只有真跑一遍才知道。
 *
 * 两个人各开一个**浏览器**（见 players.ts）：一是账号的会话在 cookie 里，共用一份 cookie
 * 就是同一个游客账号，第二个人会被服务端当成第一个人重连、把第一条连接顶掉
 *（协议的 `superseded`）；二是两块 Pixi 画布挤在同一个浏览器里会互相把主线程占死，
 * 那条实测数据写在 players.ts 的文件头。
 *
 * 房间页那三颗钮是真的用指针点的（它们画在画布上，见 roomPage.ts）；
 * 对局里的出牌走调试口子，理由见 src/dev/debugHook.ts 的文件头。
 */

import { expect, test } from '@playwright/test'
import { expectSameOutcome, matchView, playToFinish } from './matchPage'
import { openPlayer } from './players'
import {
  createRoom,
  joinQueue,
  joinRoom,
  leaveRoom,
  openRoomPage,
  readyUp,
  roomView,
  waitForCanvas,
} from './roomPage'

/**
 * 这两条**不录 trace**，别的用例照录（配置里是 `retain-on-failure`）。
 *
 * 录 trace 会给每个上下文开一路 CDP 截屏流。这两页整幅都是一块 1280×900 的 WebGL 画布，
 * 跑机上又是 SwiftShader 软件渲染，截屏流把渲染进程压住之后，CDP 的答复整个不回来了——
 * 本机实测：`toBeVisible` 这种带着 60 秒超时的等待会**一直挂到用例超时**，
 * 连它自己那个超时都轮不上；关掉 trace 之后同一条用例一路跑到底。
 *
 * 注意这一条对**用例自己开的浏览器**同样管用：`@playwright/test` 导出的 `chromium`
 * 是被跑批器包过的，在用例里开出来的上下文照样归它的 artifacts 那套管。
 *
 * 代价可以接受：trace 的看家本领是回放 DOM 快照，而这两页的界面一个 DOM 节点都没有，
 * 快照里只有一个空的 `<canvas>`。真要查问题，用例失败时打出来的那份状态
 *（见 roomPage.ts 的 `untilRoom`）比 trace 有用得多。
 */
test.use({ trace: 'off' })

/** 掉线演多久。要明显长于一次重连退避（封顶 5 秒，见 platform 的 web/network.ts）。 */
const OFFLINE_MS = 10_000

test('两个浏览器开房、进房、打完整局，双方结算一致', async () => {
  const host = await openPlayer('A')
  const guest = await openPlayer('B')
  const { page: pageA } = host
  const { page: pageB } = guest

  try {
    await openRoomPage(pageA)
    await openRoomPage(pageB)

    // 两个上下文各自开了号，而且不是同一个账号——同一个的话下面的座位分配就没意义了。
    const [nameA, nameB] = [(await roomView(pageA)).account, (await roomView(pageB)).account]
    expect(nameA, '两个上下文拿到了同一个游客账号').not.toBe(nameB)

    /*
     * 先开一次再离开：`room:leave` 会让房间当场收摊（server 的 membership.ts），
     * 这一页要能干干净净回到起点，而不是攥着一条连着已收摊房间的连接。
     * 这一步只花两秒，却是「离开」那条路唯一的端到端覆盖。
     */
    const abandoned = await createRoom(pageA)
    expect(abandoned).toMatch(/^\d{4}$/)
    await leaveRoom(pageA)
    await expect.poll(async () => (await roomView(pageA)).code, { timeout: 15_000 }).toBeNull()

    const code = await createRoom(pageA)
    await joinRoom(pageB, code)

    // 对方进房这件事是服务端推过来的（`room:peer`），开房那一端要能看见。
    await expect
      .poll(async () => (await roomView(pageA)).status, { timeout: 30_000 })
      .toContain('对方进来了')

    await readyUp(pageA)
    await readyUp(pageB)
    console.log('双方就绪，等开局')

    // 双方就绪 → 服务端 `match:started` → 两端各自跳到对局页。
    for (const page of [pageA, pageB]) await waitForCanvas(page, '.duel-stage canvas')
    console.log('两端都进了对局页')

    // 座位是服务端分的，一人一个，不会撞。
    const seats = await Promise.all([matchView(pageA), matchView(pageB)]).then((views) =>
      views.map((one) => one.seat),
    )
    expect([...seats].sort(), '两端拿到的座位不是 0 和 1').toEqual([0, 1])
    console.log(`座位分好了：${seats.join(' / ')}，开始打`)

    await playToFinish([pageA, pageB])
    await expectSameOutcome([pageA, pageB])
  } finally {
    await host.close()
    await guest.close()
  }
})

/**
 * 这一条**只验掉线那一端自己**，不验对面看没看到他掉线。
 *
 * 不是不想验，是本地环境验不了：Playwright 的断网是浏览器那一层的模拟，
 * 已经建好的那条 TCP 连接不会被拆掉，只是数据出不去。客户端因此靠心跳自己判死
 *（见 net/session.ts），而**服务端那头什么都没察觉**——它要等 TCP 超时，本地开发下
 * 基本等不到。所以「对面看到 `room:peer` 的 online 翻成 false」这一条在这里必然超时。
 *
 * 那一半由服务端自己的测试守着（packages/server 的 match.test.ts、cheat.test.ts：
 * 断开之后对手收到 `online: false`，重连回来再收到 `online: true`），
 * 那边关的是真的 WebSocket，验得准。
 */
test('一端掉线十秒再回来，重连之后这一局还能打完', async () => {
  const host = await openPlayer('A')
  const guest = await openPlayer('B')
  const { page: pageA } = host
  const { page: pageB } = guest

  try {
    await openRoomPage(pageA)
    await openRoomPage(pageB)

    /*
     * 这一条走的是**排队匹配**那条路（另一条用例走的是开房 + 按码进房），
     * 三条进房的路因此各有一条端到端覆盖。队列按入队时间配对，两个人一进去就凑成一对。
     */
    await joinQueue(pageA)
    await joinQueue(pageB)
    for (const page of [pageA, pageB]) {
      await expect
        .poll(async () => (await roomView(page)).code, { timeout: 60_000 })
        .toMatch(/^\d{4}$/)
    }
    const codes = [(await roomView(pageA)).code, (await roomView(pageB)).code]
    expect(codes[0], '配对的两个人拿到的不是同一个房间码').toBe(codes[1])

    await readyUp(pageA)
    await readyUp(pageB)
    for (const page of [pageA, pageB]) await waitForCanvas(page, '.duel-stage canvas')

    // 开局那批事件到手了才断——断在握手中间验的是别的东西（那条归服务端的握手测试）。
    await expect
      .poll(async () => (await matchView(pageA)).status, { timeout: 60_000 })
      .toBe('playing')

    await host.setOffline(true)
    /*
     * 断网之后 socket 在浏览器眼里还开着，只是数据出不去，客户端要靠心跳自己判死：
     * 15 秒发一次 ping、发出去 20 秒等不到 pong 才算（见 net/session.ts），最坏 35 秒。
     * 顶栏那行「正在重连…」照的就是这一位（见 screens/matchStatus.ts）。
     */
    await expect.poll(async () => (await matchView(pageA)).link, { timeout: 60_000 }).toBe('down')
    console.log('A 已经知道自己断了')

    await pageA.waitForTimeout(OFFLINE_MS)
    await host.setOffline(false)

    /*
     * 回来之后 `link` 要变回 `'ok'`。这一位不是「socket 连上了」那么浅：
     * 对局中途的 `link` 只有在**拿到一份新的 `match:snapshot`** 时才翻回来
     *（见 serverDriver 的 onSnapshot）。所以这一句同时验掉了重连、重新握手、
     * 以及协议 README 第 4、5 条那条「重连要发 room:resync、服务端回完整快照」。
     */
    await expect.poll(async () => (await matchView(pageA)).link, { timeout: 60_000 }).toBe('ok')
    console.log('A 重连回来并拿到了新快照')

    // 光看「连上了」不够——真正要验的是这一局还能接着打下去，所以直接打到收场。
    await playToFinish([pageA, pageB])
    await expectSameOutcome([pageA, pageB])
  } finally {
    await host.close()
    await guest.close()
  }
})
