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
import type { CardSprite } from '../../components/CardSprite'
import type { DeckTutorialGate } from '../deckContract'
import type { DeckLayout } from './layout/types'
import type { PreviewGap } from './logic/insert'
import type { DeckRules, PoolCard } from './logic/types'
import type { DeckParts } from './parts'
import type { DeckState } from './state'

/** 正拖着的那一张是从哪儿来的。 */
type DragOrigin =
  /** 卡池第 index 格（那一格在拖拽期间空着）。 */
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
  /** 此刻的状态。改它走 state.ts 那几条纯函数，改完必须 `commit`。 */
  state: DeckState
  /** 拖拽途中让出来的那一格，没在拖就是 null。 */
  gap: PreviewGap
  /** 正拖着的是谁，没在拖就是 null。 */
  dragging: DragOrigin | null
  /**
   * 新手教程那一段的放行闸门，正式构筑页恒为 null（见 deckContract 的 `DeckTutorialGate`）。
   * 判它的那几处收在 tutorial.ts，别在这一层散着写。
   */
  tutorial: DeckTutorialGate | null

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

  /** 页码那行字。换内容要重烤纹理，所以由场景统一管（内容没变就不动）。 */
  setPageLabel(text: string): void
  /** 「已选 N / 20」那行字，同上。 */
  setTally(text: string): void

  /** 状态或画面改了，叫醒帧循环。 */
  wake(): void
  /** 牌表或当前牌组变了，往外报一条（调用方当场落盘）。 */
  emitChange(): void
  /** 玩家点开了一张卡看大图。 */
  emitInspect(cardId: CardId): void
  /** 玩家点了被教学闸门挡住的东西，把那句话转出去（界面拿它弹一句提示）。 */
  blocked(tip: string): void
  /** 玩家要改名 / 新建 / 删除。 */
  emitManage(
    action: { kind: 'rename'; id: string } | { kind: 'delete'; id: string } | { kind: 'create' },
  ): void
}
