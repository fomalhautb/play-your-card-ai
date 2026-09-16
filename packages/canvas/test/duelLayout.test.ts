/**
 * 两档对局版式：挑哪一档，以及各自的几何。
 *
 * 桌面档这一档**钉死具体的数**：它是黑客松版那块 1672×941 死版式的还原，每一行都能在
 * 那一版的 `styles.css` 里找到对应的一条规则（见 desktopLayout.ts 的文件头）。
 * 钉死是有意的——这些数之间互相咬着（扇形可铺宽依赖「结束出牌」的左沿、战场高度预算
 * 依赖两排格子加中线正好用完 465），漏改一个不会当场报错，只会让画面慢慢走样。
 *
 * 手机档相反，断言的是**两档真的不一样**（侧栏折叠、战场缩一档、手牌区更高）和
 * 那几条不能破的关系：手牌不压到战场、出牌区够得着、各块都在舞台里。
 * 它平时按视口实算、不缩放，视口矮到战场摆不下时会整块等比缩小一次——缩完那几条照样成立，
 * 所以横屏那两组视口也进了文件底部的不变量清单。
 */

import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT, PLAYER_FAN } from '../src/layout/fanMath'
import { desktopLayout } from '../src/scenes/duel/layout/desktopLayout'
import { mobileLayout } from '../src/scenes/duel/layout/mobileLayout'
import { pickLayout, pickTier, TOUCH_BREAKPOINT } from '../src/scenes/duel/layout/pickLayout'
import { type DuelLayout, FOE_FAN_SCALE, MIN_BOARD_HEIGHT } from '../src/scenes/duel/layout/types'

/** 两档各取一个有代表性的视口：一台 1080p 显示器，一部 iPhone。 */
const DESKTOP = { width: 1920, height: 1080 }
const MOBILE = { width: 390, height: 844 }

/**
 * 整排手牌静止时的最上沿。
 *
 * 卡的原点在底边中点，所以一张牌的上沿在自己原点上方一张卡；整排还整体沉了
 * `PLAYER_FAN.sink`（负数是往上，见 fanMath）。两项都在扇形自己的坐标系里，
 * 所以一起乘 `hand.scale` 再挂到锚点上。
 *
 * **不算悬停放大**（`HOVER_SCALE` ≈ 1.89）：指针停住的那一张是故意升到战场上面去看清楚的
 * （同炉石），算进来的话「手牌不压到战场」对两档都不成立。那张盖住我方半排格子是另一件
 * 已知的事，归后面的视觉重做，不由这条断言管。
 */
function fanTop(layout: DuelLayout): number {
  return layout.hand.y + (PLAYER_FAN.sink - CARD_HEIGHT) * layout.hand.scale
}

describe('挑哪一档版式', () => {
  it('大屏走桌面档，小屏走手机档', () => {
    expect(pickTier(DESKTOP.width)).toBe('desktop')
    expect(pickTier(MOBILE.width)).toBe('mobile')
  })

  it('指针是粗的就一律走手机档，屏幕再大也一样', () => {
    // 大屏平板照样是手指在点：热区和手牌区要按触屏来，这和屏幕多大无关。
    expect(pickTier(DESKTOP.width, true)).toBe('mobile')
  })

  it('看的是宽不是短边', () => {
    expect(pickTier(TOUCH_BREAKPOINT)).toBe('desktop')
    expect(pickTier(TOUCH_BREAKPOINT - 1)).toBe('mobile')
    // 横过来的手机（844×390）由「指针是粗的」那条收走，不靠短边。
    expect(pickTier(MOBILE.height, true)).toBe('mobile')
  })

  it('窗口拉矮的鼠标电脑仍然是桌面档', () => {
    /*
     * 2026-09-16 的回归：短边判据把 1790×655 这种矮窗口判进手机档，而手机档当时不缩放，
     * 顶栏加面板行加对手手牌条加手牌区在 655 高上把战场挤剩一百多像素、落点区更是空的，
     * 于是牌拖上去怎么松手都回弹——用户看到的就是「打不出牌」。
     *
     * 2026-09-17 手机档补上了矮视口缩放，这种窗口在那一档也能打了；判据仍然不改，
     * 理由见 pickLayout 的文件头（宽屏本来就该走为宽屏排的那一档）。
     */
    expect(pickTier(1790)).toBe('desktop')
    const short = pickLayout(1790, 655)
    expect(short.tier).toBe('desktop')
    // 桌面档靠整块缩放装进矮视口，各块的相对关系一个都不变。
    expect(short.stage.scale).toBeCloseTo(655 / 941, 6)
  })

  it('pickLayout 给出的就是对应那一档的版式', () => {
    expect(pickLayout(DESKTOP.width, DESKTOP.height).tier).toBe('desktop')
    expect(pickLayout(MOBILE.width, MOBILE.height).tier).toBe('mobile')
  })
})

