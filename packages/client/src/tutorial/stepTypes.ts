/**
 * 教学对战步骤表的形状：一步长什么样、它等哪种信号、这一步放行玩家做什么。
 *
 * 从旧版 `legacy-client/src/tutorial/steps.ts` 拆出来的前半段（那份 542 行，超了 400 行上限）。
 * 表本体在 steps.ts，推进那几条纯函数在 machine.ts。
 *
 * 教程是一台状态机，**不依赖任何屏幕坐标**：每一步只说「高亮哪个语义元素、
 * 现在允许玩家做什么、等哪个信号就往下走」。界面改版时只要那几个语义锚点还在，
 * 那张表一行都不用动。
 *
 * 和旧版唯一的出入是锚点：旧版的 `TutorialAnchorName` 是一串 `data-tutorial-anchor`
 * 属性名，靠 `document.querySelector` 找 DOM；新版对局整页画在画布上，DOM 里一个元素都没有，
 * 所以改成**问场景要矩形**（`DuelScene.anchorRect`），名字沿用同一批语义锚点。
 */

import type { DuelAnchorName, MatchStageCue } from '@ai-duel/canvas'
import type { CardId, GameEvent } from '@ai-duel/core'

/**
 * 步骤 id。前 17 个照规格 §17 的清单，另外几个是把规格里「一步说两句话」的地方拆开
 * ——每一步只解释一个概念，而且每一句提示都要单独等一个演出信号才敢出场。
 */
export type TutorialStepId =
  | 'TUTORIAL_INITIAL_DRAW'
  | 'TUTORIAL_R1_KEYWORD'
  | 'TUTORIAL_R1_PLAY_AI'
  /** 拆自 Step 03 的第二句：AI 牌会留场。 */
  | 'TUTORIAL_R1_STAY'
  | 'TUTORIAL_R1_END_PLAY'
  | 'TUTORIAL_R1_REVEAL'
  /** 拆出来的过渡态：放行对手脚本，等它出完牌进答题。 */
  | 'TUTORIAL_R1_FOE_PLAY'
  /** 对手最后一张牌已经落场，等玩家确认后才结束出牌并进入答题。 */
  | 'TUTORIAL_R1_FOE_DONE'
  | 'TUTORIAL_R1_ANSWER'
  | 'TUTORIAL_R1_SCORE'
  | 'TUTORIAL_R2_REFRESH'
  /** 拆自 Step 09：Token 恢复与上限成长单独说一句。 */
  | 'TUTORIAL_R2_TOKEN'
  | 'TUTORIAL_R2_DRAW'
  /** 拆出来的过渡态：本轮对手先手，放行它派出新 AI，玩家的干扰技能才有目标。 */
  | 'TUTORIAL_R2_FOE_PLAY'
  | 'TUTORIAL_R2_SKILL'
  /** 拆自 Step 12 的收尾：技能命中之后那句「立即生效」。 */
  | 'TUTORIAL_R2_SKILL_HIT'
  | 'TUTORIAL_R2_PLAY'
  | 'TUTORIAL_R2_REVEAL'
  | 'TUTORIAL_R2_SCORE'
  /** 「同结果就比 Token」那条规则：教学局排不出一个自然的平局，所以只讲不演。 */
  | 'TUTORIAL_R2_TOKEN_RULE'
  | 'TUTORIAL_R3_FREE_PLAY'
  | 'TUTORIAL_R3_REVEAL'
  | 'TUTORIAL_R3_SCORE'
  | 'TUTORIAL_VICTORY'

/**
 * 教程认得的语义锚点。
 *
 * 直接用画布那边的名单：能不能圈出一块地方由场景说了算（`DuelScene.anchorRect`），
 * 这里再抄一份同名的联合类型只会出现「表里写了一个场景答不上来的名字」这种错。
 */
export type TutorialAnchorName = DuelAnchorName

/**
 * 一个高亮目标。手牌那一档按**卡牌定义 id** 写，控制器再从局面里把它换算成实例 id
 * ——实例 id 取决于发牌顺序，写进步骤表太脆。
 */
export type TutorialHighlight =
  | { kind: 'anchor'; name: TutorialAnchorName }
  | { kind: 'card'; cardId: CardId }

/** 事件信号：`by` 不填就是不分敌我。 */
export interface TutorialEventSignal {
  type: GameEvent['type']
  by?: 'me' | 'foe'
}

/**
 * 一个「什么时候算数」的信号。
 *
 * `delay` 只用在 readyOn 上，从进入这一步那一刻起算——它等的是一段没有收尾信号的演出。
 * 推进（advance）一律不用 delay：讲解步骤等 `tap`（玩家点一下），其余等对局流程或演出信号。
 */
export type TutorialSignal =
  | { kind: 'cue'; cue: MatchStageCue }
  | { kind: 'event'; event: TutorialEventSignal }
  | { kind: 'delay'; ms: number }
  | { kind: 'tap' }

/**
 * 能当推进条件用的信号：把 `delay` 排除在外，从类型上钉死「讲解步骤不会自己跳」。
 * 想加一步纯讲解就写 `advance: tap()`。
 */
export type TutorialAdvanceSignal = Exclude<TutorialSignal, { kind: 'delay' }>

/** 这一步玩家能做什么（规格 §15）。 */
export interface TutorialAllowance {
  /** 只有这些卡牌定义 id 的手牌打得出去；null = 不限制（第 3 轮放手）。 */
  playableCards: CardId[] | null
  /** 被锁住的那些手牌点上去弹哪句话。锁必须有话说，否则玩家只会觉得界面坏了。 */
  blockTip: string
  /** 「结束出牌」按钮能不能点。 */
  endPlay: boolean
}

export interface TutorialStep {
  id: TutorialStepId
  /**
   * 这些信号全部到齐，这一步的提示才出场（不填 = 进入即出场）。
   *
   * 存在的理由只有一个：提示压在画布上面，而全屏过场（抛硬币、答题揭晓、技能抵消）
   * 是画在画布里的、盖住整个战场。所以凡是紧接在一段过场后面的提示，
   * 都要等那段过场的收尾信号，否则它会说在一片遮罩上。
   */
  readyOn?: TutorialSignal[]
  /** 一句话提示。null = 这一步不出提示（纯粹在等一段演出走完的过渡态）。 */
  instruction: string | null
  /** 要挖洞高亮的元素。空 / 不填 = 只压暗不挖洞。 */
  highlight?: TutorialHighlight[]
  /** 压暗无关区域，默认 true。第 3 轮的弱引导不压暗（规格 §9）。 */
  dim?: boolean
  /** 玩家能做什么。不填 = 什么都不许做（过渡态，界面本来多半也锁着）。 */
  allow?: TutorialAllowance
  /**
   * 放行对手脚本。默认挡着——对手的出牌演出是全屏过场，
   * 不挡的话第 2 轮它会在教程还没讲完的时候直接盖上来（见 tutorialDriver.setFoeHold）。
   */
  releaseFoe?: boolean
  /** 规格 §9 的弱引导：玩家长时间没动作才轻微高亮这几处，不压暗也不弹规则。 */
  idleHint?: { afterMs: number; highlight: TutorialHighlight[] }
  /** 满足它就进入 next。next 为 null 的终点步不填。 */
  advance?: TutorialAdvanceSignal
  next: TutorialStepId | null
}
