/**
 * 构筑页的零件表：建出全部组件、分好层，并按版式把它们摆到位。
 *
 * 只做「摆」这一件事，不认识牌组也不认识指针——谁在什么状态下显示什么归 render.ts，
 * 指针那一串归 input.ts。拆出来是因为「有哪些组件、它们叠在第几层」
 * 是读这个场景时第一个要回答的问题（同对局场景的 parts.ts）。
 *
 * 正式版简化第 4 步之四之后，界面那一层全是素方块（见 components/Box.ts）：
 * 外框、页签、提示条、进度条、按钮都是这里直接建的 `Box`，不再各有一个带底图和配色的组件。
 * 整页也不再垫一块纸底——渲染器的清屏色就是那块底，垫一层等于凭空多一次满屏绘制（3.2）。
 *
 * 层序（自下而上）：
 *   pool      卡池外框、筛选、提示、滚动条
 *   poolCards 卡池格子（滚动那一档被遮罩裁在窗口里）
 *   side      牌组栏（手机档是抽屉）、卡位、确认钮
 *   drag      正被拖着的那一张
 *   overlay   顶栏、放大查看（弹窗 B）和它右边那张背面大卡
 */

import { Container, Graphics } from 'pixi.js'
import { Box, type BoxDeps } from '../../components/Box'
import { DeckSlots } from '../../components/DeckSlots'
import { PoolCell } from '../../components/PoolCell'
import { RevealOverlay } from '../../components/RevealOverlay'
import { cellCount } from '../../layout/gridMath'
import type { DuelDeps } from '../duel/deps'
import { BoxTabs } from './boxTabs'
import type { DeckLayout } from './layout/types'
import { applyDeckLayout } from './partsLayout'
import {
  BACK,
  type DeckLayers,
  type DeckParts,
  DRAWER_WIDTH,
  MANAGE_WIDTH,
  NEW_DECK_WIDTH,
  PAGER_BUTTON,
  TIP,
  TITLE,
  TITLE_BOX,
  ZOOM_ACTION,
  ZOOM_ANCHOR_Y,
  ZOOM_FRONT_X,
} from './partsSpec'
import { ScrollBar } from './scrollBar'
import { GAP_SHIFT_DUR } from './timings'

export interface DeckPartsOptions {
  stage: Container
  deps: DuelDeps
  layout: DeckLayout
  /** 卡池一共几张牌。滚动那一档按它算内容有多高，也按它兜住格子数。 */
  poolSize: number
  onBack?: () => void
  onConfirm?: () => void
  onKind: (id: string) => void
  onFaction: (id: string) => void
  onDeck: (id: string) => void
  onNewDeck: () => void
  onRename: () => void
  onDelete: () => void
  onRemoveAt: (index: number) => void
  /** 手机档：点了抽屉把手。 */
  onDrawer: () => void
  onPage: (delta: number) => void
  /** 点了卡池第 index 格的「＋」（格子的序号，不是卡池的序号，见 PoolCell.poolIndex）。 */
  onAddAt: (index: number) => void
  /** 放大查看那一行的两颗钮。 */
  onZoomAdd: () => void
  onZoomClose: () => void
}

function makeLayers(stage: Container): DeckLayers {
  const layers: DeckLayers = {
    pool: new Container(),
    poolCards: new Container(),
    side: new Container(),
    drag: new Container(),
    overlay: new Container(),
  }
  stage.addChild(layers.pool, layers.poolCards, layers.side, layers.drag, layers.overlay)
  return layers
}

/** 一块只画描边、不吃事件的方块。两块外框都是它。 */
function frameBox(
  rect: { x: number; y: number; width: number; height: number },
  deps: BoxDeps,
): Box {
  const box = new Box({ width: rect.width, height: rect.height }, deps)
  box.position.set(rect.x, rect.y)
  box.eventMode = 'none'
  return box
}

/** 一颗按钮。名字（`label`）是交互测试和 bench 找命中点的依据。 */
function button(
  size: { width: number; height: number },
  caption: string,
  name: string,
  onPress: () => void,
  deps: BoxDeps,
): Box {
  const box = new Box({ ...size, label: caption }, deps)
  box.onPress(onPress)
  box.label = name
  return box
}

