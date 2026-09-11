/**
 * 教学对战的步骤表：一张纯数据的状态清单，照规格 §17 排。
 *
 * 从旧版 `legacy-client/src/tutorial/steps.ts` 原样搬过来（形状在 stepTypes.ts、
 * 推进那几条纯函数在 machine.ts，拆成三份是被 400 行那条上限逼的）。
 *
 * 推进这张表的是 `useTutorial`（controller.ts），它把三路输入喂进来：
 * 引擎事件（`DuelStage` 在 `director.push` 之前多转一份）、舞台演出信号
 *（`DuelScene.onTutorialCue`，也就是编排层那条 `tutorial` cue）、以及玩家点击。
 * 纯讲解的那几步一律等玩家点一下才走，不自己跳——玩家读一句话的快慢差得很远，
 * 定时推进只会有人没读完就被翻页、有人读完了干等着。
 */

import type { MatchStageCue } from '@ai-duel/canvas'
import type { CardId, GameEvent } from '@ai-duel/core'
import { TUTORIAL_CARDS } from './content'
import type {
  TutorialAdvanceSignal,
  TutorialAnchorName,
  TutorialHighlight,
  TutorialSignal,
  TutorialStep,
  TutorialStepId,
} from './stepTypes'

const cue = (name: MatchStageCue): TutorialAdvanceSignal => ({ kind: 'cue', cue: name })
const delay = (ms: number): TutorialSignal => ({ kind: 'delay', ms })
/** 等玩家点一下屏幕或「下一步」按钮。纯讲解的步骤全用它。 */
const tap = (): TutorialAdvanceSignal => ({ kind: 'tap' })
const onEvent = (type: GameEvent['type'], by?: 'me' | 'foe'): TutorialAdvanceSignal => ({
  kind: 'event',
  event: by === undefined ? { type } : { type, by },
})
const anchor = (name: TutorialAnchorName): TutorialHighlight => ({ kind: 'anchor', name })
const card = (cardId: CardId): TutorialHighlight => ({ kind: 'card', cardId })

