/**
 * 玩家（以及测试房）能对引擎发出的全部指令。
 *
 * 「指令进、事件出」的进这一半，出那一半在 events.ts。
 * 每条指令由 engine.ts 的 `execute` 分派给对应阶段的模块，合不合规则由那边判
 *（哪条归哪个文件见 engine.ts 的文件头）。
 *
 * 和这一组别的类型文件一样必须是纯数据、可 JSON 序列化，理由见 types.ts 的文件头。
 */

import type { CardId, InstanceId } from './cards'
import type { AnswerResult } from './question'
import type { PlayerId } from './state'

/** 玩家能对引擎发出的全部指令。 */
export type Command =
  /**
   * 打出一张手牌。
   *
   * 只有一道闸：每张按**实际费用**扣 Token、剩的不够就整条被拒——实际费用是卡面 tokenCost
   * 减去这一方自己的核电站减免，见 enginePlay.ts 的 effectivePlayCost。
   * AI 牌和技能牌都不限张数，一轮里 Token 够就能接着打。
   *
   * `targetInstanceId` 只有卡牌定义标了 `target` 的技能牌要填，指的是场上单位还是手牌实例
   * 由那一档 `target` 决定（见 `SkillCard.target`）。该填不填、或者填了个不合法的目标都会被拒；
   * 无目标的卡带上它则直接忽略。
   */
  | {
      type: 'PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      targetInstanceId?: InstanceId
    }
  /** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
  | { type: 'END_PLAY'; player: PlayerId }
  /**
   * 发动主动英雄技能，指定场上一个 AI 单位。
   *
   * 只有"每局一次、指定一个目标"的那两位能发：danqi-chen 把**己方**一个 AI 升一级、
   * melanie-perkins 把**对方**一个 AI 降一级（目标在哪一侧由英雄决定，指令本身不带方向）。
   * 其余英雄发这条一律被拒——grace-hopper 是被动、剩下三位还没实装。
   *
   * 只能在自己的出牌轮发动，但**完全免费**：不扣 Token，也不结束出牌轮，发动完还能接着出牌。
   */
  | { type: 'USE_HERO_SKILL'; player: PlayerId; targetInstanceId: InstanceId }
  /**
   * 提交本轮全场 AI 的答题结果。
   * 玩家不发这条指令，由房主/本地 driver 在进入答题阶段后自动生成并发出
   * （结果来自 content 的 script.ts 查的那份离线预生成的真实模型回答）。
   */
  | { type: 'SUBMIT_ANSWERS'; results: AnswerResult[] }
  /**
   * 结算界面上点"进入下一轮"。双方都发过才真的推进（或在最后一轮结束整局）。
   * 重复发会被拒，所以界面按下之后要把按钮置灰等对方。
   */
  | { type: 'CONFIRM_ROUND'; player: PlayerId }
  // 下面四条是 dev 测试房专用的调试指令，走的是和正常指令一样的 execute 路径。
  // 引擎这一层不做任何身份或来源限制——挡住它们是**服务端**的事：房间对象先核对座位身份，
  // 再决定收不收这几条（《正式版架构》5.2、6.7 的作弊测试）。引擎自己只管"这条指令合不合规则"。
  /** 给某位玩家加一张手牌：不带 cardId 从他牌堆抽一张，带 cardId 则凭空造一张新实例（不消耗牌堆）。 */
  | { type: 'DEBUG_ADD_CARD'; player: PlayerId; cardId?: CardId }
  /** 弃掉某位玩家的一张手牌：不带 instanceId 移最后一张，带则移指定那张；被移的牌进弃牌堆。 */
  | { type: 'DEBUG_REMOVE_CARD'; player: PlayerId; instanceId?: InstanceId }
  /** 无视出牌轮次打出一张手牌，其余结算与 PLAY_CARD 完全一致（含选目标那套校验）。 */
  | {
      type: 'DEBUG_PLAY_CARD'
      player: PlayerId
      instanceId: InstanceId
      targetInstanceId?: InstanceId
    }
  /** 直接结束本轮双方出牌跳到答题阶段，省掉为了看结算连点两次「结束出牌」。 */
  | { type: 'DEBUG_SKIP_TO_QUIZ' }
