/**
 * 房间页版式。和首页那份一样**只输出数、不碰任何 Pixi 对象**。
 *
 * 单独成文件是为了让端到端用例算得出按钮落点：房间页整页画在画布上，DOM 里没有按钮，
 * 用例只能按坐标点。从前 `client/e2e/roomPage.ts` 是**抄了一份**面板几何常量，
 * 场景这边一改版式那边就点空；现在改成两头调同一个函数（和首页 `pickHomeLayout` 同一个做法）。
 *
 * 返回的全是**视口坐标**，不是面板内的相对坐标：用例拿到就能点，
 * 场景这边也省掉「把整块面板居中」那一步。
 */

/** 一块矩形，视口坐标，原点在左上角。 */
export interface RoomRect {
  x: number
  y: number
  width: number
  height: number
}

/** 面板想要多大，以及最少要留多少边。窄屏上按视口缩，但不缩到放不下按钮。 */
const PANEL = { width: 560, height: 400, margin: 32, minWidth: 340, minHeight: 200 }

/** 面板里从上往下那几行：行高、行距、第一行离面板顶边多远。 */
const ROW = { height: 36, gap: 8, top: 20 }

/** 按钮那一摞：尺寸、上下间距、左右间距、离面板底边多远。 */
const BUTTON = { width: 160, height: 44, gapY: 12, gapX: 16, bottom: 24 }

/** 提示那一条：挂在面板下面多远，多高。 */
const NOTICE = { gap: 16, height: 36 }

export interface RoomLayout {
  /** 面板本身。它现在只是一块描边方块，但仍然是别的东西定位的基准。 */
  panel: RoomRect
  /** 从上往下四行。哪几行真的画出来由状态决定，摆不摆都占这个位置。 */
  title: RoomRect
  account: RoomRect
  code: RoomRect
  status: RoomRect
  /** 按钮的落点，顺序和 `roomButtons()` 给的一致。 */
  buttons: RoomRect[]
  /** 提示那一条，在面板外面下方。 */
  notice: RoomRect
}

/**
 * 算一份版式。
 *
 * `buttonCount` 而不是整份状态：这个函数只关心「摆几颗」——一颗居中、两颗并排、
 * 三颗竖排（三颗并排要 512 宽加间距，比面板还宽；而且竖排时「匹配」在最上面，
 * 一眼就看得到主路）。哪几颗、印什么字是 `roomButtons()` 和面板自己的事。
 */
export function pickRoomLayout(width: number, height: number, buttonCount: number): RoomLayout {
  const panelWidth = Math.max(PANEL.minWidth, Math.min(PANEL.width, width - PANEL.margin * 2))
  const panelHeight = Math.max(PANEL.minHeight, Math.min(PANEL.height, height - PANEL.margin * 2))
  const panel = {
    x: (width - panelWidth) / 2,
    y: (height - panelHeight) / 2,
    width: panelWidth,
    height: panelHeight,
  }

  const rowWidth = panelWidth - PANEL.margin * 2
  const rowX = panel.x + PANEL.margin
  const rowAt = (index: number): RoomRect => ({
    x: rowX,
    y: panel.y + ROW.top + index * (ROW.height + ROW.gap),
    width: rowWidth,
    height: ROW.height,
  })

  return {
    panel,
    title: rowAt(0),
    account: rowAt(1),
    code: rowAt(2),
    status: rowAt(3),
    buttons: buttonSpots(panel, buttonCount),
    notice: {
      x: rowX,
      y: panel.y + panel.height + NOTICE.gap,
      width: rowWidth,
      height: NOTICE.height,
    },
  }
}

function buttonSpots(panel: RoomRect, count: number): RoomRect[] {
  const bottom = panel.y + panel.height - BUTTON.bottom
  const spots: RoomRect[] = []

  if (count > 2) {
    let y = bottom - count * BUTTON.height - (count - 1) * BUTTON.gapY
    for (let index = 0; index < count; index += 1) {
      spots.push({
        x: panel.x + (panel.width - BUTTON.width) / 2,
        y,
        width: BUTTON.width,
        height: BUTTON.height,
      })
      y += BUTTON.height + BUTTON.gapY
    }
    return spots
  }

  const total = count * BUTTON.width + Math.max(0, count - 1) * BUTTON.gapX
  let x = panel.x + (panel.width - total) / 2
  for (let index = 0; index < count; index += 1) {
    spots.push({ x, y: bottom - BUTTON.height, width: BUTTON.width, height: BUTTON.height })
    x += BUTTON.width + BUTTON.gapX
  }
  return spots
}