export function createDeckParts(options: DeckPartsOptions): DeckParts {
  const { deps, layout } = options
  const layers = makeLayers(options.stage)

  const back = button(BACK, '返回', 'button:deck-back', () => options.onBack?.(), deps)
  const title = new Box({ ...TITLE_BOX, label: TITLE, size: 'title' }, deps)
  title.eventMode = 'none'

  const pool = frameBox(layout.pool, deps)
  const kindTabs = new BoxTabs({ height: 26, onSelect: options.onKind }, deps)
  const factionTabs = new BoxTabs({ height: 24, onSelect: options.onFaction }, deps)
  const poolHint = new Box(
    { width: layout.poolHint.width, height: layout.poolHint.height, size: 'small' },
    deps,
  )
  poolHint.eventMode = 'none'

  const pager =
    layout.pager === null
      ? null
      : {
          prev: button(PAGER_BUTTON, '上一页', 'button:deck-prev', () => options.onPage(-1), deps),
          next: button(PAGER_BUTTON, '下一页', 'button:deck-next', () => options.onPage(1), deps),
          label: new Box({ width: 80, height: PAGER_BUTTON.height, size: 'small' }, deps),
        }
  if (pager !== null) pager.label.eventMode = 'none'

  /*
   * 建几个格子：滚动那一档按「窗口里同时摆得下几格」建（版式已经算好，含露头那一行），
   * 但卡池比那还少时不用建满——目录页那份假卡池只有六张。
   */
  const cellTarget =
    layout.poolScroll === null
      ? cellCount(layout.poolGrid)
      : Math.min(cellCount(layout.poolGrid), Math.max(1, options.poolSize))
  const poolCells: PoolCell[] = []
  for (let index = 0; index < cellTarget; index += 1) {
    const cell = new PoolCell(
      {
        width: layout.poolGrid.cellWidth,
        height: layout.poolGrid.cellHeight,
        cardScale: layout.poolCardScale,
        onAdd: () => options.onAddAt(index),
      },
      deps,
    )
    cell.visible = false
    poolCells.push(cell)
  }
  /*
   * 卡池那一刀。遮罩走 Graphics 而不是 Sprite：Pixi 按遮罩对象的类型挑实现，
   * Graphics 只写模板缓冲，不产生离屏渲染（纪律 3.1，同 RevealOverlay 的顶栏裁剪）。
   */
  const poolClip = layout.poolScroll === null ? null : new Graphics()
  const poolBar = layout.poolScroll === null ? null : new ScrollBar(layout.poolScroll.bar, deps)

  const side = frameBox(layout.side, deps)
  const deckTabs = new BoxTabs({ height: layout.tabs.height, onSelect: options.onDeck }, deps)
  const newDeck = button(
    { width: NEW_DECK_WIDTH, height: layout.tabs.height },
    '＋ 新建',
    'button:deck-new',
    options.onNewDeck,
    deps,
  )
  const manageSize = { width: MANAGE_WIDTH, height: 26 }
  const rename = button(manageSize, '改名', 'button:deck-rename', options.onRename, deps)
  const remove = button(manageSize, '删除', 'button:deck-delete', options.onDelete, deps)
  const drawerHandle = button(
    { width: DRAWER_WIDTH, height: 26 },
    '牌组',
    'button:deck-drawer',
    options.onDrawer,
    deps,
  )
  drawerHandle.visible = layout.drawer !== null
  const tally = new Box({ width: 240, height: 24, align: 'left', size: 'small' }, deps)
  tally.eventMode = 'none'
  const progress = {
    track: new Box({ width: layout.progress.width, height: layout.progress.height }, deps),
    fill: new Box({ width: 1, height: Math.max(1, layout.progress.height - 4) }, deps),
  }
  progress.track.eventMode = 'none'
  progress.fill.eventMode = 'none'
  const slots = new DeckSlots(
    {
      grid: layout.slots,
      cardScale: layout.slotCardScale,
      view: layout.slotScroll?.view ?? null,
      shiftDur: GAP_SHIFT_DUR,
      onRemove: options.onRemoveAt,
    },
    deps,
  )
  const slotBar = layout.slotScroll === null ? null : new ScrollBar(layout.slotScroll.bar, deps)
  const sideHint = new Box(
    { width: layout.sideHint.width, height: layout.sideHint.height, size: 'small' },
    deps,
  )
  sideHint.eventMode = 'none'
  const confirm = button(
    { width: layout.side.width / 2, height: 44 },
    '确认牌组',
    'button:deck-confirm',
    () => options.onConfirm?.(),
    deps,
  )

  /*
   * 放大查看：正面那张飞到舞台的 39% / 46% 处（黑客松 `.deck-page .reveal-card` 的两个百分比），
   * 右边 61% 处摆一张同尺寸的背面大卡。两张并排是这一页独有的——对局页那一份摆正中。
   */
  const reveal = new RevealOverlay(
    { scale: layout.revealScale, anchorX: ZOOM_FRONT_X, anchorY: ZOOM_ANCHOR_Y },
    deps,
  )
  const zoomSide = new Container()
  zoomSide.visible = false
  const zoomActions = {
    add: button(ZOOM_ACTION, '加入牌组', 'button:deck-zoom-add', options.onZoomAdd, deps),
    close: button(ZOOM_ACTION, '关闭', 'button:deck-zoom-close', options.onZoomClose, deps),
  }
  zoomSide.addChild(zoomActions.add, zoomActions.close)

  layers.pool.addChild(pool, kindTabs, factionTabs, poolHint)
  if (pager !== null) layers.pool.addChild(pager.prev, pager.next, pager.label)
  if (poolBar !== null) layers.pool.addChild(poolBar)
  layers.poolCards.addChild(...poolCells)
  if (poolClip !== null) {
    layers.poolCards.addChild(poolClip)
    layers.poolCards.mask = poolClip
  }
  layers.side.addChild(
    side,
    deckTabs,
    newDeck,
    rename,
    remove,
    drawerHandle,
    tally,
    progress.track,
    progress.fill,
    slots,
    sideHint,
    confirm,
  )
  if (slotBar !== null) layers.side.addChild(slotBar)
  const tip = new Box({ width: TIP.width, height: TIP.height, size: 'small' }, deps)
  tip.eventMode = 'none'
  tip.visible = false
  layers.drag.addChild(tip)
  layers.overlay.addChild(back, title, reveal, zoomSide)

  const parts: DeckParts = {
    layers,
    back,
    title,
    pool,
    kindTabs,
    factionTabs,
    poolCells,
    poolClip,
    poolBar,
    poolHint,
    pager,
    side,
    deckTabs,
    newDeck,
    drawerHandle,
    rename,
    remove,
    tally,
    progress,
    slots,
    slotBar,
    sideHint,
    confirm,
    tip,
    reveal,
    zoomSide,
    zoomActions,
  }
  applyDeckLayout(parts, layout)
  return parts
}

export type { DeckParts } from './partsSpec'
