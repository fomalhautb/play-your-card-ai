/**
 * 构筑页的零件表：建出全部组件、分好层，并按版式把它们摆到位。
 *
 * 只做「摆」这一件事，不认识牌组也不认识指针——谁在什么状态下显示什么归 render.ts，
 * 指针那一串归 input.ts。拆出来是因为「有哪些组件、它们叠在第几层」
 * 是读这个场景时第一个要回答的问题（同对局场景的 parts.ts）。
 *
 * 层序（自下而上）：
 *   page      整页纸底
 *   pool      卡池底板、头部页签、卡、翻页
 *   side      牌组栏（手机档是抽屉）、卡位、确认钮
 *   drag      正被拖着的那一张
 *   overlay   放大查看（弹窗 B）
 */

import { tokens } from '@ai-duel/design'
import { Container } from 'pixi.js'
import { DeckSlots } from '../../components/DeckSlots'
import { HintBar } from '../../components/HintBar'
import { Label } from '../../components/Label'
import { Panel } from '../../components/Panel'
import { PLAQUE_NAVY, PlaqueButton } from '../../components/PlaqueButton'
import { PoolCell } from '../../components/PoolCell'
import { ProgressBar } from '../../components/ProgressBar'
import { RevealOverlay } from '../../components/RevealOverlay'
import { SmallButton } from '../../components/SmallButton'
import { Tabs } from '../../components/Tabs'
import { cellCount, cellRect } from '../../layout/gridMath'
import type { DuelDeps } from '../duel/deps'
import type { DeckLayout } from './layout/types'

/** 页头那两行字的字号字距。组件私有，不进令牌（同别处的理由）。 */
const TITLE_TYPE = { fontSize: 22, letterSpacing: 4, weight: '600', align: 'left' } as const
const TALLY_TYPE = { fontSize: 15, letterSpacing: 1.5, weight: '600', align: 'left' } as const
const PAGER_TYPE = { fontSize: 13, letterSpacing: 1.3 } as const

/** 页头标题。写死在这里而不是由调用方给：这一页只有这一个身份。 */
const TITLE = '组建牌组'
/** 返回钮和标题之间留多宽。 */
const TITLE_GAP = 20

interface DeckLayers {
  page: Container
  pool: Container
  poolCards: Container
  side: Container
  drag: Container
  overlay: Container
}

export interface DeckParts {
  layers: DeckLayers
  /** 整页纸底（面板 A）。 */
  page: Panel
  back: SmallButton
  title: Label
  /** 夜色卡池底板（面板 D）。 */
  pool: Panel
  /** 种类页签（标签页 B）和阵营药丸（标签页 C）。 */
  kindTabs: Tabs
  factionTabs: Tabs
  /**
   * 卡池那一页的格子。**长住**——翻页只换里面那张卡，格子本身一次都不重建。
   * 它的长度就是这一档版式一页几格（桌面 8、手机 6）。
   */
  poolCells: PoolCell[]
  poolHint: HintBar
  prevPage: SmallButton
  nextPage: SmallButton
  pageLabel: Label
  /** 牌组栏底板（面板 B 的构筑档）。 */
  side: Panel
  /** 牌组页签（标签页 A）和末尾那颗虚线「新建」。 */
  deckTabs: Tabs
  newDeck: SmallButton
  /**
   * 手机档抽屉的把手。桌面档也建但**藏着**——两档的零件表保持一样，
   * 省掉一路 `null` 判断；藏起来的那颗一次都不会被点到。
   */
  drawerHandle: SmallButton
  rename: SmallButton
  remove: SmallButton
  tally: Label
  progress: ProgressBar
  slots: DeckSlots
  sideHint: HintBar
  confirm: PlaqueButton
  reveal: RevealOverlay
}

export interface DeckPartsOptions {
  stage: Container
  deps: DuelDeps
  layout: DeckLayout
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
  /** 点了卡池第 index 格的「＋」。 */
  onAddAt: (index: number) => void
}

