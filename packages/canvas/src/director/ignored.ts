/**
 * 事件覆盖表：引擎的每一种事件，编排层要么有演出，要么在这里写明为什么不演。
 *
 * 《正式版架构》6.5 第 2 条要求「每种事件类型要么有演出，要么显式声明忽略，漏掉的挂」。
 * 这张表用 `Record<GameEvent['type'], …>` 写死，`core` 加一种事件时这里会编译不过，
 * 逼着加的人当场决定它该不该演——默认「不演」是最容易漏掉的默认值。
 *
 * 「不演」不等于「没用」：`ROUND_CONFIRMED` 不产生任何画面，但补牌闸门的判据要读它。
 * 所以这里说的是「有没有自己的演出」，不是「编排层理不理它」。
 */

import type { GameEvent } from '@ai-duel/core'

export type EventPlan =
  /** 有演出：`note` 说清楚演的是什么，找演出代码时照着它去 events.ts 里搜。 */
  | { handling: 'cue'; note: string }
  /** 不演：`reason` 说清楚这件事归谁管，别人来看时不用再翻一遍旧代码。 */
  | { handling: 'ignored'; reason: string }

export const EVENT_PLAN: Record<GameEvent['type'], EventPlan> = {
  GAME_STARTED: { handling: 'cue', note: '抛硬币定先手的全屏过场，收尾放行开局发牌。' },
  CARD_DRAWN: {
    handling: 'cue',
    note: '发牌 / 补牌。要先过发牌闸门：开局那批等抛硬币演完，回合末那批等结算层退场。',
  },
  CARD_REMOVED: {
    handling: 'ignored',
    reason:
      '手牌少一张（模型蒸馏弃牌、调试指令删牌）。手牌扇形跟着视图自己收，没有额外演出；' +
      '弃掉那张牌的去向由它自己那条 SKILL_PLAYED 的亮相交代。',
  },
  ROUND_STARTED: { handling: 'cue', note: '中央横幅「第 N 轮 · 类别」。' },
  PLAY_TURN_STARTED: { handling: 'cue', note: '中央横幅「轮到你出牌」/「对方出牌中」。' },
  AI_DEPLOYED: {
    handling: 'cue',
    note: '我方：从手牌飞向战场格 + 落地特效。对方：强制展示，受理不了退回简易进场。',
  },
  SKILL_PLAYED: {
    handling: 'cue',
    note: '我方：中央亮相（有目标的接一段飞行和命中）。对方：强制展示，受理不了就不演。',
  },
  SKILL_CANCELED: {
    handling: 'cue',
    note: '英雄技能抵消层。要等那张牌的亮相演完才放，否则会盖住牌面。',
  },
  HERO_SKILL_USED: { handling: 'cue', note: '中央横幅报换了哪两张卡，目标格上闪一次命中特效。' },
  QUESTION_REVEALED: { handling: 'cue', note: '回合结算层立起来，先收掉还没演完的强制展示。' },
  AI_ANSWERED: { handling: 'cue', note: '结算层里添一张结果卡，先只有卡名和「作答中」转圈。' },
  AI_ELIMINATED: {
    handling: 'ignored',
    reason:
      '答错罚下。结算层里那张卡的红章和压暗已经说明了，而被罚下的小卡随新视图直接从战场消失' +
      '——那时战场整个被结算层盖着，看不见跳变。',
  },
  AI_SAFE_PASSED: {
    handling: 'cue',
    note: '给对应的结果卡打上「保送」，判定章那一拍会多盖一枚「保送留场」。',
  },
  AI_REMOVED: { handling: 'cue', note: '被技能牌罚下：那张小卡沉下去化掉。' },
  AI_TRANSFORMED: { handling: 'cue', note: '进化特效，一批里逐格错开起。' },
  ROUND_SCORED: { handling: 'cue', note: '结算层主线起跑：标准答案、逐卡作答、盖章、比分。' },
  ROUND_CONFIRMED: {
    handling: 'ignored',
    reason:
      '确认态由结算层直接读视图。它本身不演，但补牌闸门要读它：' +
      '「这一批里 ROUND_CONFIRMED 后面还跟着 CARD_DRAWN」才说明轮次真的推进了。',
  },
  GAME_OVER: {
    handling: 'ignored',
    reason:
      '终局结算层跟着视图的 winner 常驻显示，不是有时长的演出。' +
      '它带来的阶段变化（离开 settle）会让回合结算层退场，那一下由退场判据管。',
  },
  COMMAND_REJECTED: {
    handling: 'cue',
    note:
      '出不了牌的红字提示。旧版走 MatchView.lastRejection 那条常驻文案，' +
      '新版驱动只往下发事件，所以改由这里发一条时长为 0 的 cue，由下一条提示覆盖。',
  },
}
