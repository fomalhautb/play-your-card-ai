/**
 * 对局演出的全部时长常量，单位毫秒。
 *
 * 数字全部抄自黑客松版客户端——那一版是本层的行为规格：只抄「什么时候发生、
 * 持续多久、按什么顺序」，实现重写。所以每条常量都注明它抄自旧代码的哪个文件哪一行
 *（那份代码已随迁移第 38 条删掉，要看理由去版本历史里翻）。
 * 很多数是被别的数卡住的（比如补牌兜底不能取长），改之前先把那段理由找出来。
 *
 * 单位统一用毫秒，旧代码里是秒（GSAP 的口径）。换算写在各条注释里，别在别处再乘一次 1000。
 *
 * `@ai-duel/design` 里已经有对应令牌的三条直接引令牌，不在这里另存一份：
 * 手牌重排、放大查看进场、放大查看退场。它们同时被牌组编辑等界面用着，
 * 抄一份到这里就会出现两个可以各改各的数。
 */

import { tokens } from '@ai-duel/design'

/** 秒转毫秒。旧代码里的时长全是秒，转换只在这一处发生。 */
const sec = (value: number): number => Math.round(value * 1000)

// ---------- 中央横幅（MatchStage.tsx:194-196） ----------

/** 横幅淡入。 */
const BANNER_IN_MS = sec(0.3)
/** 横幅停留。 */
const BANNER_HOLD_MS = sec(0.75)
/** 横幅淡出。 */
const BANNER_OUT_MS = sec(0.35)
/** 一条横幅从淡入到淡出的总时长，排队时按它算下一条什么时候上。 */
export const BANNER_TOTAL_MS = BANNER_IN_MS + BANNER_HOLD_MS + BANNER_OUT_MS

// ---------- 抛硬币过场（MatchStage.tsx:155-164、时间线 1436-1486） ----------

/** 硬币转多久落定（`COIN_SPIN`）。 */
const COIN_SPIN_MS = sec(1.6)
/** 硬币停稳后停多久再整层淡出（`COIN_HOLD`）。 */
const COIN_HOLD_MS = sec(1.3)
/** 落定那一下的回弹，0.12 秒来回各一次。 */
const COIN_BOUNCE_MS = sec(0.12) * 2
/** 整层淡出。 */
const COIN_FADE_OUT_MS = sec(0.4)
/**
 * 抛硬币这一层从起到收的总时长。
 *
 * 旧代码是一条 GSAP 时间线，各段的先后由 position 参数决定，这里把它算成一个数：
 * 转动（1.6，位置 0，最长的一段）→ 回弹（追加在末尾）→ 停留 → 淡出。
 * 层淡入 0.25 和硬币弹出 0.5 都排在位置 0，被转动盖住，不进总长。
 */
export const COIN_TOSS_TOTAL_MS = COIN_SPIN_MS + COIN_BOUNCE_MS + COIN_HOLD_MS + COIN_FADE_OUT_MS

// ---------- 英雄技能抵消层（MatchStage.tsx:167、时间线 1509-1536） ----------

/** 大字停留多久再整层淡出（`CANCEL_HOLD`）。 */
const CANCEL_HOLD_MS = sec(1.3)
/** 说明那行的起跑点（0.28）加它自己的时长（0.3），是淡出之前最晚收的一段。 */
const CANCEL_BUILD_MS = sec(0.28) + sec(0.3)
/** 整层淡出。 */
const CANCEL_FADE_OUT_MS = sec(0.38)
/** 抵消层从起到收的总时长。 */
export const SKILL_CANCEL_TOTAL_MS = CANCEL_BUILD_MS + CANCEL_HOLD_MS + CANCEL_FADE_OUT_MS

// ---------- 展示层：强制展示与放大查看（MatchStage.tsx:144-151） ----------

/** 展示遮罩淡出（`OVERLAY_OUT_DUR`）。淡入是 0.25，和飞行并行，不影响排期。 */
export const OVERLAY_OUT_MS = sec(0.3)
/**
 * 卡飞到屏幕中央（同时翻正）的时长。旧代码是 `REVEAL_IN_DUR = 0.55`，
 * 和 `CardZoomOverlay` 的 `ZOOM_IN_DUR` 是同一个数，令牌里已经有了。
 */
export const REVEAL_IN_MS = sec(tokens.duration.card.zoomIn)
/** 强制观看的停留时长（`REVEAL_HOLD`）。不可跳过——玩家必须看清对手打的是什么。 */
export const REVEAL_HOLD_MS = sec(1.5)
/**
 * 展示卡飞向战场（或飞回原格）的时长。旧代码是 `REVEAL_OUT_DUR = 0.6`，
 * 同样和 `CardZoomOverlay` 的 `ZOOM_OUT_DUR` 是一个数，用令牌。
 */