describe('桌面档还原黑客松版那块 1672×941 死版式', () => {
  const layout = desktopLayout(DESKTOP.width, DESKTOP.height)

  it('舞台恒为设计尺寸，缩放和居中偏移另算', () => {
    expect(layout.width).toBe(1672)
    expect(layout.height).toBe(941)
    expect(layout.viewport).toEqual(DESKTOP)
    // 1920×1080 下高是窄的那边：941 × scale 正好铺满 1080。
    expect(layout.stage.scale).toBeCloseTo(1080 / 941, 6)
    expect(layout.stage.y).toBeCloseTo(0, 6)
    expect(layout.stage.x).toBeGreaterThan(0)
  })

  it('视口再怎么变，舞台里的数一个都不动', () => {
    const narrow = desktopLayout(1280, 800)
    expect(narrow.boardFrame).toEqual(layout.boardFrame)
    expect(narrow.hand).toEqual(layout.hand)
    expect(narrow.stage.scale).toBeCloseTo(1280 / 1672, 6)
  })

  it('顶栏 72、侧栏 306 宽且从顶栏下沿铺到底', () => {
    expect(layout.topBarHeight).toBe(72)
    expect(layout.sideBar).toEqual({ x: 0, y: 72, width: 306, height: 869 })
  })

  it('两块玩家面板各 266×373.5，英雄牌按 2:3 填满就是 249×373.5', () => {
    expect(layout.panels.theirs).toEqual({ x: 20, y: 112, width: 266, height: 373.5 })
    expect(layout.panels.mine).toEqual({ x: 20, y: 527.5, width: 266, height: 373.5 })
  })

  it('战场外框 334/156/1310×535，内边距 52/24/18', () => {
    expect(layout.boardFrame).toEqual({ x: 334, y: 156, width: 1310, height: 535 })
    expect(layout.board.x).toBe(358)
    expect(layout.board.y).toBe(208)
    expect(layout.board.width).toBe(1262)
    expect(layout.board.height).toBe(465)
    expect(layout.board.scale).toBe(1)
  })

  it('落点区左右和上沿同战场外框，下沿往下让出 0.75 张卡', () => {
    expect(layout.dropZone.x).toBe(layout.boardFrame.x)
    expect(layout.dropZone.y).toBe(layout.boardFrame.y)
    expect(layout.dropZone.width).toBe(layout.boardFrame.width)
    /*
     * 下沿 772.25，比外框下沿（691）低 81。鼠标拖拽时牌不抬、原点又在底边中点，
     * 整张牌画在指针上方：下沿贴着外框的话，玩家把牌拖到「看着盖住战场」时指针还在
     * 外框下面一截，松手就回弹（见 desktopLayout 的 DROP_GAP_CARDS）。
     */
    expect(layout.dropZone.y + layout.dropZone.height).toBeCloseTo(941 - CARD_HEIGHT * 0.75, 6)
  })

  it('Token 细条 44×470 贴舞台右缘、纵向居中', () => {
    expect(layout.tokenRail).toEqual({ x: 1628, y: 235.5, width: 44, height: 470 })
  })

  it('「下一题」匾在战场右上 x 1448…1616、y 72…216', () => {
    expect(layout.nextPlaque).toEqual({ x: 1448, y: 72, width: 168, height: 144 })
  })

  it('「对方回合」吊匾 252×66，对着战场居中吊在顶栏下沿', () => {
    expect(layout.turnPlaque).toEqual({ x: 863, y: 93, width: 252, height: 66 })
  })

  it('「结束出牌」184×60 压在手牌区右下角', () => {
    expect(layout.endPlay).toEqual({ x: 1456, y: 849, width: 184, height: 60 })
  })

  it('手牌锚点 (989,941) 不缩放，可铺宽按「中线到结束出牌左沿」算出 934', () => {
    expect(layout.hand.x).toBe(989)
    expect(layout.hand.y).toBe(941)
    expect(layout.hand.scale).toBe(1)
    expect(layout.hand.areaWidth).toBe(934)
  })

  it('对手手牌钉在舞台顶边，可铺宽就是战场那一栏的宽', () => {
    expect(layout.foeHand.y).toBe(0)
    expect(layout.foeHand.x).toBe(989)
    expect(layout.foeHand.areaWidth).toBe(1366)
  })

  it('发牌从我方英雄牌右下角那摞牌起飞', () => {
    // 堆宽 = 英雄卡宽 249 × 0.28 = 69.72，起飞缩放就是它比卡面基准宽。
    expect(layout.deck.scale).toBeCloseTo(69.72 / 150, 6)
    // 起飞点在侧栏那一列里，且落在我方面板那半截上。
    expect(layout.deck.x).toBeGreaterThan(0)
    expect(layout.deck.x).toBeLessThan(306)
    expect(layout.deck.y).toBeGreaterThan(layout.panels.mine.y)
    expect(layout.deck.y).toBeLessThan(941)
  })

  it('横幅垂直居中，落点提示在战场顶部那 52px 的让位里', () => {
    expect(layout.banner).toEqual({ x: 989, y: 470.5 })
    const cue = layout.dropCue
    expect(cue).not.toBeNull()
    if (cue === null) return
    expect(cue.y).toBeGreaterThanOrEqual(layout.boardFrame.y)
    expect(cue.y + cue.height).toBeLessThanOrEqual(layout.board.y)
  })
})

