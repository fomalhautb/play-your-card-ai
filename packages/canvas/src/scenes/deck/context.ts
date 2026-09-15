/**
 * 构筑页场景内部共用的那份上下文。
 *
 * 和对局场景的 `scenes/duel/context.ts` 是同一个路子：render 和 input 都只认这一个接口，
 * 于是那两层各自都能拿一份**替身上下文**在 vitest 里跑（见 test/helpers/fakeDeckInput.ts），
 * 不用起画布。
 *
 * `parts` 和 `layout` 走取值器：换档位会整套换掉零件、改视口会换掉版式，
 * 而 render 和 input 手里的是同一个对象，取值器让它们始终看到当前那一份。
 */

import type { CardId } from '@ai-duel/core'
import type { Container } from 'pixi.js'
import type { CardSprite } from '../../components/CardSprite'
import type { Animator } from '../../runtime/animator'
import type { DeckLayout } from './layout/types'
import type { PreviewGap } from './logic/insert'
import type { DeckRules, PoolCard } from './logic/types'
import type { DeckParts } from './parts'
import type { ScrollState } from './scroll'
import type { DeckState } from './state'

/** 正拖着的那一张是从哪儿来的。 */
type DragOrigin =
  /** 筛完的卡池里的第 index 张（那一格在拖拽期间空着）。翻页那一档同样是这个口径。 */
  | { from: 'pool'; cardId: CardId; index: number }
  /** 牌组第 index 张（那一格在拖拽期间空着，松手在牌组栏外面才是真的移除）。 */
  | { from: 'deck'; cardId: CardId; index: number }

export interface DeckContext {
  /** 卡池（已经算好的那份，顺序即摆放顺序）。整场景不变。 */
  readonly pool: readonly PoolCard[]
  /** 阵营药丸。整场景不变。 */
  readonly factions: readonly { id: string; label: string }[]
  readonly rules: DeckRules
  readonly parts: DeckParts
  readonly layout: DeckLayout
  /** 补间都走它记账，帧循环按它判忙（见 runtime/animator.ts）。 */
  readonly animator: Animator
  /** 舞台根节点。指针坐标要过它换算到某张卡自己的坐标里（见 hover.ts）。 */
  readonly stage: Container
  /**
   * 卡跟不跟指针倾斜。
   *
   * 判据和对局那边同一条（效果档位开着、玩家没要求「减少动效」），
   * 所以这里只是把 `DuelDeps.cardTilt` 传下来，不自己再算一遍。
   */
  readonly cardTilt: boolean
  /** 此刻的状态。改它走 state.ts 那几条纯函数，改完必须 `commit`。 */
  state: DeckState
  /** 拖拽途中让出来的那一格，没在拖就是 null。 */
  gap: PreviewGap
  /** 正拖着的是谁，没在拖就是 null。 */
  dragging: DragOrigin | null
  /**
   * 两块滚动区此刻滚到哪儿（桌面档的卡池和牌组卡位）。
   *
   * 手机档那一档它们的上限恒为 0（卡池翻页、20 个卡位一屏摆得下），所以怎么滚都不动，
   * 下游因此不用到处判档位。
   */
  readonly poolScroll: ScrollState
  readonly slotScroll: ScrollState

  /**
   * 借一张卡出来摆。**借出去的都记着**，下一轮 `beginBorrow` 会统一还回去，
   * 所以调用方不用自己配对（见 cards.ts 的回收池）。
   */
  takeCard(cardId: CardId, tag: string): CardSprite
  /**
   * 拿一张**不进借出名单**的卡：跟着指针跑的那一张就是它。
   *
   * 走 `takeCard` 的话，下一次重排画面时 `beginBorrow` 会把它一起还回去——
   * 而拖拽期间画面每让一次位就重排一次，卡当场从手上消失。
   * 这一张由输入层自己在松手时 `releaseCard`。
   */
  holdCard(cardId: CardId, tag: string): CardSprite
  /**
   * 开始新一轮借卡。上一轮借出去的先**记着**（不摘下来），
   * 这一轮再要同一张时原样还给它——那张卡因此留在原来的位置上，一次重挂都不用。
   */
  beginBorrow(): void
  /** 这一轮借完了。上一轮借过、这一轮没再要的那些，到这里才真的还回去。 */
  endBorrow(): void
  /** 单独还一张（拖拽结束时那张不走 `beginBorrow` 那条路）。 */
  releaseCard(card: CardSprite, cardId: CardId): void

  /** 状态或画面改了，叫醒帧循环。 */
  wake(): void
  /** 牌表或当前牌组变了，往外报一条（调用方当场落盘）。 */
  emitChange(): void
  /**
   * 玩家点开了一张卡看大图。
   *
   * 从哪儿点开的也要说：放大层那一行操作钮是「加入牌组」还是「移出牌组」按它定，
   * 关掉时飞回哪一格也按它算。
   */
  emitInspect(origin: { from: 'pool' | 'deck'; cardId: CardId; index: number }): void
  /**
   * 这张牌加不进去：摇个头、在卡顶弹一句为什么。
   *
   * @param card 要摇的是哪张。拖拽那一条传跟手那张（它就在指针底下），
   *   点「＋」那一条传 null——由场景去卡池里找那一格（见 refuse.ts）。
   */
  refuse(cardId: CardId, card: CardSprite | null): void
  /** 玩家要改名 / 新建 / 删除。 */
  emitManage(
    action: { kind: 'rename'; id: string } | { kind: 'delete'; id: string } | { kind: 'create' },
  ): void
}
