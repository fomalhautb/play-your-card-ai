/**
 * 构筑页的放大查看：点一张卡，它从原来那一格**飞**到屏幕中央放大，右边再并排摆一张背面大卡，
 * 底下一行操作钮；点遮罩或「关闭」它飞回原位。
 *
 * 两张并排是这一页独有的（对局页那一份摆正中）：构筑时要读的是技能说明和模型介绍，
 * 那些字只印在背面，一次只看一面就得来回翻。位置抄黑客松 `.deck-page .reveal-card`
 * 的 39% 和 `.deck-zoom-side__card` 的 61% / 46%（见 parts.ts 的三个常量）。
 *
 * 和黑客松的一处出入：那一版 AI 牌只放大正面（背面没什么可看的），双栏塌成单栏。
 * 这一版**一律并排**——正式版每张牌都有画好的背面（见 components/CardSprite 的牌背），
 * 而「有时候一张有时候两张」会让这一层的位置跟着卡种跳。
 *
 * 卡从**回收池**借出来而不是现建：这一页的卡随时在借还（滚动、加牌、删牌都要重排），
 * 放大的那两张走同一条路，关掉时还回去即可（见 cards.ts）。
 */

import type { CardId } from '@ai-duel/core'
import { type Container, Point as PixiPoint } from 'pixi.js'
import type { CardSprite } from '../../components/CardSprite'
import { CardTilt } from '../../components/cardTilt'
import type { RevealPoint } from '../../components/RevealOverlay'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import type { Animator } from '../../runtime/animator'
import type { CardPool } from './cards'
import type { DeckLayout } from './layout/types'
import type { DeckParts } from './partsSpec'
import { ZOOM_ANCHOR_Y, ZOOM_BACK_X } from './partsSpec'
import { ZOOM_SIDE_FADE, ZOOM_TILT_DEG } from './timings'

/** 从哪儿点开的。决定那一行钮说什么，也决定关掉时飞回哪儿。 */
export interface InspectOrigin {
  from: 'pool' | 'deck'
  cardId: CardId
  index: number
}

export interface DeckInspect {
  /** 现在开着没有。开着的时候整页不接拖拽——展示层铺满全屏，底下那些卡本来就点不着。 */
  readonly open: boolean
  /** 正看着的是从哪儿点开的。没开着就是 null。那一行钮按它动手。 */
  readonly origin: InspectOrigin | null
  /** 点开一张卡。已经开着就什么都不做（同一时刻只放大一张）。 */
  show(origin: InspectOrigin): void
  /** 关掉：飞回原位，两张卡还回回收池。没开着时是空操作。 */
  hide(): void
  /** 指针动了（舞台坐标）：两张大卡各自跟着歪。 */
  move(x: number, y: number): void
  /** 逐帧推倾斜的收敛，返回还有没有事情在做。 */
  advance(deltaMs: number): boolean
}

export interface DeckInspectOptions {
  /** 取当前这套零件和版式。换档位会整套换掉，所以走取值器而不是焊死一份。 */
  parts(): DeckParts
  layout(): DeckLayout
  cards: CardPool
  animator: Animator
  /** 舞台根节点。指针坐标要过它换算到大卡自己的坐标里。 */
  stage: Container
  cardTilt: boolean
  wake(): void
  /** 这张牌此刻画在舞台的哪儿（原来那一格）。飞入的起点、飞回的落点都是它。 */
  originPoint(origin: InspectOrigin): RevealPoint
  /** 玩家点开了一张卡。调用方拿它放音效、记埋点。 */
  onShow(cardId: CardId): void
}

export function createDeckInspect(options: DeckInspectOptions): DeckInspect {
  let shown: { origin: InspectOrigin; front: CardSprite; back: CardSprite } | null = null
  let frontTilt: CardTilt | null = null
  let backTilt: CardTilt | null = null
  const scratch = new PixiPoint()

  /** 把舞台坐标换算成某张大卡自己的坐标（走 Pixi，中间隔着展示层的位移和缩放）。 */
  const ratioIn = (card: CardSprite, x: number, y: number): { x: number; y: number } => {
    scratch.set(x, y)
    const local = card.toLocal(scratch, options.stage, scratch)
    return { x: local.x / CARD_WIDTH + 0.5, y: local.y / CARD_HEIGHT + 1 }
  }

  /** 背面那张大卡摆哪儿：61% / 46%，卡的原点在底边中点所以要往下让半张。 */
  const placeBack = (back: CardSprite): void => {
    const layout = options.layout()
    const scale = layout.revealScale
    back.scale.set(scale)
    back.position.set(
      layout.width * ZOOM_BACK_X,
      layout.height * ZOOM_ANCHOR_Y + (CARD_HEIGHT * scale) / 2,
    )
  }

  return {
    get open() {
      return shown !== null
    },

    get origin() {
      return shown?.origin ?? null
    },

    show(origin) {
      if (shown !== null) return
      const parts = options.parts()
      const front = options.cards.take(origin.cardId, `inspect:${origin.cardId}`)
      const back = options.cards.take(origin.cardId, `inspect-back:${origin.cardId}`)
      // 背面那张一开始就翻过去：它的角色就是「另一面」，不演翻面。
      back.flipState.angle = 180
      back.setFlipAngle(180)
      back.setLifted(true)
      front.setLifted(true)
      placeBack(back)
      parts.zoomSide.addChildAt(back, 0)
      shown = { origin, front, back }
      frontTilt = new CardTilt(front, options.cardTilt, ZOOM_TILT_DEG)
      backTilt = new CardTilt(back, options.cardTilt, ZOOM_TILT_DEG)

      parts.reveal.enter(front, options.originPoint(origin))
      parts.zoomActions.add.setLabel(origin.from === 'pool' ? '加入牌组' : '移出牌组')
      parts.zoomSide.visible = true
      options.animator.fromTo(
        parts.zoomSide,
        { alpha: 0 },
        { alpha: 1, duration: ZOOM_SIDE_FADE, ease: 'power2.out', overwrite: 'auto' },
      )
      options.onShow(origin.cardId)
      options.wake()
    },

    hide() {
      const current = shown
      if (current === null) return
      shown = null
      frontTilt?.reset()
      backTilt?.reset()
      frontTilt = null
      backTilt = null
      const parts = options.parts()
      const flight = parts.reveal.landTo(options.originPoint(current.origin))
      options.animator.tween(parts.zoomSide, {
        alpha: 0,
        duration: ZOOM_SIDE_FADE,
        ease: 'power2.in',
        overwrite: 'auto',
        onComplete: () => {
          parts.zoomSide.visible = false
        },
      })
      /*
       * 两张卡都等飞完才还回回收池：还早了的话它会被下一次重排当空闲卡取走，
       * 而它此刻还挂在展示层上正飞着——屏幕上会有同一张牌同时出现在两个地方。
       */
      options.animator.timeline().call(
        () => {
          current.front.setLifted(false)
          current.back.setLifted(false)
          options.cards.release(current.front, current.origin.cardId)
          options.cards.release(current.back, current.origin.cardId)
        },
        undefined,
        flight / 1000,
      )
      options.wake()
    },

    move(x, y) {
      const current = shown
      if (current === null) return
      const front = ratioIn(current.front, x, y)
      frontTilt?.setPointer(front.x, front.y)
      const back = ratioIn(current.back, x, y)
      backTilt?.setPointer(back.x, back.y)
      options.wake()
    },

    advance(deltaMs) {
      let busy = false
      if (frontTilt?.advance(deltaMs) === true) busy = true
      if (backTilt?.advance(deltaMs) === true) busy = true
      return busy
    },
  }
}
