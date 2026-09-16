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
 */

import { describe, expect, it } from 'vitest'
import { CARD_HEIGHT, PLAYER_FAN } from '../src/layout/fanMath'
import { desktopLayout } from '../src/scenes/duel/layout/desktopLayout'
import { mobileLayout } from '../src/scenes/duel/layout/mobileLayout'
import { pickLayout, pickTier, TOUCH_BREAKPOINT } from '../src/scenes/duel/layout/pickLayout'
import type { DuelLayout } from '../src/scenes/duel/layout/types'

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
     * 2026-09-16 的回归：短边判据把 1790×655 这种矮窗口判进手机档，而手机档不缩放，
     * 顶栏加面板行加对手手牌条加手牌区在 655 高上把战场挤剩一百多像素、落点区更是空的，
     * 于是牌拖上去怎么松手都回弹——用户看到的就是「打不出牌」。
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

  it('手机档不缩放整块舞台，桌面档缩', () => {
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

  it('放大查看在触屏档放得更大', () => {
    expect(mobile.revealScale).toBeGreaterThan(desktop.revealScale)
  })
})

describe.each([
  ['桌面档', desktopLayout(DESKTOP.width, DESKTOP.height)],
  ['手机档', mobileLayout(MOBILE.width, MOBILE.height)],
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
})
