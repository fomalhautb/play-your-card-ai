/**
 * 手牌指针状态机的参数表（`HandPointer` 的构造参数）。
 *
 * 单独一个文件，理由和 `scenes/duel/layout/types.ts` 一样：它是一份**跨文件的约定**，
 * 场景那边照它拼参数（见 `scenes/duel/input.ts`），状态机那边照它取东西，
 * 而这些回调的每一条都要一段说明才看得懂「为什么非得由调用方给」。
 * 和状态机本体放在一个文件里，光是这张表就占掉五十行，读状态机的人要先翻过它。
 */

import type { Container } from 'pixi.js'
import type { CardSprite } from '../components/CardSprite'
import type { CardTilt } from '../components/cardTilt'
import type { HandFan } from '../components/HandFan'
import type { Animator } from '../runtime/animator'
import type { DropZoneRect } from './dragRules'

export interface HandPointerOptions {
  /**
   * 舞台。既是事件的汇合点，也是**坐标基准**：指针事件带的是视口坐标，
   * 而落点区、扇形锚点这些都是舞台坐标，两者在桌面档差一个整块缩放
   *（见 scenes/duel/layout/types.ts 的文件头）。所以这里收到的每个坐标都先过一次
   * `stage.toLocal`，之后整个文件里就只有舞台坐标一种。
   */
  stage: Container
  fan: HandFan
  /** 被拖起来的牌画在这一层，它在扇形之上。 */
  dragLayer: Container
  animator: Animator
  /** 现在的出牌区（舞台坐标）。版式一变就跟着变，所以是函数不是值。 */
  dropZone: () => DropZoneRect
  /** 舞台坐标 → 手牌容器坐标。 */
  toFanLocal: (stageX: number, stageY: number) => { x: number; y: number }
  /** 手牌容器坐标 → 舞台坐标，连缩放一起换算。 */
  fanToWorld: (x: number, y: number, scale: number) => { x: number; y: number; scale: number }
  /** 这张牌的倾斜跟随，没有就是这一档不做倾斜。 */
  tiltFor: (card: CardSprite) => CardTilt | undefined
  /** 玩家把牌拖进出牌区松手了，或者鼠标轻点了一下。 */
  onPlay: (card: CardSprite) => void
  /**
   * 玩家点了能翻面那张牌的问号章（或者点了已经翻过去的牌想翻回来）。
   * 翻面本身归场景演，这里只判「这一下点的是不是那枚章」。
   */
  onFlip?: (card: CardSprite) => void
  /**
   * 抬起来的换成了哪一张（没有就是 null）。
   *
   * 给「抬起的那张恢复本色、其余跟着整排压暗」用（见 scenes/duel/handMood.ts）。
   * 抬牌本身的补间归扇形自己管，这里只是报一声换人了。
   */
  onHover?: (card: CardSprite | null) => void
  /**
   * 落点提示该处在哪一档：没在拖（off）、拖着（ready）、指针已经进到落区里（hot）。
   *
   * 高亮必须和松手的实际结果一致，所以这一档是拿**同一个** `pointInZone` 算的——
   * 亮着「松手就打出去」结果松手被判成取消，是最容易让人以为是 bug 的那种不一致。
   */
  onDropState?: (state: 'off' | 'ready' | 'hot') => void
  /** 现在允不允许出牌。演出期间整排冻住。 */
  enabled: () => boolean
  /**
   * 叫醒帧循环。
   *
   * 这个回调是必需的，不是可选的优化：跟随和倾斜都只在 advance 里推进，而 advance 只有
   * 帧循环在跑的时候才被调到。没有补间在播时帧循环是停着的（3.6），指针再怎么动都没人画，
   * 卡面就冻在上一帧——表现是"抬起来的牌不跟着鼠标倾斜、高光根本不出现"。
   * 补间那条路由 Animator 自己叫醒（见场景里 new Animator 那行），指针这条路只能自己叫。
   */
  wake: () => void
}
