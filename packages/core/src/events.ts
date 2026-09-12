/**
 * 引擎产出的事件流，以及引擎的统一返回 `ExecuteResult`。
 *
 * 「指令进、事件出」的出这一半，进那一半在 commands.ts。
 * `ExecuteResult` 放这儿而不是 state.ts：它是「执行一条指令」这件事的返回，
 * 一半是新状态、一半是这一批事件，跟着事件走比跟着状态走更说得通。
 *
 * 事件发给某一方之前要过一遍 view.ts 的 `filterEvent`，哪几条要裁、裁成什么样在那边的文件头。
 *
 * 和这一组别的类型文件一样必须是纯数据、可 JSON 序列化，理由见 types.ts 的文件头。
 */

import type { CardId, HeroId, InstanceId } from './cards'
import type { PublicQuestion, Question, QuestionCategory } from './question'
import type { AiInstance, CardInstance, GameState, PlayerId, RoundVerdict } from './state'

/**
 * 引擎产出的事件流，客户端照着它播动画。
 * 事件描述"已经发生的事实"，客户端不该再自己算一遍规则。
 */
export type GameEvent =
  /** 开局抛硬币的结果，客户端拿它播全场硬币动画。 */
  | { type: 'GAME_STARTED'; firstPlayer: PlayerId }
  /**
   * 有人手上多了一张牌（抽牌，或者调试指令凭空造一张）。
   *
   * `card` 可选是**裁剪后**才会出现的形态：`filterEvent` 发给对手的那一份只留 `player`，
   * 因为对手的手牌连实例 id 都是隐藏信息（见 view.ts 的文件头）。
   * 引擎自己发出来的那一份永远带着 `card`——不带的时候客户端只知道"那边多了一张背面朝上的牌"。
   */
  | { type: 'CARD_DRAWN'; player: PlayerId; card?: CardInstance }
  /**
   * 一张手牌被直接弃掉（不是打出去的：打出去走 AI_DEPLOYED / SKILL_PLAYED）。
   * 两个来源：调试指令 DEBUG_REMOVE_CARD，以及「模型蒸馏」弃掉的那张 AI 牌。
   */
  | { type: 'CARD_REMOVED'; player: PlayerId; instanceId: InstanceId }
  | {
      type: 'ROUND_STARTED'
      round: number
      firstPlayer: PlayerId
      /** 本轮题目的类别；题目全文要等到 QUESTION_REVEALED 才展示。 */
      category: QuestionCategory
      /** 本轮题目的关键词，和类别一样属于出牌阶段就公开的情报（见 Question.keywords）。 */
      keywords: string[]
    }
  /** 轮到某方出牌，客户端打出牌横幅。 */
  | { type: 'PLAY_TURN_STARTED'; player: PlayerId }
  | { type: 'AI_DEPLOYED'; player: PlayerId; ai: AiInstance }
  /** 技能牌打出：中央亮相一下再进弃牌堆。 */
  | {
      type: 'SKILL_PLAYED'
      player: PlayerId
      cardId: CardId
      /**
       * 打出的那张手牌的实例 id。结算完全用不上它，纯粹给客户端定位用：
       * 对手出牌时要从他手牌里揪出这张牌飞到屏幕中央，而不是让它凭空出现。
       */
      instanceId: InstanceId
      /**
       * 这张技能打向的那个**场上单位**（`target` 是 foe-ai / own-ai / own-affected-ai 的卡才有）。
       *
       * 同样是给客户端定位用的：技能牌亮相完要飞向这个 AI 的战场格子并在那儿播命中特效。
       * 「模型蒸馏」那种打向手牌的（`target: 'own-hand-ai'`）刻意不带这个字段——
       * 客户端拿它去战场上找格子会扑空，那张手牌的去向由随后的 CARD_REMOVED 交代。
       *
       * 结算在事件发出前就做完了，但**别拿它当"效果一定生效了"的凭据**：
       * 这张牌可能紧接着被一条 SKILL_CANCELED 抵消掉，那时目标身上什么标记都没留下。
       * 目标身上到底有什么永远以快照里的 `AiInstance` 为准。
       */
      targetInstanceId?: InstanceId
    }
  /**
   * 一张技能牌的效果被英雄技能抵消。
   *
   * 紧跟在被抵消的那张牌的 SKILL_PLAYED 之后：牌照常打出、照常进弃牌堆，只是效果作废，
   * 客户端也就先演出牌、再演抵消。
   *
   * 两个玩家 id 方向相反，别弄混：
   * - `player` 是打出这张技能牌的一方（被抵消的那一方）；
   * - `by` 是发动英雄技能的一方，也就是 `player` 的对手。
   */
  | {
      type: 'SKILL_CANCELED'
      player: PlayerId
      by: PlayerId
      heroId: HeroId
      cardId: CardId
      /** 被抵消的那张牌的实例 id，和它的 SKILL_PLAYED 是同一个，客户端要靠它对上号。 */
      instanceId: InstanceId
    }
  /**
   * 主动英雄技能发动了：场上某个 AI 被换成同系列的另一代。
   *
   * `player` 是发动技能的一方；目标不一定是他自己的单位——升级打己方、降级打对方，
   * 看 `direction` 才知道该去谁的战场上找那个格子。
   *
   * 前后两张卡都报出来，客户端才能把"这张脸换成那张脸"演出来：
   * 新快照里只剩换完的 `cardId`，旧的那张查不回来了。
   */
  | {
      type: 'HERO_SKILL_USED'
      player: PlayerId
      heroId: HeroId
      targetInstanceId: InstanceId
      fromCardId: CardId
      toCardId: CardId
      direction: 'upgrade' | 'downgrade'
    }
  /**
   * 进入答题阶段，全屏揭晓题面。
   *
   * 引擎发出来的那一份运行时带着整道题（含答案和解析），但类型上只暴露公开的那一半：
   * 答案要等本轮结算才公开，谁都不该从这条事件上读它。真正把答案摘掉的是
   * `filterEvent`，所以下发前必须过一遍（见 view.ts）。
   */
  | { type: 'QUESTION_REVEALED'; question: Question | PublicQuestion }
  | {
      type: 'AI_ANSWERED'
      instanceId: InstanceId
      owner: PlayerId
      /**
       * 这个 AI 是哪张卡。结算界面靠它画头像和卡名。
       *
       * 明明快照里查得到，还要在事件里再报一遍，是因为答错的 AI 紧接着就被罚下了：
       * 界面拿到这批事件时新快照还没提交，等提交完那个单位已经从场上消失，再查就查不到。
       */
      cardId: CardId
      correct: boolean
      /** 回答本身（短语），界面上是那行大字。 */
      answer: string
      /** 回答的理由（两行以内），排在大字下面。 */
      reasoning: string
    }
  /** 答错被罚下，从场上移进弃牌堆。 */
  | { type: 'AI_ELIMINATED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 答错了但因为被「保送」而留在场上。
   *
   * 排在它自己那条 AI_ANSWERED 之后，占的就是本该发 AI_ELIMINATED 的位置：
   * 客户端在结算层里照常演"这个答错了"，但别演罚下，改标一个「保送」。
   */
  | { type: 'AI_SAFE_PASSED'; instanceId: InstanceId; owner: PlayerId }
  /**
   * 被技能牌罚下，从场上移进弃牌堆（不是答错罚下，那条走 AI_ELIMINATED）。
   *
   * `by` 是干这件事的那张技能牌，眼下只可能是 'memory-shortage' 或 'domestic-substitution'，
   * 客户端可以据此给两张牌配不同的演出。
   * 还带一个 `cardId` 是因为事件发出时快照里这个单位已经不在场上了，
   * 界面要画"谁被清掉了"只剩事件里这一份卡面身份（和 AI_ANSWERED 同一个道理）。
   */
  | {
      type: 'AI_REMOVED'
      instanceId: InstanceId
      owner: PlayerId
      cardId: CardId
      by: CardId
    }
  /**
   * 场上单位进化成了另一张卡（眼下只有「鸡犬升天」会产生）。
   *
   * 换的是同一个单位的卡面身份，`instanceId` 不变，身上的本轮标记也都留着——
   * 客户端换图即可，不要当成"旧的下场、新的上场"来演。
   */
  | {
      type: 'AI_TRANSFORMED'
      instanceId: InstanceId
      owner: PlayerId
      fromCardId: CardId
      toCardId: CardId
    }
  /**
   * 本轮计分。所有成对的字段一律按座位号排，[0] 是 0 号玩家。
   *
   * 除了得分本身还带上判定的全部依据（谁答对了、各花了多少 Token、按哪条规则分的），
   * 客户端的结算演出直接读它，不要自己回头再算一遍——
   * `correctCounts` 是双方实际答对的 AI 数量，光看结算后场上人数推不出来：
   * 被保送的单位答错也留在场上（见 AI_SAFE_PASSED）。
   */
  | {
      type: 'ROUND_SCORED'
      /** 本轮各得几分：0 或 1，双方答对数和消耗都相同时是 [1, 1]。 */
      gains: [number, number]
      /** 加完这一轮之后的累计总分。 */
      scores: [number, number]
      /** 本轮双方各有几个 AI 答对；场上没 AI 就是 0。 */
      correctCounts: [number, number]
      /** 本轮各方为新打出的牌花掉的 Token（见 PlayerState.spentThisRound）。 */
      spent: [number, number]
      /** 这一分是按哪条规则分出来的。 */
      verdict: RoundVerdict
    }
  /** 某一方在结算界面上确认了本轮。双方都确认后才会有后续的推进事件。 */
  | { type: 'ROUND_CONFIRMED'; player: PlayerId }
  | { type: 'GAME_OVER'; winner: PlayerId | 'draw' }
  /**
   * 非法指令。状态保持不变，只回这一条事件。
   *
   * 它是**对某一条指令的回执**，不是"局面上发生了什么"，所以不进广播：
   * `filterEvent` 对它一律返回 null，服务端把这一条直接回给发指令的那条连接
   *（见 view.ts）。这样 filterEvent 不必知道是谁发的指令，事件本身也不用多带一个字段。
   */
  | { type: 'COMMAND_REJECTED'; reason: string }

/** 引擎的统一返回：新状态 + 本次产生的事件。 */
export interface ExecuteResult {
  state: GameState
  events: GameEvent[]
}
