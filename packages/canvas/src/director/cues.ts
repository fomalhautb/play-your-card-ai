/**
 * 演出指令（cue）：编排层唯一的产出。
 *
 * 一条 cue 就是「在虚拟时钟的第 `at` 毫秒，播一段 `durationMs` 毫秒的什么」。
 * 渲染器照着放，**不回调编排层**——旧版靠 GSAP 的 `onComplete` 把下一段串起来，
 * 那让「现在演到哪儿」散在十几个回调里，测不了也读不懂。这里改成：
 * 编排层自己知道每段多长，播完之后该发生什么由它在虚拟时钟上排好期。
 *
 * `durationMs` 为 0 表示「瞬时切换」：它不占时间，只是通知渲染器换一个状态
 *（上锁 / 解锁、教程信号、拒绝提示）。
 *
 * 一种演出一种 kind，不复用。加一种演出就在这里加一条，别往现有的载荷里塞开关——
 * 快照测试是一行一条 cue 读的，开关字段会让「这一下到底演了什么」看不出来。
 */

import type {
  CardId,
  HeroId,
  InstanceId,
  PlayerId,
  PublicQuestion,
  RoundVerdict,
} from '@ai-duel/core'

/**
 * 舞台演出信号：对局界面里那几段「演完了」的时刻，教程的每一句提示都挂在其中一个上。
 *
 * 原样抄自旧版 `legacy-client/src/ui/matchStageTutorial.ts` 的 `MatchStageCue`，
 * 教程状态机本身还没迁（迁移第 32 条），这里只负责把这七个信号按原来的时机发出来。
 * 加新信号之前先问一句「哪一步在等它」，没有答案就别加。
 */
export type MatchStageCue =
  /** 发牌动画全部落地（开局那 5 张，或者每轮结算后补的 2 张）。 */
  | 'deal-done'
  /** 中央横幅队列播空（「第 N 轮」「轮到你出牌」这一串）。 */
  | 'round-banner-done'
  /** 答题揭晓层立起来了，题面已经在屏幕上。 */
  | 'quiz-open'
  /** 揭晓层里的答题结果逐条亮完。 */
  | 'quiz-rows-done'
  /** 揭晓层里的本轮比分亮出来了。 */
  | 'quiz-score-shown'
  /** 揭晓层整层退场完毕，战场重新露出来。 */
  | 'quiz-closed'
  /** 我方技能牌飞到目标格、命中特效播完。 */
  | 'skill-hit'

/** 演出锁是被哪条链路拿走的。只用来读日志和快照，编排层自己按编号认锁。 */
export type LockReason =
  /** 我方出牌（AI 牌飞向战场 / 技能牌中央亮相），带兜底解锁。 */
  | 'play'
  /** 对手的牌展示完飞向战场并落地。 */
  | 'reveal-land'
  /** 放大查看关掉之后飞回原格。 */
  | 'inspect-return'

/** 我方 / 对方两个数一组。事件里成对的字段按座位号排，进 cue 之前先换算成这个。 */
export interface CueSides {
  mine: number
  theirs: number
}

/**
 * 一条演出指令去掉 `at` 之后的样子。编排层内部按它构造，`at` 由虚拟时钟统一补上。
 */
