/**
 * 手机档版式：竖着排一列——顶栏、折叠成一行的两块玩家面板、对手手牌（上半截塞在面板行
 * 后面，见下面 `foeHand` 那段）、战场、我方手牌。
 *
 * 这一档按**真实视口**实算，平时不缩放：算出来的就是视口坐标，`stage` 是恒等变换、
 * `viewport` 就是 `width × height`。只有一种例外——视口矮到战场连最小一档的格子都摆不下时，
 * 整块等比缩小一次（见 `stageScaleFor`），那时 `width / height` 是缩放前的虚拟尺寸。
 *
 * 和桌面档的缩放不是一回事：那边是 1672×941 的死版式，**永远**要缩一次才放得进视口
 *（见 desktopLayout 的文件头）；这边是照视口排的活版式，缩只是矮视口下的兜底，
 * 普通竖屏手机一个像素都不缩。
 *
 * 和桌面档并列，三处真的分岔（需求第 3 条，不是缩放）：
 * 1. **侧栏折叠成顶栏下面一行**：竖着的侧栏在 390 宽的屏幕上要吃掉一半宽，
 *    剩下的地方摆不下战场。折叠之后「下一题」纸匾和 Token 细条一起去掉——
 *    它们是竖排才有位置的东西，横过来会把两块面板挤扁。
 * 2. **战场整块缩小**：格子是 110×165 的死数，一排五格要 616 宽，390 的屏上装不下。
 *    缩的是格子尺寸这一档，不是把桌面版按比例缩到手机上。
 * 3. **手牌区更高**：手指要有地方按住牌往上拖，而拖起来的牌还要抬到手指上方半张卡高
 *   （见 handPointer 的 lift），底下留 250 不够。
 */

import { tokens } from '@ai-duel/design'
import { CARD_HEIGHT, CARD_WIDTH } from '../../../layout/fanMath'
import {
  clamp,
  DESIGN_FAN_WIDTH,
  type DuelLayout,
  END_PLAY_SIZE,
  FOE_FAN_SCALE,
  fitBoardScale,
  MIN_BOARD_HEIGHT,
  MIN_HAND_SCALE,
} from './types'

/** 各块离屏幕左右两边留多宽。 */
const PAD_X = 8

/** 折叠出来那一行的高度，以及两块面板之间的空隙。够摆下一张缩小的英雄牌加铭牌。 */
const PANEL_ROW = { height: 96, gap: 8 }

/**
 * 对手那排牌在面板行和战场之间**露出来**的那一条有多高。
 *
 * 不是整排牌的高：牌有 `CARD_HEIGHT × FOE_FAN_SCALE` = 144 高，上面那 76 塞在面板行后面
 *（为什么这么摆见下面 `foeHand` 那段）。露 68 比桌面档的 84 矮一截——
 * 手机上这排只需要说明「对面还有几张」。
 */
const FOE_ZONE = 68

/** 手牌区占屏高的比例，以及它的上下限。真正用的还要和卡高取大，见 verticalBudget。 */
const HAND_ZONE = { ratio: 0.36, min: 220, max: 340 }

/**
 * 出牌区下沿离手牌锚点留多少张卡高。
 *
 * 比桌面档多留一截：触屏拖拽时牌会被抬到手指上方半张卡高（见 handPointer 的 lift），
 * 判定用的指针位置比玩家看到的牌低一截，出牌区下沿要跟着往上挪同样多，
 * 否则「牌明明还在手牌区里」就已经算越线了。
 *
 * 这一截同时是手牌区高度的下限（见 verticalBudget）：让出来的地方要是比手牌区还高，
 * 出牌区下沿就爬到战场下沿上面去了。
 */
const DROP_GAP_CARDS = 1.3

/** 「结束出牌」按钮离右下角多远。 */
const END_PLAY_INSET = { x: 12, y: 10 }

/** 牌库那摞牌的缩放和它离右边多远。 */
const DECK = { scale: 0.3, inset: 0.04 }

/** 竖向预算：从舞台高里依次扣掉顶栏、面板行、对手手牌条和手牌区，剩下的给战场。 */
interface VerticalBudget {
  topBarHeight: number
  handScale: number
  handZone: number
  boardTop: number
  boardHeight: number
}

/**
 * 按一组宽高把竖着那一列的预算算出来。
 *
 * 抽成函数是因为它有两个调用方：正式排版，以及 `stageScaleFor` 判「这组宽高装不装得下」。
 * 两处必须用同一套算法，否则二分出来的缩放和真排出来的版式会对不上。
 */