describe('两档真的分岔了', () => {
  const desktop = desktopLayout(DESKTOP.width, DESKTOP.height)
  const mobile = mobileLayout(MOBILE.width, MOBILE.height)

  it('侧栏和贴边那几样在手机档全折叠掉', () => {
    expect(desktop.sideBar).not.toBeNull()
    expect(mobile.sideBar).toBeNull()
    expect(mobile.tokenRail).toBeNull()
    expect(mobile.nextPlaque).toBeNull()
    expect(mobile.turnPlaque).toBeNull()
    expect(mobile.dropCue).toBeNull()
  })

  it('手机档两块面板并排，装得进屏幕', () => {
    const { theirs, mine } = mobile.panels
    expect(theirs.width).toBeGreaterThan(0)
    expect(theirs.y).toBe(mine.y)
    expect(mine.x).toBeGreaterThan(theirs.x + theirs.width)
    expect(mine.x + mine.width).toBeLessThanOrEqual(mobile.width)
  })

  it('桌面档两块面板上下排', () => {
    expect(desktop.panels.mine.y).toBeGreaterThan(desktop.panels.theirs.y)
  })

  it('战场在手机档缩一档，桌面档不缩', () => {
    expect(desktop.board.scale).toBe(1)
    expect(mobile.board.scale).toBeLessThan(1)
  })

  it('手机档在够高的视口里不缩放，桌面档永远缩', () => {
    expect(mobile.stage).toEqual({ scale: 1, x: 0, y: 0 })
    expect(desktop.stage.scale).not.toBe(1)
  })

  it('手牌区在手机档更高，顶栏更矮', () => {
    // 「手牌区多高」在版式里没有单独的字段，看的是扇形锚点离战场下沿留了多少。
    const desktopZone = desktop.height - (desktop.board.y + desktop.board.height)
    const mobileZone = mobile.height - (mobile.board.y + mobile.board.height)
    expect(mobileZone / mobile.height).toBeGreaterThan(desktopZone / desktop.height)
    expect(mobile.topBarHeight).toBeLessThan(desktop.topBarHeight)
  })

  it('手机档把对手那排的上半截塞到面板行后面，只露 68', () => {
    /*
     * 桌面档是靠不透明顶栏压住上半截（每张露约 72），手机档改成靠面板行盖。
     * 露出来的那一条就是面板行下沿到战场上沿之间的距离，必须正好是 FOE_ZONE。
     */
    const panelBottom = mobile.panels.theirs.y + mobile.panels.theirs.height
    expect(mobile.board.y - panelBottom).toBe(68)
    // 藏起来的那一截是面板行盖的、不是顶栏：锚点还落在顶栏下沿以下。
    expect(mobile.foeHand.y).toBeGreaterThanOrEqual(mobile.topBarHeight)
    expect(mobile.foeHand.y).toBe(mobile.board.y - CARD_HEIGHT * FOE_FAN_SCALE)
  })

  it('放大查看在触屏档放得更大', () => {
    expect(mobile.revealScale).toBeGreaterThan(desktop.revealScale)
  })
})