/**
 * 步骤表本体。顺序就是流程顺序，`next` 写成显式字段而不是「下一条」，
 * 是为了将来插分支（比如加赛）时不用重排数组。
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  // ---------- 阶段一：开局抽牌（规格 §4） ----------
  {
    id: 'TUTORIAL_INITIAL_DRAW',
    // 等发牌落地 + 开场那两条横幅播完：抛硬币和横幅都盖在提示上面。
    readyOn: [cue('deal-done'), cue('round-banner-done')],
    instruction: '这是你的手牌。你的牌组共 20 张，开局抽 5 张。',
    highlight: [anchor('hand')],
    advance: tap(),
    next: 'TUTORIAL_R1_KEYWORD',
  },

  // ---------- 第 1 轮：最基本的出牌循环（规格 §5） ----------
  {
    id: 'TUTORIAL_R1_KEYWORD',
    instruction: '正式题目还没揭晓。先根据题型判断该派谁上场。',
    highlight: [anchor('questionCategoryPanel')],
    advance: tap(),
    next: 'TUTORIAL_R1_PLAY_AI',
  },
  {
    id: 'TUTORIAL_R1_PLAY_AI',
    instruction: '这次先派它——打出 AI 牌会消耗 Token。',
    highlight: [card(TUTORIAL_CARDS.firstAi), anchor('tokenCounter')],
    allow: {
      playableCards: [TUTORIAL_CARDS.firstAi],
      blockTip: '教学第 1 轮：先打出高亮的那张 AI 牌',
      endPlay: false,
    },
    advance: onEvent('AI_DEPLOYED', 'me'),
    next: 'TUTORIAL_R1_STAY',
  },
  {
    id: 'TUTORIAL_R1_STAY',
    // 等上场那段飞行和落地特效演完再说话，否则提示会压在正在冒烟的那张小卡上。
    readyOn: [delay(1600)],
    instruction: 'AI 牌上场后会留在场上，直到它答错题目。',
    highlight: [anchor('battlefieldMine')],
    advance: tap(),
    next: 'TUTORIAL_R1_END_PLAY',
  },
  {
    id: 'TUTORIAL_R1_END_PLAY',
    instruction: '准备好了，结束出牌。',
    highlight: [anchor('endTurnButton')],
    allow: {
      playableCards: [],
      blockTip: '这一轮的牌已经出完了，点「结束出牌」继续',
      endPlay: true,
    },
    advance: onEvent('PLAY_TURN_STARTED', 'foe'),
    next: 'TUTORIAL_R1_REVEAL',
  },
  {
    id: 'TUTORIAL_R1_REVEAL',
    // 这句话趁对手还没动手时说：对手的出牌演出也是全屏过场，一上来提示就看不见了。
    instruction: '双方都结束出牌后，完整题目才会揭晓。',
    highlight: [anchor('battlefieldFoe')],
    advance: tap(),
    next: 'TUTORIAL_R1_FOE_PLAY',
  },
  {
    id: 'TUTORIAL_R1_FOE_PLAY',
    instruction: null,
    releaseFoe: true,
    // 最后一张牌落场就先把对手脚本挡住，别让它紧接着结束出牌、直接盖出答题层。
    advance: onEvent('AI_DEPLOYED', 'foe'),
    next: 'TUTORIAL_R1_FOE_DONE',
  },
  {
    id: 'TUTORIAL_R1_FOE_DONE',
    instruction: '对方已经打完这一轮的牌，双方出牌结束。接下来，场上的 AI 将进入答题环节。',
    highlight: [anchor('battlefieldMine'), anchor('battlefieldFoe')],
    advance: tap(),
    next: 'TUTORIAL_R1_ANSWER',
  },
  {
    id: 'TUTORIAL_R1_ANSWER',
    instruction: null,
    // 玩家确认后重新放开脚本：对手这时只剩「结束出牌」，发出后才会进入答题。
    releaseFoe: true,
    advance: cue('quiz-rows-done'),
    next: 'TUTORIAL_R1_SCORE',
  },
  {
    id: 'TUTORIAL_R1_SCORE',
    // 比分先在揭晓层里亮一次，等那层退场、下一轮的横幅也播完，再指着顶栏说一遍为什么。
    readyOn: [cue('quiz-score-shown'), cue('round-banner-done')],
    instruction: '只有你答对，这一分属于你。',
    highlight: [anchor('scoreBoard')],
    advance: tap(),
    next: 'TUTORIAL_R2_REFRESH',
  },

  // ---------- 第 2 轮：留场、Token 成长、抽牌（规格 §6） ----------
  {
    id: 'TUTORIAL_R2_REFRESH',
    instruction: '上一轮答对的 AI 还在场上，它会自动参加这一轮，不需要重新付 Token。',
    highlight: [anchor('battlefieldMine')],
    advance: tap(),
    next: 'TUTORIAL_R2_TOKEN',
  },
  {
    id: 'TUTORIAL_R2_TOKEN',
    instruction: '每轮结束后 Token 会恢复，并且下一轮上限 +1。',
    highlight: [anchor('tokenCounter')],
    advance: tap(),
    next: 'TUTORIAL_R2_DRAW',
  },
  {
    id: 'TUTORIAL_R2_DRAW',
    instruction: '从第 2 轮开始，每轮抽 2 张牌。',
    highlight: [anchor('hand')],
    advance: tap(),
    next: 'TUTORIAL_R2_FOE_PLAY',
  },

  // ---------- 第 2 轮：技能牌真的会改结果（规格 §7 / §8） ----------
  {
    id: 'TUTORIAL_R2_FOE_PLAY',
    // 本轮对手先手：先让它派出新 AI，玩家的干扰技能才有目标（规格 §7）。
    instruction: null,
    releaseFoe: true,
    advance: onEvent('PLAY_TURN_STARTED', 'me'),
    next: 'TUTORIAL_R2_SKILL',
  },
  {
    id: 'TUTORIAL_R2_SKILL',
    instruction: '除了派 AI，你还可以使用技能干扰对手——这次就用这张。',
    highlight: [card(TUTORIAL_CARDS.skill), anchor('battlefieldFoe')],
    allow: {
      playableCards: [TUTORIAL_CARDS.skill],
      blockTip: '先用高亮的技能牌干扰对手刚上场的 AI',
      endPlay: false,
    },
    advance: onEvent('SKILL_PLAYED', 'me'),
    next: 'TUTORIAL_R2_SKILL_HIT',
  },
  {
    id: 'TUTORIAL_R2_SKILL_HIT',
    readyOn: [cue('skill-hit')],
    // 这句只说「生效了」，不剧透它会答成什么样：那一下留到揭晓时自己演，
    // 玩家看见对手张口就是「香蕉」，比先讲一遍再看一遍有力得多。
    instruction: '技能牌使用后立即生效，它这一轮已经被干扰了。',
    highlight: [anchor('battlefieldFoe')],
    advance: tap(),
    next: 'TUTORIAL_R2_PLAY',
  },
  {
    id: 'TUTORIAL_R2_PLAY',
    // 这一轮不放行任何增派的 AI（optionalAi 是空的），所以这一步只剩「结束出牌」一个动作。
    // 不是付不起：打完 4 费的复读机还剩 2 点，卡池里最便宜的 AI 正好 2 费。
    // 是这一课要教的是「技能真的会改结果」，同一步里再塞一个可选动作会把注意力引开
    //（原委见 TUTORIAL_CARDS.optionalAi）。
    // optionalAi 将来填回牌时，这里的文案和 highlight 要一起改回「你也可以再派一张」。
    instruction: '场上的 AI 会继续作答，这一轮不用再派新的。',
    highlight: [...TUTORIAL_CARDS.optionalAi.map(card), anchor('endTurnButton')],
    allow: {
      playableCards: [...TUTORIAL_CARDS.optionalAi],
      blockTip: '这一轮的牌已经打完了，直接结束出牌',
      endPlay: true,
    },
    advance: cue('quiz-open'),
    next: 'TUTORIAL_R2_REVEAL',
  },
  {
    id: 'TUTORIAL_R2_REVEAL',
    instruction: null,
    advance: cue('quiz-score-shown'),
    next: 'TUTORIAL_R2_SCORE',
  },
  {
    id: 'TUTORIAL_R2_SCORE',
    readyOn: [cue('round-banner-done')],
    instruction: '被干扰的 AI 只会回答「香蕉」，它答错了——这一分又是你的。',
    highlight: [anchor('scoreBoard')],
    advance: tap(),
    next: 'TUTORIAL_R2_TOKEN_RULE',
  },
  {
    id: 'TUTORIAL_R2_TOKEN_RULE',
    // 「答对数相同才比 Token」这条规则只讲不演：三轮双方答对数都不同，教学局排不出一个
    // 自然的平局，硬凑一轮会把第 3 轮那个放手轮改得别扭（玩家花多少 Token 是不可控的）。
    // 讲的时机挑在这里，是因为玩家刚看完一轮完整结算，脑子里还装着「这一分凭什么给谁」。
    // 真遇上平局时结算层自己会把判定理由和双方消耗写出来（见 canvas 的 SettleLayer）。
    instruction: '只有双方答对的 AI 数量一样，才比这一轮消耗的 Token，少的一方得分。',
    highlight: [anchor('tokenCounter')],
    advance: tap(),
    next: 'TUTORIAL_R3_FREE_PLAY',
  },

  // ---------- 第 3 轮：放手（规格 §9） ----------
  {
    id: 'TUTORIAL_R3_FREE_PLAY',
    readyOn: [cue('deal-done'), cue('round-banner-done')],
    instruction: '现在由你决定这一轮怎么出牌。',
    // 不压暗、不指哪张牌：这一轮要验证玩家自己能走完一整轮（规格 §9）。
    dim: false,
    allow: { playableCards: null, blockTip: '', endPlay: true },
    releaseFoe: true,
    idleHint: { afterMs: 12000, highlight: [anchor('hand'), anchor('endTurnButton')] },
    advance: cue('quiz-open'),
    next: 'TUTORIAL_R3_REVEAL',
  },
  {
    id: 'TUTORIAL_R3_REVEAL',
    instruction: null,
    advance: cue('quiz-score-shown'),
    next: 'TUTORIAL_R3_SCORE',
  },
  {
    id: 'TUTORIAL_R3_SCORE',
    // 终局的结算页会在揭晓层退场后自己盖上来，这里不再多说一句。
    instruction: null,
    advance: cue('quiz-closed'),
    next: 'TUTORIAL_VICTORY',
  },
  {
    id: 'TUTORIAL_VICTORY',
    instruction: null,
    next: null,
  },
]

/** 步骤表的第一步。 */
export const TUTORIAL_FIRST_STEP: TutorialStepId = 'TUTORIAL_INITIAL_DRAW'

const STEP_BY_ID = new Map(TUTORIAL_STEPS.map((step) => [step.id, step]))

/** 按 id 取一步。取不到说明步骤表里的 next 写错了，直接抛错。 */
export function tutorialStep(id: TutorialStepId): TutorialStep {
  const step = STEP_BY_ID.get(id)
  if (step === undefined) throw new Error(`步骤表里没有这一步：${id}`)
  return step
}