export const REVEAL_OUT_MS = sec(tokens.duration.card.zoomOut)
/**
 * 找不到起飞点时的降级进场：从屏幕中央淡入（MatchStage.tsx:2461-2470）。
 * 只有对方的技能牌会走到这条，AI 牌另有简易进场兜底。
 */
export const REVEAL_POP_IN_MS = sec(0.28)
/** 展示的技能牌没有落点时原地淡出（MatchStage.tsx:2424-2432）。 */
export const REVEAL_FADE_OUT_MS = sec(0.32)
/**
 * 强行收掉正在进行的强制展示时，遮罩收多快（MatchStage.tsx:1063 的 `abortReveal`）。
 * 只有答题阶段开始那一处会用到：结算层和展示层同一档，与其让两层打架不如让展示让位。
 */
export const REVEAL_ABORT_MS = sec(0.2)

// ---------- 我方技能牌亮相（MatchStage.tsx:107-114、时间线 1385-1402） ----------

/** 技能牌在中央淡入（0.28，`back.out(1.6)`）。 */
export const SKILL_SHOWCASE_IN_MS = sec(0.28)
/** 无目标的技能牌在中央停留多久（`SKILL_SHOWCASE_HOLD`）。 */
export const SKILL_SHOWCASE_HOLD_MS = sec(1.2)
/** 无目标的技能牌停完淡出（0.32）。 */
export const SKILL_SHOWCASE_OUT_MS = sec(0.32)
/** 有目标的技能牌在中央停留多久再起飞（`SKILL_TARGET_HOLD`）。比无目标那档短一截。 */
export const SKILL_TARGET_HOLD_MS = sec(0.5)
/** 技能牌从展示位飞到目标格（`SKILL_FLIGHT_DUR`）。 */
export const SKILL_FLIGHT_MS = sec(0.42)

// ---------- 落场与格子特效（MatchStage.tsx:129、2286-2294、2322-2328；playSummonFx.ts） ----------

/** 我方 AI 牌从手牌飞到战场格的 Flip 时长（MatchStage.tsx:2288）。 */
export const PLAY_FLIP_MS = sec(0.65)

/**
 * 手上那张牌点问号章翻到背面、以及翻回正面各多久（黑客松 `HandFan.tsx:919,1093-1117`）。
 *
 * 两头不一样长是刻意的：翻过去是"我要看点东西"，慢一点让人跟得上；
 * 翻回来是"看完了"，快一点才不拖沓。
 */
export const HAND_FLIP_MS = sec(0.4)
export const HAND_UNFLIP_MS = sec(0.3)
/** 落地特效（震屏 + 烟尘 + 追光）从落地起还要演多久（`SUMMON_FX_TAIL`）。演出锁挂到这段演完。 */
export const SUMMON_FX_MS = sec(0.8)
/** 对手 AI 牌展示受理不了时的简易进场（MatchStage.tsx:2325）。 */
export const POP_IN_MS = sec(0.4)
/** 技能命中：目标格抖四段（playSummonFx.ts 的 `HIT_SHAKE_STEP` 0.04，末段翻倍）。 */
export const HIT_FX_MS = sec(0.04 * 3 + 0.08)
/** 被技能牌罚下时那张卡沉下去化掉（playSummonFx.ts 的 `REMOVAL_DUR`）。 */
export const REMOVAL_FX_MS = sec(0.45)
/**
 * 进化：弹一下 0.42、绿光 0.7、浮字 0.9 三样同时起，整段按最长的浮字算
 * （playSummonFx.ts 的 `EVOLVE_LABEL_DUR`）。
 */
export const EVOLVE_FX_MS = sec(0.9)
/** 同一批进化之间错开多久（playSummonFx.ts 的 `EVOLVE_STAGGER`）。 */
export const EVOLVE_STAGGER_MS = sec(0.16)

// ---------- 演出锁与闸门的兜底（MatchStage.tsx:141、177、191） ----------

/**
 * 出牌演出锁的兜底解锁（`PLAY_LOCK_FALLBACK`）。
 * 只盖一次联机往返：演出真的起来了就撤掉它，到点还没起来就把锁放开，
 * 退回「出不了牌但还能把牌抬起来看」这个能忍的状态。
 */
export const PLAY_LOCK_FALLBACK_MS = sec(2.5)
/**
 * 开局发牌的兜底放行（`DEAL_HOLD_FALLBACK`）。
 * 只盖「挂载到第一批事件」这一小会儿；正常开局由抛硬币过场的收尾放行。
 */