describe('手机档在矮视口里整块缩小', () => {
  /*
   * 缩到底那一档的虚拟高：顶栏 56 + 面板行 96 + 对手手牌条 68 + 战场最小高 166.5
   * + 出牌区让出的一张卡 225 × 1.3 = 292.5，合计 679。
   *
   * 这是**手牌满尺寸**（handScale 到 1，只有虚拟宽过 1000 才会）时的预算；手牌区再大也
   * 大不过这一档，所以虚拟高一到 679 战场必定摆得下。横过来的手机和矮窗口都是宽的那一头，
   * 虚拟宽远超 1000，于是正好停在 679 上。
   */
  const FULL_HAND_MIN_HEIGHT = 56 + 96 + 68 + MIN_BOARD_HEIGHT + CARD_HEIGHT * 1.3

  it('679 这个数是上面几项加出来的', () => {
    expect(MIN_BOARD_HEIGHT).toBe(166.5)
    expect(FULL_HAND_MIN_HEIGHT).toBe(679)
  })

  it('竖屏手机够高，一个像素都不缩', () => {
    const layout = mobileLayout(MOBILE.width, MOBILE.height)
    expect(layout.stage).toEqual({ scale: 1, x: 0, y: 0 })
    expect(layout.width).toBe(MOBILE.width)
    expect(layout.height).toBe(MOBILE.height)
    // 844 高上手牌区就是 0.36h = 303.84（卡高那条只要 160.875，压不过它）。
    expect(layout.height - layout.returnZone.y).toBeCloseTo(303.84, 6)
    expect(layout.board.height).toBeCloseTo(320.16, 6)
  })

  describe.each([
    ['横过来的手机 844×390', 844, 390],
    ['拉矮的窗口 1790×655', 1790, 655],
  ])('%s', (_name, viewWidth, viewHeight) => {
    const layout = mobileLayout(viewWidth, viewHeight)

    it('缩到虚拟高正好 679，战场恰好是最小档', () => {
      expect(layout.stage.scale).toBeCloseTo(viewHeight / FULL_HAND_MIN_HEIGHT, 6)
      expect(layout.stage.x).toBe(0)
      expect(layout.stage.y).toBe(0)
      expect(layout.height).toBeCloseTo(FULL_HAND_MIN_HEIGHT, 6)
      // 只缩到刚好装下，不多缩：战场正好压在下限上，再多缩一点就是白白浪费地方。
      expect(layout.board.height).toBeCloseTo(MIN_BOARD_HEIGHT, 6)
      expect(layout.board.scale).toBeCloseTo(0.45, 6)
    })

    it('乘回缩放正好铺满视口，四周没有黑边', () => {
      expect(layout.viewport).toEqual({ width: viewWidth, height: viewHeight })
      expect(layout.width * layout.stage.scale).toBeCloseTo(viewWidth, 6)
      expect(layout.height * layout.stage.scale).toBeCloseTo(viewHeight, 6)
    })

    it('落点区下沿盖得住战场下沿', () => {
      const boardBottom = layout.board.y + layout.board.height
      expect(layout.dropZone.y + layout.dropZone.height).toBeGreaterThanOrEqual(boardBottom)
      // 手牌区跟着卡高走，两条下沿在这两组视口上正好重合（0.36h 比卡高那条小）。
      expect(layout.dropZone.y + layout.dropZone.height).toBeCloseTo(boardBottom, 6)
      expect(boardBottom).toBeCloseTo(386.5, 6)
    })
  })

  it('700×600 只缩这一点点，不是一律缩到 679', () => {
    /*
     * 窄而矮的鼠标窗口（700 < 768，走手机档）。虚拟宽只有七百出头，卡高那条算出来两百上下，
     * 压不过手牌区下限 220，于是预算是 220（顶栏面板对手条合计 220）+ 220 + 166.5 = 606.5。
     * 二分找到的就是这个 606.5 而不是 679——这正是二分比「一律按 679 缩」强的地方：
     * 不多缩，而且跨过阈值时缩放是连续变化的。
     */
    const layout = mobileLayout(700, 600)
    expect(layout.stage.scale).toBeCloseTo(600 / 606.5, 6)
    expect(layout.height).toBeCloseTo(606.5, 6)
    expect(layout.board.height).toBeCloseTo(MIN_BOARD_HEIGHT, 6)
  })

  it('宽屏装得下时不缩，但手牌区跟着卡高走', () => {
    /*
     * 横屏平板 1024×768：高度够，stage 仍是恒等变换。手牌满尺寸，出牌区要让出
     * 225 × 1.3 = 292.5，比 0.36 × 768 = 276.48 大——手牌区取大的那个，
     * 否则落点区下沿会爬到战场下沿上面去，我方那一排格子就没有落点。
     */
    const layout = mobileLayout(1024, 768)
    expect(layout.stage).toEqual({ scale: 1, x: 0, y: 0 })
    expect(layout.hand.scale).toBe(1)
    expect(layout.height - layout.returnZone.y).toBeCloseTo(292.5, 6)
    expect(layout.dropZone.y + layout.dropZone.height).toBeGreaterThanOrEqual(
      layout.board.y + layout.board.height,
    )
  })
})

