/**
 * 给构筑页交互测试用的一份**假**场景上下文：零件全换成只记账的替身。
 *
 * 和 `fakeDuelInput.ts` 同一个路子，要留着的东西也一样：**版式的几何是真的**
 *（`desktopLayout(1280, 800)`），因为落点判定的输入就是坐标，
 * 拿假数字喂进去等于测了一套现实里不存在的版式。卡也是假的——
 * 这一层测的是「一串指针动作最后让牌组变成了什么样」，画面归截图回归。
 */

import type { CardSprite } from '../../src/components/CardSprite'
import { cellCount } from '../../src/layout/gridMath'
import type { DeckContext } from '../../src/scenes/deck/context'
import { desktopLayout } from '../../src/scenes/deck/layout/desktopLayout'
import { mobileLayout } from '../../src/scenes/deck/layout/mobileLayout'
import { DEFAULT_DECK_RULES, type PoolCard } from '../../src/scenes/deck/logic/types'
import { createDeckState } from '../../src/scenes/deck/state'
import type { DeckView } from '../../src/scenes/deckContract'

/** 测试用的视口。短边 800 ≥ 断点 768，所以走桌面档。 */
const FAKE_SIZE = { width: 1280, height: 800 }

/**
 * 一份最小卡池：四张 AI 牌、一张技能牌、一张灰卡。
 * 够覆盖「按种类筛」「按阵营筛」「灰卡加不进去」三条分支。
 */
const FAKE_POOL: PoolCard[] = [
  { cardId: 'gpt-4o', kind: 'ai', faction: 'gpt', blockedReason: null },
  { cardId: 'gpt-3-5', kind: 'ai', faction: 'gpt', blockedReason: null },
  { cardId: 'claude', kind: 'ai', faction: 'claude', blockedReason: null },
  { cardId: 'qwen', kind: 'ai', faction: 'other', blockedReason: null },
  { cardId: 'safe-pass', kind: 'skill', faction: 'other', blockedReason: null },
  { cardId: 'soon', kind: 'skill', faction: 'other', blockedReason: '即将上线' },
]

const FAKE_FACTIONS = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'other', label: '其他' },
]

/** 假上下文对外露出的那点观察窗口。 */
export interface DeckProbe {
  ctx: DeckContext
  /** 每次 `onChange` 报出来的牌表快照，按先后顺序。 */
  changes: { cards: string[]; currentId: string }[]
  /** 点开过哪几张卡的大图。 */
  inspected: string[]
  /** 当前牌组此刻的牌表。 */
  cards(): string[]
  /** 卡池第 index 格的格心（视口坐标）。 */
  poolCenter(index: number): { x: number; y: number }
  /** 牌组第 index 格的格心（视口坐标）。 */
  slotCenter(index: number): { x: number; y: number }
  /** 卡池外、牌组栏外的一点（页头那一条）。松手落这儿就是「拖出去了」。 */
  outside(): { x: number; y: number }
}

/** 一张假卡：输入层只会读它的 scale、写它的位置，再把它挂进拖拽层。 */
function fakeCard(): CardSprite {
  const card = {
    x: 0,
    y: 0,
    scale: {
      x: 1,
      y: 1,
      set: (value: number) => Object.assign(card.scale, { x: value, y: value }),
    },
    position: {
      set: (x: number, y: number) => {
        card.x = x
        card.y = y
      },
    },
    parent: null,
  }
  return card as unknown as CardSprite
}

/** 一格卡池的替身：只记「现在摆着哪张卡」。 */
function fakeCell() {
  return {
    visible: false,
    shown: null as CardSprite | null,
    setCard(card: CardSprite | null) {
      this.shown = card
    },
    setBlocked: () => undefined,
    setCopies: () => undefined,
    setAddDisabled: () => undefined,
  }
}

export interface ProbeSpec {
  /** 一开始就摆好的牌表。 */
  cards?: string[]
  /** 走哪一档版式。默认桌面档。 */
  tier?: 'desktop' | 'mobile'
}

export function createDeckProbe(spec: ProbeSpec = {}): DeckProbe {
  const layout =
    spec.tier === 'mobile'
      ? mobileLayout(390, 844)
      : desktopLayout(FAKE_SIZE.width, FAKE_SIZE.height)
  const decks: DeckView[] = [{ id: 'd1', name: '牌组一', cards: spec.cards ?? [] }]
  const changes: { cards: string[]; currentId: string }[] = []
  const inspected: string[] = []
  const cells = Array.from({ length: cellCount(layout.poolGrid) }, () => fakeCell())

  const parts = {
    layers: { side: { y: 0 }, drag: { addChild: () => undefined } },
    poolCells: cells,
    kindTabs: { setItems: () => undefined },
    factionTabs: { setItems: () => undefined, setDisabled: () => undefined },
    deckTabs: { setItems: () => undefined },
    newDeck: { setDisabled: () => undefined },
    rename: { setDisabled: () => undefined },
    remove: { setDisabled: () => undefined },
    drawerHandle: { visible: true },
    prevPage: { setDisabled: () => undefined },
    nextPage: { setDisabled: () => undefined },
    poolHint: { setText: () => undefined },
    sideHint: { setText: () => undefined },
    slots: { place: () => undefined, setGap: () => undefined },
    progress: { setValue: () => undefined },
    confirm: { setDisabled: () => undefined },
  }

  const ctx = {
    pool: FAKE_POOL,
    factions: FAKE_FACTIONS,
    rules: DEFAULT_DECK_RULES,
    parts,
    layout,
    // 桌面档没有抽屉，抽屉档一开始是收着的（同真场景）。
    state: createDeckState(decks, 'd1', layout.tier === 'desktop'),
    gap: null,
    dragging: null,
    takeCard: () => fakeCard(),
    holdCard: () => fakeCard(),
    beginBorrow: () => undefined,
    releaseCard: () => undefined,
    setPageLabel: () => undefined,
    setTally: () => undefined,
    wake: () => undefined,
    emitChange: () => {
      const current = ctx.state.decks.find((deck) => deck.id === ctx.state.currentId)
      changes.push({ cards: [...(current?.cards ?? [])], currentId: ctx.state.currentId })
    },
    emitInspect: (cardId: string) => inspected.push(cardId),
    emitManage: () => undefined,
  } as unknown as DeckContext

  const center = (grid: typeof layout.poolGrid, index: number) => {
    const column = index % grid.columns
    const row = Math.floor(index / grid.columns)
    return {
      x: grid.x + column * (grid.cellWidth + grid.gapX) + grid.cellWidth / 2,
      y: grid.y + row * (grid.cellHeight + grid.gapY) + grid.cellHeight / 2,
    }
  }

  return {
    ctx,
    changes,
    inspected,
    cards: () => [
      ...(ctx.state.decks.find((deck) => deck.id === ctx.state.currentId)?.cards ?? []),
    ],
    poolCenter: (index) => center(layout.poolGrid, index),
    slotCenter: (index) => center(layout.slots, index),
    // 页头那一条：卡池上沿之上，牌组栏也够不着。
    outside: () => ({ x: layout.width / 2, y: layout.topBarHeight / 2 }),
  }
}