function verticalBudget(width: number, height: number): VerticalBudget {
  const topBarHeight = tokens.size.battle.topbarHeightTouch
  const handScale = clamp(width / DESIGN_FAN_WIDTH, MIN_HAND_SCALE, 1)
  /*
   * 手牌区要同时满足两条，取大的那个：
   * 1. 占屏高 0.36，夹在 220…340 之间。手指按住牌往上拖要有地方按。
   * 2. 不低于「出牌区下沿离手牌锚点让出的那一截」（CARD_HEIGHT × handScale × DROP_GAP_CARDS）。
   *    出牌区下沿是 `hand.y - 这一截`，它必须**不高于**战场下沿（height − handZone），
   *    否则我方那一排格子落在出牌区外面，牌拖上去没有落点。把这一截直接当下限，
   *    「落点区盖得住战场下沿」就是由构造保证的，不用再单独去凑。
   * 宽屏上 handScale 顶到 1 时第 2 条是 292.5，而 0.36h 在矮视口上只有两百出头，
   * 那时正是第 2 条在兜底。
   */
  const handZone = Math.max(
    clamp(height * HAND_ZONE.ratio, HAND_ZONE.min, HAND_ZONE.max),
    CARD_HEIGHT * handScale * DROP_GAP_CARDS,
  )
  const boardTop = topBarHeight + PANEL_ROW.height + FOE_ZONE
  return {
    topBarHeight,
    handScale,
    handZone,
    boardTop,
    boardHeight: Math.max(0, height - boardTop - handZone),
  }
}

/**
 * 手牌按满尺寸（handScale 为 1）算时，这一列最少要多高。
 *
 * 顶栏 + 面板行 + 对手手牌条 + 战场的最小高 + 出牌区让出的那一截。手牌区再大也大不过
 * 满尺寸那一档（handScale 封顶在 1），所以**虚拟视口一旦高到这个数，战场必然摆得下**——
 * 二分的下界取它就一定落在「装得下」那一侧。
 */
const FULL_HAND_MIN_HEIGHT =
  tokens.size.battle.topbarHeightTouch +
  PANEL_ROW.height +
  FOE_ZONE +
  MIN_BOARD_HEIGHT +
  CARD_HEIGHT * DROP_GAP_CARDS

/** 二分多少次。40 次把区间收到 1e-12 以下，这点算力可以忽略。 */
const FIT_STEPS = 40

/** 这组宽高排出来的战场，够不够摆下最小一档的格子。 */
function boardFits(width: number, height: number): boolean {
  return verticalBudget(width, height).boardHeight >= MIN_BOARD_HEIGHT
}

/**
 * 整块舞台要缩到多小才排得下。返回 1 表示不用缩。
 *
 * 缩放 `s` 的含义是「按虚拟视口 `(W/s, H/s)` 排版，再整块乘回 `s`」。因为是按高度缩到正好，
 * 乘回去恰好铺满视口，四周不会出现黑边（`stage.x/y` 因此始终是 0）。
 *
 * **为什么二分而不是解方程**：预算依赖 handScale，handScale 又依赖虚拟宽 `W/s`，是循环的；
 * 闭式解要按 `clamp` 的三段和 `Math.max` 的两支分情况推，改一个 clamp 就全部失效。
 * 二分只依赖谓词，公式怎么变都不用重推。
 *
 * **下界为什么取 `H / FULL_HAND_MIN_HEIGHT`**：缩到那儿虚拟高正好是 FULL_HAND_MIN_HEIGHT，
 * 按上面的理由必定装得下。上界 1 是刚刚试过、确定装不下的那个。循环里只把 `lo` 挪到
 * 「装得下」的中点上，所以返回的 `lo` 永远在装得下那一侧——不变量是严格成立的，不靠精度。
 *
 * **谓词随 `s` 单调**（正常宽高比下）：`s` 变小让虚拟高按 `H` 的速度涨，而手牌区最多按
 * `0.36H` 或 `0.2925W` 涨，前者恒小、后者要 `W/H > 3.4` 才反超——那种又宽又扁的视口
 * 本来就什么都装不下，不值得为它把二分换成别的。
 */
function stageScaleFor(width: number, height: number): number {
  if (boardFits(width, height)) return 1
  let lo = height / FULL_HAND_MIN_HEIGHT
  let hi = 1
  for (let step = 0; step < FIT_STEPS; step += 1) {
    const mid = (lo + hi) / 2
    if (boardFits(width / mid, height / mid)) lo = mid
    else hi = mid
  }
  return lo
}

/** 右下角那一颗钮占的那块，贴着手牌区上沿。 */
function endPlayRect(
  width: number,
  height: number,
  handZone: number,
): { x: number; y: number; width: number; height: number } {
  return {
    x: width - END_PLAY_SIZE.width - END_PLAY_INSET.x,
    y: height - handZone - END_PLAY_SIZE.height - END_PLAY_INSET.y,
    width: END_PLAY_SIZE.width,
    height: END_PLAY_SIZE.height,
  }
}