describe.each([
  ['桌面档', desktopLayout(DESKTOP.width, DESKTOP.height)],
  ['手机档', mobileLayout(MOBILE.width, MOBILE.height)],
  ['手机档横屏 844×390', mobileLayout(844, 390)],
  ['手机档矮窗口 1790×655', mobileLayout(1790, 655)],
])('%s 的几何', (_name, layout) => {
  it('手牌不压到战场', () => {
    expect(layout.board.y + layout.board.height).toBeLessThanOrEqual(fanTop(layout))
  })

  it('出牌区的下沿和手牌锚点拉开至少 0.75 张卡', () => {
    // 鼠标拖拽时指针停在卡的底边上，整张牌画在它上方；贴着手牌的话玩家得把指针一路抬进
    // 战场里面才算数，而那时牌早就顶出屏幕上沿了。两档各自的让位见各自的 DROP_GAP_CARDS。
    const gap = layout.hand.y - (layout.dropZone.y + layout.dropZone.height)
    expect(gap).toBeGreaterThanOrEqual(CARD_HEIGHT * layout.hand.scale * 0.75)
  })

  it('出牌区盖得住整个战场，下沿也盖得住', () => {
    // 下沿这条是新加的：我方那一排贴着战场下沿，盖不住就等于「打到自己这排打不出去」。
    expect(layout.dropZone.y).toBeLessThanOrEqual(layout.board.y)
    expect(layout.dropZone.y + layout.dropZone.height).toBeGreaterThanOrEqual(
      layout.board.y + layout.board.height,
    )
    expect(layout.dropZone.x).toBeLessThanOrEqual(layout.board.x)
    expect(layout.dropZone.x + layout.dropZone.width).toBeGreaterThanOrEqual(
      layout.board.x + layout.board.width,
    )
  })

  it('各块都在舞台里', () => {
    expect(layout.board.x).toBeGreaterThanOrEqual(0)
    expect(layout.board.x + layout.board.width).toBeLessThanOrEqual(layout.width)
    expect(layout.board.height).toBeGreaterThan(0)
    expect(layout.deck.x).toBeGreaterThan(0)
    expect(layout.deck.x).toBeLessThan(layout.width)
    expect(layout.endPlay.x + layout.endPlay.width).toBeLessThanOrEqual(layout.width)
    expect(layout.endPlay.y + layout.endPlay.height).toBeLessThanOrEqual(layout.height)
  })

  it('战场在顶栏下面，不被它盖住', () => {
    expect(layout.board.y).toBeGreaterThanOrEqual(layout.topBarHeight)
  })

  it('对手那排牌的下沿不越过战场上沿', () => {
    /*
     * 对手那排画在战场**上面**（图层顺序见 parts.ts 的 makeLayers），越线就是卡背直接盖住
     * 对手那一排格子——横屏缩到最小战场时整排会被盖没，对手打出来的牌一张都看不见。
     * 整排的高是 CARD_HEIGHT × FOE_FAN_SCALE = 144：桌面档锚点在舞台顶边、上半截压在顶栏底下，
     * 手机档锚点上移到「战场上沿往上一整排」、上半截压在面板行底下，两档都靠这一条兜着。
     */
    expect(layout.foeHand.y + CARD_HEIGHT * FOE_FAN_SCALE).toBeLessThanOrEqual(layout.board.y)
  })
})