export const DEAL_HOLD_FALLBACK_MS = sec(0.8)
/**
 * 回合末补牌的兜底放行（`ROUND_DEAL_HOLD_FALLBACK`）。
 *
 * 刻意取短：它一到点就放行，那时结算层要是还立着，牌就跑到遮罩后面去飞了，
 * 正是这条兜底本来要防的事情反过来发生。宁可偶尔早放行也不留大余量。
 */
export const ROUND_DEAL_FALLBACK_MS = sec(2)

// ---------- 发牌（HandFan.tsx:411、fanMath.ts 的 LAYOUT_DUR） ----------

/** 一张牌从卡堆飞到扇形位的时长。和手牌重排共用一个数，令牌里已经有了。 */
export const DEAL_CARD_MS = sec(tokens.duration.hand.layout)
/** 相邻两张牌起飞的间隔（HandFan.tsx 的 `DEAL_STAGGER`）。 */
export const DEAL_STAGGER_MS = sec(0.12)

// ---------- 回合结算层（RoundSettleLayer.tsx:49-143、时间线 294 / 370 / 434 / 660） ----------

/**
 * 结算层入场的总时长（RoundSettleLayer.tsx:327-357）。
 * 四段并行，最晚收的是题目面板：起跑 0.1 加自己的 0.45。
 */
export const SETTLE_OPEN_MS = sec(0.1 + 0.45)
/**
 * 题目亮出来之后留给玩家读题的时间，从整层立起那一刻算起（`QUESTION_READ_HOLD`）。
 * 比服务端自动交卷（2.5 秒）长，主线要等够这一段玩家才来得及把题看完。
 * 等的是「还差多少」而不是「再等四秒」，见 settleTimeline.ts 里的算法。
 */
export const SETTLE_READ_HOLD_MS = sec(4)
/** 一张结果卡淡入（RoundSettleLayer.tsx:393）。 */
export const SETTLE_ROW_IN_MS = sec(0.3)
/** 结果卡逐张淡入的间隔（`CARD_IN_STAGGER`）。 */
export const SETTLE_ROW_STAGGER_MS = sec(0.08)
/** 标准答案面板从左往右擦出来（`ANSWER_REVEAL_DUR`）。 */
export const SETTLE_ANSWER_MS = sec(0.6)
/** 「作答中」转圈淡出（`LOADER_FADE`），淡完才开始打字。 */
export const SETTLE_LOADER_FADE_MS = sec(0.2)
/** 第一张卡开口之前所有卡一起多转这么久（`LOADER_EXTRA_HOLD`），整体后移一拍。 */
export const SETTLE_LOADER_EXTRA_MS = sec(1)
/** 大字答案每打一个字（`TYPE_ANSWER_CHAR_SEC`）。 */
export const SETTLE_ANSWER_CHAR_MS = sec(0.045)
/** 小字推理每打一个字（`TYPE_REASONING_CHAR_SEC`）。 */
export const SETTLE_REASONING_CHAR_MS = sec(0.02)
/** 推理整段最长打这么久（`TYPE_REASONING_MAX`）。不封顶的话一张长推理会把后面所有卡拖住。 */
export const SETTLE_REASONING_MAX_MS = sec(1.2)
/** 相邻两张卡开始作答的间隔下限（`CARD_STAGGER_MIN`），区间内取随机。 */
export const SETTLE_CARD_STAGGER_MIN_MS = sec(0.35)
/** 相邻两张卡开始作答的间隔上限（`CARD_STAGGER_MAX`）。 */
export const SETTLE_CARD_STAGGER_MAX_MS = sec(1.6)
/** 判定章盖下来（`STAMP_DUR`）。 */
export const SETTLE_STAMP_MS = sec(0.28)
/** 相邻两张卡盖章的间隔（`STAMP_STAGGER`）。 */
export const SETTLE_STAMP_STAGGER_MS = sec(0.22)
/**
 * 「正确 x / N」淡入 0.3 与「本轮领先」徽章弹入（延后 0.1 起跑）合起来的一拍
 * （RoundSettleLayer.tsx:571-587）。
 */
export const SETTLE_COUNTS_MS = sec(0.3 + 0.1)
/**
 * 底栏那一拍：消耗 0.3 → 结论 0.4 → 比分脉冲 0.175 来回
 * （RoundSettleLayer.tsx:591-635）。三段首尾相接，加起来是这一条。
 */
export const SETTLE_SCORE_MS = sec(0.3 + 0.4 + 0.35)
/** 确认按钮淡入，落地那一刻才解锁（RoundSettleLayer.tsx:639-648）。 */
export const SETTLE_CONFIRM_MS = sec(0.35)
/** 整层退场（`EXIT_DUR`）。 */
export const SETTLE_EXIT_MS = sec(0.45)