export function mobileLayout(viewWidth: number, viewHeight: number): DuelLayout {
  // 装得下就是 1，除法原样返回视口尺寸，竖屏手机的几何一个数都不动。
  const stageScale = stageScaleFor(viewWidth, viewHeight)
  const width = viewWidth / stageScale
  const height = viewHeight / stageScale

  const { topBarHeight, handScale, handZone, boardTop, boardHeight } = verticalBudget(width, height)
  const panelRow = {
    x: PAD_X,
    y: topBarHeight,
    width: width - PAD_X * 2,
    height: PANEL_ROW.height,
    gap: PANEL_ROW.gap,
  }

  const boardRect = {
    x: PAD_X,
    y: boardTop,
    width: width - PAD_X * 2,
    height: boardHeight,
  }
  const boardScale = fitBoardScale(boardRect.width, boardRect.height)

  const hand = {
    x: width / 2,
    y: height,
    scale: handScale,
    areaWidth: (width * 0.94) / handScale,
  }

  const dropTop = topBarHeight + panelRow.height
  const dropBottom = hand.y - CARD_HEIGHT * handScale * DROP_GAP_CARDS
  const dropZone = {
    x: PAD_X,
    y: dropTop,
    width: width - PAD_X * 2,
    height: Math.max(0, dropBottom - dropTop),
  }

  const deckScale = DECK.scale * handScale
  const deck = {
    x: width - CARD_WIDTH * deckScale - width * DECK.inset,
    y: height - handZone * 0.35,
    scale: deckScale,
  }

  // 折叠那一行里两块面板左右平分，中间留一个空隙。上面的两档版式共用 `panels` 这一个字段。
  const panelWidth = Math.max(0, (panelRow.width - panelRow.gap) / 2)
  const panels = {
    theirs: { x: panelRow.x, y: panelRow.y, width: panelWidth, height: panelRow.height },
    mine: {
      x: panelRow.x + panelWidth + panelRow.gap,
      y: panelRow.y,
      width: panelWidth,
      height: panelRow.height,
    },
  }

  return {
    tier: 'mobile',
    width,
    height,
    viewport: { width: viewWidth, height: viewHeight },
    // 按高度缩到正好，所以乘回去正好铺满视口，左上角不用再挪（桌面档那边要居中偏移）。
    stage: { scale: stageScale, x: 0, y: 0 },
    topBarHeight,
    sideBar: null,
    panels,
    // 这一档没有「战场外框」那一圈内边距，外框和格子区是同一块。
    boardFrame: { ...boardRect },
    board: { ...boardRect, scale: boardScale },
    // 落点提示、Token 细条贴边、两块吊匾都是竖排才摆得下的东西，这一档一律没有。
    dropCue: null,
    // 手机档手牌区更高（HAND_ZONE 那一档），取消区跟着它走。
    returnZone: { x: 0, y: height - handZone, width, height: handZone },
    tokenRail: null,
    nextPlaque: null,
    turnPlaque: null,
    /*
     * 对手那排：锚点往上挪一整排牌高（`CARD_HEIGHT × FOE_FAN_SCALE` = 144），
     * 牌的**下沿正好压在战场上沿**，上面那 76 塞进面板行（56…152）后面，
     * 露出来的正好是 FOE_ZONE 那 68。
     *
     * 原先锚点摆在面板行下沿（152），牌一路垂到 296，而战场上沿是 220——整排压进战场 76。
     * 竖屏 390×844 上战场矩形还有 47.7 的上边距吸收了大半，只盖住对手那排格子顶上 28
     *（正好是费用角标那一带）；横屏缩到最小战场（166.5，格子填满、没有边距）之后，
     * 对手整排格子 220…294 被卡背全部盖住，而 `layers.foeHand` 画在 `layers.board` 上面
     *（图层顺序见 parts.ts 的 `makeLayers` 里 `world.addChild` 那一行），
     * 于是对手打出来的牌一张都看不见。
     *
     * 靠面板盖住而不是加遮罩：桌面档也是这个手法（那边靠不透明顶栏压住上半截，
     * 见 desktopLayout 里 foeHand 那段），而遮罩会和展示层、结算层那两处嵌套起来，
     * 模板缓冲的嵌套在各后端上表现不一致（理由写在 stageFrame.ts 的文件头）。
     * `layers.chrome`（顶栏和两块面板）画在 `layers.foeHand` 上面，面板又是不透明的 `Box`
     *（不开 `transparent` 就铺底色，见 Box.ts），盖得住。
     * 两块面板中间那 8px 的缝和左右各 8px 的内边距会露出一线卡背——接受：
     * 看着就像牌插在面板后面，不再另外遮。
     */
    foeHand: {
      x: width / 2,
      y: boardTop - CARD_HEIGHT * FOE_FAN_SCALE,
      areaWidth: (width * 0.9) / FOE_FAN_SCALE,
    },
    hand,
    dropZone,
    deck,
    endPlay: endPlayRect(width, height, handZone),
    // 触屏档放大得更多：1.7 倍在手机上只有约 126 个屏幕像素宽，和「点开看清楚」差得远。
    revealScale: tokens.size.card.revealScaleTouch,
    revealScaleHero: tokens.size.card.revealScaleHeroTouch,
    banner: { x: width / 2, y: height * 0.24 },
    bubble: { x: width / 2, y: height - handZone - 20 },
  }
}