function makeLayers(stage: Container): DeckLayers {
  const layers: DeckLayers = {
    page: new Container(),
    pool: new Container(),
    poolCards: new Container(),
    side: new Container(),
    drag: new Container(),
    overlay: new Container(),
  }
  stage.addChild(
    layers.page,
    layers.pool,
    layers.poolCards,
    layers.side,
    layers.drag,
    layers.overlay,
  )
  // 纸底只是背景，吃了指针事件上面的卡就点不着了。
  layers.page.eventMode = 'none'
  return layers
}

export function createDeckParts(options: DeckPartsOptions): DeckParts {
  const { deps, layout } = options
  const layers = makeLayers(options.stage)

  const page = new Panel({ variant: 'A', width: layout.width, height: layout.height })
  const back = new SmallButton(
    { variant: 'H', caption: '返回', ink: tokens.color.paper.ink, onActivate: options.onBack },
    deps,
  )
  back.label = 'button:deck-back'
  const title = new Label(TITLE, TITLE_TYPE, deps, tokens.color.paper.ink)

  const pool = new Panel({ variant: 'D', width: layout.pool.width, height: layout.pool.height })
  const kindTabs = new Tabs({ variant: 'B', onSelect: options.onKind }, deps)
  const factionTabs = new Tabs({ variant: 'C', onSelect: options.onFaction }, deps)
  const poolHint = new HintBar(
    { width: layout.poolHint.width, height: layout.poolHint.height, tone: 'dark' },
    deps,
  )
  const prevPage = new SmallButton(
    {
      variant: 'L',
      caption: '上一页',
      ink: tokens.color.deck.chipInk,
      onActivate: () => options.onPage(-1),
    },
    deps,
  )
  prevPage.label = 'button:deck-prev'
  const nextPage = new SmallButton(
    {
      variant: 'L',
      caption: '下一页',
      ink: tokens.color.deck.chipInk,
      onActivate: () => options.onPage(1),
    },
    deps,
  )
  nextPage.label = 'button:deck-next'
  const pageLabel = new Label('', PAGER_TYPE, deps, tokens.color.deck.chipInk)

  const poolCells: PoolCell[] = []
  for (let index = 0; index < cellCount(layout.poolGrid); index += 1) {
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

  const side = new Panel({
    variant: 'B',
    tone: 'deck',
    width: layout.side.width,
    height: layout.side.height,
  })
  const deckTabs = new Tabs({ variant: 'A', onSelect: options.onDeck }, deps)
  const newDeck = new SmallButton(
    { variant: 'L', caption: '＋ 新建', dashed: true, onActivate: options.onNewDeck },
    deps,
  )
  newDeck.label = 'button:deck-new'
  const rename = new SmallButton(
    { variant: 'L', caption: '改名', onActivate: options.onRename },
    deps,
  )
  rename.label = 'button:deck-rename'
  const remove = new SmallButton(
    { variant: 'L', caption: '删除', onActivate: options.onDelete },
    deps,
  )
  remove.label = 'button:deck-delete'
  const drawerHandle = new SmallButton(
    { variant: 'L', caption: '牌组', onActivate: options.onDrawer },
    deps,
  )
  drawerHandle.label = 'button:deck-drawer'
  drawerHandle.visible = layout.drawer !== null
  const tally = new Label('', TALLY_TYPE, deps, tokens.color.paper.ink)
  const progress = new ProgressBar({ width: layout.progress.width })
  const slots = new DeckSlots(
    { grid: layout.slots, cardScale: layout.slotCardScale, onRemove: options.onRemoveAt },
    deps,
  )
  const sideHint = new HintBar(
    { width: layout.sideHint.width, height: layout.sideHint.height, tone: 'paper' },
    deps,
  )
  const confirm = new PlaqueButton(
    { variant: PLAQUE_NAVY, caption: '确认牌组', size: 'endTurn', onActivate: options.onConfirm },
    deps,
  )
  confirm.label = 'button:deck-confirm'

  const reveal = new RevealOverlay({ scale: layout.revealScale }, deps)

  layers.page.addChild(page)
  layers.pool.addChild(pool, kindTabs, factionTabs, poolHint, prevPage, nextPage, pageLabel)
  layers.poolCards.addChild(...poolCells)
  layers.side.addChild(
    side,
    deckTabs,
    newDeck,
    rename,
    remove,
    drawerHandle,
    tally,
    progress,
    slots,
    sideHint,
    confirm,
  )
  layers.overlay.addChild(back, title, reveal)

  const parts: DeckParts = {
    layers,
    page,
    back,
    title,
    pool,
    kindTabs,
    factionTabs,
    poolCells,
    poolHint,
    prevPage,
    nextPage,
    pageLabel,
    side,
    deckTabs,
    newDeck,
    rename,
    remove,
    drawerHandle,
    tally,
    progress,
    slots,
    sideHint,
    confirm,
    reveal,
  }
  applyDeckLayout(parts, layout)
  return parts
}

/**
 * 按版式把所有零件摆一遍。改视口和换档位都走这里。
 *
 * 底板（面板 A / B / D）的几何是**画死**的，尺寸一变就得换一块新的——所以换尺寸时
 * 这里只摆位置，重画由场景重建零件负责（见 DeckScene 的 rebuild）。
 */
function applyDeckLayout(parts: DeckParts, layout: DeckLayout): void {
  parts.page.position.set(0, 0)
  parts.back.position.set(layout.back.x, layout.back.y)
  /*
   * 标题排在返回钮之后。版式给的 `title.x` 只是一个下限——返回钮的宽度跟着它那行字走
   *（字要烤成纹理才知道多宽），版式算不出来，所以在这儿取两者的大的那个。
   */
  parts.title.position.set(
    Math.max(layout.title.x, layout.back.x + parts.back.boxWidth + TITLE_GAP),
    layout.title.y,
  )

  parts.pool.position.set(layout.pool.x, layout.pool.y)
  /*
   * 两排页签的**竖向**位置在这儿定（版式给的是那一行的中线，扣掉半个高就是左上角）；
   * 阵营那一排的**横向**位置要等它的字烤出来才算得出，所以在 render 里定。
   */
  parts.kindTabs.position.set(layout.poolKinds.x, layout.poolKinds.y - parts.kindTabs.boxHeight / 2)
  parts.factionTabs.position.set(
    layout.poolFactions.x,
    layout.poolFactions.y - parts.factionTabs.boxHeight / 2,
  )
  parts.poolCells.forEach((cell, index) => {
    const rect = cellRect(layout.poolGrid, index)
    cell.resize(rect.width, rect.height, layout.poolCardScale)
    cell.position.set(rect.x, rect.y)
  })
  parts.poolHint.resize(layout.poolHint.width, layout.poolHint.height)
  parts.poolHint.position.set(layout.poolHint.x, layout.poolHint.y)
  parts.prevPage.position.set(layout.pager.prev.x, layout.pager.prev.y)
  parts.nextPage.position.set(layout.pager.next.x, layout.pager.next.y)
  parts.pageLabel.position.set(layout.pager.label.x, layout.pager.label.y)

  parts.side.position.set(layout.side.x, layout.side.y)
  parts.deckTabs.position.set(layout.tabs.x, layout.tabs.y)
  parts.newDeck.position.set(
    layout.tabs.x + layout.tabs.width - parts.newDeck.boxWidth,
    layout.tabs.y,
  )
  const handle = layout.drawer?.handle
  parts.drawerHandle.visible = handle !== undefined
  if (handle !== undefined) parts.drawerHandle.position.set(handle.x, handle.y)
  parts.rename.position.set(layout.manage.x, layout.manage.y)
  parts.remove.position.set(layout.manage.x + parts.rename.boxWidth + 8, layout.manage.y)
  parts.tally.position.set(layout.tally.x, layout.tally.y + 10)
  parts.progress.resize(layout.progress.width)
  parts.progress.position.set(layout.progress.x, layout.progress.y)
  parts.slots.resize(layout.slots, layout.slotCardScale)
  parts.slots.position.set(0, 0)
  parts.sideHint.resize(layout.sideHint.width, layout.sideHint.height)
  parts.sideHint.position.set(layout.sideHint.x, layout.sideHint.y)
  parts.confirm.position.set(
    layout.confirm.x - parts.confirm.boxWidth / 2,
    layout.confirm.y - parts.confirm.boxHeight / 2,
  )
  parts.reveal.resize(layout.width, layout.height)
}
