/**
 * 对局场景对新手教程开出来的那几个口子（迁移第 32 条）。
 *
 * 一共两样：**问锚点**（「结束出牌那颗钮现在占哪一块」，换算在 anchors.ts）和
 * **逐张锁**（这一步只许打高亮那张，其余点上去说一句话）。
 * 收在一个文件里是因为它们只服务教程这一个调用方——正式对局从头到尾一次都不碰，
 * 散进场景主体只会让「这一段是给谁用的」看不出来。
 *
 * 「结束出牌」那一档不在这里：它是整颗钮的开关，走的是编排层的
 * `UserAction.tutorial-gate` → `DirectorLocks.endPlayLocked`，和这里的逐张锁是两回事。
 */

import type { DuelScene } from '../duelContract'
import { anchorRectOf, handCardRectOf } from './anchors'
import type { DuelContext } from './context'

/** 场景句柄里归教程的那四条。 */
type TutorialHandle = Pick<
  DuelScene,
  'anchorRect' | 'handCardRect' | 'onBlocked' | 'setBlockedCards'
>

export interface DuelTutorial {
  readonly handle: TutorialHandle
  /** 玩家点了一张被锁住的牌，把那句话转出去。没人听就什么都不做。 */
  notifyBlocked(tip: string): void
}

/**
 * @param refresh 把手牌的压暗按新的那份锁重刷一遍（场景交的是输入层那条，见 input.ts）。
 */
export function createDuelTutorial(ctx: DuelContext, refresh: () => void): DuelTutorial {
  let onBlocked: ((tip: string) => void) | null = null
  return {
    handle: {
      anchorRect: (name) => anchorRectOf(ctx, name),
      handCardRect: (instanceId) => handCardRectOf(ctx, instanceId),
      onBlocked: (callback) => {
        onBlocked = callback
      },
      setBlockedCards: (blocked) => {
        ctx.blockedCards = blocked
        refresh()
      },
    },
    notifyBlocked: (tip) => onBlocked?.(tip),
  }
}