export type CueSpec =
  // ---------- 中央横幅与全屏过场 ----------
  /** 中央横幅一条（第几轮、该谁出牌、英雄技能、鸡犬升天的总结）。 */
  | { kind: 'banner'; durationMs: number; text: string }
  /** 开局抛硬币定先手。`mineFirst` 决定硬币停在正面还是背面。 */
  | { kind: 'coin-toss'; durationMs: number; firstPlayer: PlayerId; mineFirst: boolean }
  /** 英雄技能抵消层：大字技能名 + 一行「谁抵消了谁的哪张牌」。 */
  | { kind: 'skill-cancel'; durationMs: number; heroId: HeroId; title: string; text: string }

  // ---------- 展示层：对手出牌的强制展示 ----------
  /**
   * 对手的牌从他手里飞到屏幕中央并翻正。
   * `fromOrigin` 为 false 是降级路径：找不到起飞的那张手牌，改成从中央淡入。
   */
  | {
      kind: 'reveal-enter'
      durationMs: number
      cardId: CardId
      handInstanceId: InstanceId
      cardKind: 'ai' | 'skill'
      fromOrigin: boolean
    }
  /** 强制观看的停留，不可跳过。停留期间卡有一条上下浮动。 */
  | { kind: 'reveal-hold'; durationMs: number }
  /** 展示位的 AI 牌接着飞到对方战场行。 */
  | { kind: 'reveal-land'; durationMs: number; instanceId: InstanceId }
  /** 展示位的技能牌没有落点，原地淡出。 */
  | { kind: 'reveal-fade'; durationMs: number }
  /**
   * 强行收掉正在进行的强制展示，不播收尾（只有答题阶段开始那一处会发）。
   * 卡直接消失，遮罩自己淡掉——展示要停 1.5 秒，等不起。
   */
  | { kind: 'reveal-abort'; durationMs: number }

  // ---------- 展示层：玩家自己点开的放大查看 ----------
  /** 战场小卡或侧栏英雄牌飞到屏幕中央放大。 */
  | { kind: 'inspect-enter'; durationMs: number; source: 'tile' | 'hero'; flipId: string }
  /** 放大查看关掉，卡飞回原来的位置。 */
  | { kind: 'inspect-exit'; durationMs: number; source: 'tile' | 'hero'; flipId: string }

  // ---------- 出牌 ----------
  /** 我方 AI 牌从手牌飞到战场格。 */
  | { kind: 'play-flip'; durationMs: number; instanceId: InstanceId }
  /**
   * 我方技能牌在中央亮相。
   * 有目标时 `durationMs` 只到起飞那一刻，后面接 `skill-fly`；无目标时含淡出。
   */
  | {
      kind: 'skill-showcase'
      durationMs: number
      cardId: CardId
      targetInstanceId: InstanceId | null
    }
  /** 技能牌从展示位飞向目标格。`from` 区分是我方亮相还是对手的强制展示接过来的。 */
  | {
      kind: 'skill-fly'
      durationMs: number
      from: 'showcase' | 'reveal'
      cardId: CardId
      targetInstanceId: InstanceId
    }
  /** 命中特效：目标格抖一下 + 边缘追光。技能命中和主动英雄技能换卡共用。 */
  | { kind: 'hit-fx'; durationMs: number; instanceId: InstanceId }
  /** 上场落地特效：震屏 + 烟尘 + 追光。我方出牌和对手的牌落场共用同一段。 */
  | { kind: 'summon-fx'; durationMs: number; instanceId: InstanceId }
  /** 对手 AI 牌的简易进场：强制展示受理不了时的降级路径。 */
  | { kind: 'pop-in'; durationMs: number; instanceId: InstanceId }

  // ---------- 场上单位 ----------
  /** 被技能牌罚下（内存紧缺 / 国产替代）：那张小卡沉下去化掉。 */
  | { kind: 'removal-fx'; durationMs: number; instanceId: InstanceId; cardId: CardId; by: CardId }
  /** 进化（鸡犬升天）：弹一下 + 绿光 + 「↑ 升级」浮字。 */
  | {
      kind: 'evolve-fx'
      durationMs: number
      instanceId: InstanceId
      fromCardId: CardId
      toCardId: CardId
    }

  // ---------- 手牌 ----------
  /**
   * 一批牌从卡堆飞进扇形（开局 5 张、每轮补 2 张）。
   * `durationMs` 已经把逐张错开的时间算进去了，渲染器只管按 `count` 张排。
   */
  | { kind: 'deal'; durationMs: number; side: 'self' | 'opponent'; count: number }

  // ---------- 回合结算层 ----------
  /** 结算层立起来：题面亮出，双方的结果卡位摆好。 */
  | {
      kind: 'settle-open'
      durationMs: number
      round: number
      question: PublicQuestion
      scoresBefore: CueSides
    }
  /** 结算层里新增一张结果卡（一条 `AI_ANSWERED` 一张），先只有卡名和「作答中」转圈。 */
  | {
      kind: 'settle-row'
      durationMs: number
      instanceId: InstanceId
      cardId: CardId
      mine: boolean
      correct: boolean
    }
  /** 标准答案面板从左往右擦出来。答案在本轮结算之后才公开，从视图里取。 */
  | { kind: 'settle-answer'; durationMs: number; answer: string; explanation: string }
  /** 一张结果卡开口作答：转圈淡出 → 大字答案打字 → 小字推理打字。 */
  | {
      kind: 'settle-typing'
      durationMs: number
      instanceId: InstanceId
      answer: string
      reasoning: string
    }
  /** 一张结果卡盖判定章。`safePassed` 为真时紧接着还要补一枚「保送留场」。 */
  | {
      kind: 'settle-stamp'
      durationMs: number
      instanceId: InstanceId
      correct: boolean
      safePassed: boolean
    }
  /** 两侧标头的「正确 x / N」淡入，「本轮领先」徽章弹一下。 */
  | { kind: 'settle-counts'; durationMs: number; correctCounts: CueSides }
  /** 底栏：先交代消耗，再落下结论，最后顶栏比分才跳。 */
  | {
      kind: 'settle-score'
      durationMs: number
      gains: CueSides
      totals: CueSides
      spent: CueSides
      verdict: RoundVerdict
    }
  /** 确认按钮淡入，落地那一刻才解锁。 */
  | { kind: 'settle-confirm'; durationMs: number }
  /** 整层退场，战场重新露出来。 */
  | { kind: 'settle-exit'; durationMs: number }

  // ---------- 演出锁 ----------
  /**
   * 上一把演出锁：手牌整个冻住、「结束出牌」也按不动，直到同编号的 `lock-release`。
   * 编号是为了认账：兜底先到点放了锁、玩家又打出下一张牌时，
   * 迟到的那条收尾放掉的会是别人的锁。
   */
  | { kind: 'lock-acquire'; durationMs: number; token: number; reason: LockReason }
  /** 演出收尾，把手牌和「结束出牌」放开。 */
  | { kind: 'lock-release'; durationMs: number; token: number }

  // ---------- 提示 ----------
  /** 「催一催」的喊话气泡。本端点的和对面发来的走同一条路，两台机器上弹的是同一句。 */
  | { kind: 'urge'; durationMs: number; lineId: string }
  /**
   * 指令被拒的红字提示。
   * 旧版是常驻文案（跟着 `MatchView.lastRejection` 挂到下一条指令有结果），
   * 所以这里 `durationMs` 记 0：立刻上，由后续覆盖。
   */
  | { kind: 'error'; durationMs: number; reason: string }
  /** 教程要等的舞台信号，见 MatchStageCue。 */
  | { kind: 'tutorial'; durationMs: number; cue: MatchStageCue }
  /**
   * 一次性清场：把所有还立着的过场层（抛硬币、结算、抵消、展示）当场收掉。
   * 只有对局中断（对手断线）会发——那时结算层再也等不到对方确认，
   * 留着就是一层退不掉的遮罩，玩家会被挡死。
   */
  | { kind: 'clear-overlays'; durationMs: number }

/** 带上虚拟时刻的演出指令。`drain()` 返回的就是它，按 `at` 升序。 */
export type Cue = CueSpec & { at: number }
