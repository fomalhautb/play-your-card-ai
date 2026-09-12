/**
 * 构筑页那一堆卡的**回收池**。
 *
 * 这一页和对局最大的不同是「同一张卡反复出现又消失」：翻一页换掉一整屏，
 * 加一张牌牌组栏就多一张，删一张就少一张。随建随销的话，
 * 每次翻页都是一整屏的对象分配——而 6.9 那条「稳态每帧堆分配接近 0」量的正是这个。
 *
 * 所以：**建出来的卡一张都不销毁，用完还回来**（`release`），下次要同一张牌时原样取回。
 * 一局构筑下来最多也就攒下「卡池那 26 张 + 牌组那 20 张」这个量级，
 * 而它们本来就是这一页要画的东西。整场景销毁时才一起收（`disposeCards`）。
 *
 * 卡面文字不在这里操心：它们过的是全场共用的那份文字纹理缓存（见 CardSprite），
 * 同一张牌第二次建出来时一个字都不会重新烤（3.5）。
 */

import type { CardId } from '@ai-duel/core'
import { CardSprite } from '../../components/CardSprite'
import type { CardVisuals } from '../duel/cardVisuals'
import type { DuelDeps } from '../duel/deps'

export interface CardPool {
  /**
   * 取一张这张牌的卡。有空闲的就拿空闲的，没有才新建。
   *
   * @param tag 只影响卡在场景树上的名字（`card:<tag>`），交互测试和 bench 按它找命中点。
   */
  take(cardId: CardId, tag: string): CardSprite
  /** 还回来。卡会被摘出显示列表，但**不销毁**。 */
  release(card: CardSprite, cardId: CardId): void
  /** 整个场景拆的时候把攒下的全收掉。 */
  dispose(): void
}

export function createCardPool(deps: DuelDeps, visuals: CardVisuals): CardPool {
  /** 每张牌各一条空闲队列。键是卡 id，因为「同一张牌」才可以互相顶替。 */
  const idle = new Map<CardId, CardSprite[]>()
  /** 建过的全部卡，销毁时按它遍历。 */
  const all: CardSprite[] = []

  return {
    take(cardId, tag) {
      const queue = idle.get(cardId)
      const reused = queue?.pop()
      if (reused !== undefined) {
        reused.label = `card:${tag}`
        /*
         * 还回来时可能正压暗着、翻着、歪着、带着影子（送回卡池那一程末尾还在淡出），
         * 取出来要还原成一张普通的平放卡——不然下一格会拿到一张半透明的、背面朝上的牌。
         */
        reused.alpha = 1
        reused.visible = true
        reused.rotation = 0
        reused.setDim(0xffffff)
        reused.setTilt(0, 0)
        reused.flipState.angle = 0
        reused.setFlipAngle(0)
        reused.setLifted(false)
        return reused
      }
      const card = new CardSprite(visuals.visualOf(cardId, tag), deps.cardDeps)
      all.push(card)
      return card
    },

    release(card, cardId) {
      card.parent?.removeChild(card)
      const queue = idle.get(cardId)
      if (queue === undefined) idle.set(cardId, [card])
      else queue.push(card)
    },

    dispose() {
      for (const card of all) card.destroy({ children: true, texture: false, textureSource: false })
      all.length = 0
      idle.clear()
    },
  }
}
