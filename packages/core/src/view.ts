/**
 * 隐藏信息的唯一过滤点（《正式版架构》需求第 6 条、5.1、6.3）。
 *
 * 规则只在服务端跑，客户端只发指令、只收事件，不持有完整局面。整个系统里只有这个文件
 * 决定"某一方能看到什么"：第 14 条的 protocol 和第 22 条的房间对象照下面这份清单办，
 * 别在别处再补一层过滤，更别绕开它直接下发 `GameState` 或引擎原样发出的事件。
 *
 * ## 对某一方（viewer）遮住的
 *
 * 1. **对手的手牌**：内容和实例 id 都不给，只给张数（`OpponentView.handCount`）。
 *    实例 id 也遮，是因为它是"哪张牌"的把手：给了 id，客户端就能把对手打出的每一张牌
 *    和当初抽牌的那一刻对上号，几轮下来把对手手牌的构成拼出大半。
 *    对手抽牌那一下照样要演（背面朝上飞进手牌），所以 `CARD_DRAWN` 保留、只摘掉 `card`。
 * 2. **双方的牌堆**：顺序和内容都不给，只给张数（`PlayerSideView.deckCount`）。
 *    **自己的牌堆也遮**——下一张抽到什么是这个游戏的悬念，客户端不该有能力提前知道。
 * 3. **本轮及以后的题目**，分四档（见 `QuestionView`）：
 *    - 出牌阶段只公开类别和关键词，题面要等双方出完牌（见 `Question.keywords`）；
 *    - 题面在进答题阶段（`QUESTION_REVEALED`）之后公开；
 *    - 答案和解析要等本轮结算（`ROUND_SCORED`）之后才公开；
 *    - 以后轮次的题一个字都不给，连关键词也不提前给，只从 `totalRounds` 知道还剩几轮。
 * 4. **`GameState.rngSeed`**：拿着它能提前算出「内存紧缺」保留哪一半场上单位，必须遮。
 * 5. **`GameState.seq`**：留着不算泄密（它只是造实例 id 的计数器），视图里照样不给——
 *    实例 id 由服务端造，客户端用不上它，少一个字段就少一处要跟着状态改的东西。
 *
 * ## 公开的（别顺手也遮掉）
 *
 * - 整个卡池 `catalog`：本来就是公开数据（见 types.ts 的 `Catalog`）。
 * - 双方的场上单位，连同身上的 `interference` / `safePassed` / `affectedBy` 这些标记：
 *   技能牌是当着两个人的面打出去的，命中了谁、留下什么效果都得看得见，
 *   否则客户端画不出战场小卡上那排角标。
 * - 双方的弃牌堆：进了弃牌堆的牌都亮过相了——打出去的、答错罚下的、被「模型蒸馏」
 *   从手牌弃掉的那张也一样，它进弃牌堆那一刻就不再是隐藏信息。
 * - 分数、Token、本轮消耗、金钟罩、核电站减免、英雄和技能用没用过、结算确认状态：
 *   界面上本来就双方都看得见。
 *
 * ## 这里挡不住什么
 *
 * 题库是随包发布的公开数据（`content` 的 questions.json）。真想作弊的人拿着整份题库、
 * 照出牌阶段就公开的那几个关键词，反查得到答案。这里遮的是"这一刻该不该给"，
 * 挡不住"自己去翻题库"。要连这条也堵上，得让题库只留在服务端，那是以后的事。
 */

import { other } from './engine'
import type {
  GameEvent,
  GamePhase,
  GameState,
  PlayerId,
  PlayerSideView,
  PlayerState,
  PlayerView,
  PublicQuestion,
  Question,
  QuestionView,
} from './types'

/**
 * 算出某一方能看到的局面快照。纯函数，不改传入的 state。
 *
 * 服务端每执行完一条指令、以及有人重连时都会调它（见《正式版架构》5.2）。
 */
export function viewFor(state: GameState, viewer: PlayerId): PlayerView {
  const self = state.players[viewer]
  const opponent = state.players[other(viewer)]
  return {
    viewer,
    // 目录不拷贝：引擎一个字都不改它，所有对局共用 content 的那一份
    //（同 engine.ts 的 clone）。几十 KB 的卡面文案没必要每次视图都复制一遍。
    catalog: state.catalog,
    round: state.round,
    totalRounds: state.totalRounds,
    firstPlayer: state.firstPlayer,
    activePlayer: state.activePlayer,
    phase: state.phase,
    questions: questionsFor(state),
    self: { ...sideOf(self), hand: copy(self.hand) },
    opponent: { ...sideOf(opponent), handCount: opponent.hand.length },
    winner: state.winner,
    settleConfirmed: [state.settleConfirmed[0], state.settleConfirmed[1]],
  }
}

/**
 * 一条事件对某一方能看到多少：返回裁剪后的事件，整条都不该发给他就返回 null。
 *
 * 用 `switch` 穷举全部事件类型且**不写 default 分支**：新加一种事件时这里会编译不过，
 * 逼着加的人当场决定它对对手公开到什么程度。默认"原样公开"是最容易出事的默认值。
 *
 * 公开的那些直接把原对象返回、不拷贝：事件是只读的一次性产物，
 * 服务端给两个人下发的可以是同一个对象。
 */
export function filterEvent(event: GameEvent, viewer: PlayerId): GameEvent | null {
  switch (event.type) {
    // 抛硬币的结果，双方一起看那段过场。原样公开。
    case 'GAME_STARTED':
      return event
    // 自己抽的牌照实给；对手抽的只留"他多了一张"，牌面和实例 id 都摘掉。
    case 'CARD_DRAWN':
      return event.player === viewer ? event : { type: 'CARD_DRAWN', player: event.player }
    // 手牌被弃掉。原样公开：那张牌已经进了公开的弃牌堆，实例 id 在视图里本来就看得到。
    case 'CARD_REMOVED':
      return event
    // 轮次开始，带的类别和关键词正是出牌阶段就该公开的那两项。原样公开。
    case 'ROUND_STARTED':
      return event
    // 轮到谁出牌。原样公开。
    case 'PLAY_TURN_STARTED':
      return event
    // AI 进场，场上单位是公开的。原样公开。
    case 'AI_DEPLOYED':
      return event
    // 技能牌当着两个人的面打出去，牌面、打出的那张手牌实例、打向谁都得看得见。原样公开。
    case 'SKILL_PLAYED':
      return event
    // 英雄技能抵消了一张技能牌，两边都要演这一下。原样公开。
    case 'SKILL_CANCELED':
      return event
    // 主动英雄技能把场上某个单位换了张脸，场上的事都公开。原样公开。
    case 'HERO_SKILL_USED':
      return event
    // 揭晓题面这一刻答案还不能给：引擎发的是整道题，这里只把公开的那一半转出去。
    case 'QUESTION_REVEALED':
      return { type: 'QUESTION_REVEALED', question: publicQuestionOf(event.question) }
    // 某个 AI 答了什么、对不对，是这个游戏的正戏，两边一起看。原样公开。
    case 'AI_ANSWERED':
      return event
    // 答错罚下。原样公开。
    case 'AI_ELIMINATED':
      return event
    // 答错但被保送留场。原样公开。
    case 'AI_SAFE_PASSED':
      return event
    // 被技能牌清掉。原样公开。
    case 'AI_REMOVED':
      return event
    // 场上单位进化。原样公开。
    case 'AI_TRANSFORMED':
      return event
    // 本轮计分和它的全部判据。原样公开——判据本来就是给双方看"凭什么这一分给了谁"的。
    // 答案不随这条事件下发：结算之后它在视图的 questions 里（见文件头第 3 条），
    // 只留一个出口比两个出口少一处会漏的地方。
    case 'ROUND_SCORED':
      return event
    // 某一方点了确认，另一方要靠它把按钮从"等对方"切走。原样公开。
    case 'ROUND_CONFIRMED':
      return event
    // 终局。原样公开。
    case 'GAME_OVER':
      return event
    // 指令回执，不是局面上发生的事，不进广播（口径见 types.ts 的 COMMAND_REJECTED）。
    // 服务端把它直接回给发指令的那条连接；本地 driver 同理，先把这一条挑出来给发起方，
    // 剩下的再过一遍这个函数。
    case 'COMMAND_REJECTED':
      return null
  }
}

/** 视图里自己和对手共用的那部分（口径见 types.ts 的 `PlayerSideView`）。 */
function sideOf(player: PlayerState): PlayerSideView {
  return {
    id: player.id,
    name: player.name,
    score: player.score,
    // 只设不为空的那一档，和 PlayerState 保持同一套写法：没罩着的一方不带这个字段。
    ...(player.shielded === true ? { shielded: true as const } : {}),
    costReduction: player.costReduction,
    tokens: player.tokens,
    spentThisRound: player.spentThisRound,
    tokenMax: player.tokenMax,
    deckCount: player.deck.length,
    board: copy(player.board),
    discard: copy(player.discard),
    hero: player.hero,
    heroSkillUsed: player.heroSkillUsed,
  }
}

/**
 * 已经开始过的每一轮各给一道题：打过的轮次整题公开，本轮按阶段裁剪，还没轮到的一道都不给。
 *
 * `round` 由引擎推进且不会超过 `totalRounds`（= `questions.length`），所以这里
 * 切到 `round` 就是"最多到本轮为止"。
 */
function questionsFor(state: GameState): QuestionView[] {
  const currentIndex = state.round - 1
  return state.questions
    .slice(0, state.round)
    .map((question, index) =>
      questionView(question, index === currentIndex ? currentReveal(state.phase) : 'answer'),
    )
}

/** 本轮那道题在这个阶段揭晓到哪一步。同样穷举、不写 default。 */
function currentReveal(phase: GamePhase): QuestionView['reveal'] {
  switch (phase) {
    // 出牌阶段：题面还没揭晓，只有类别和关键词。
    case 'play':
      return 'keywords'
    // 答题阶段：题面揭晓了（QUESTION_REVEALED），答案还得等结算。
    case 'quiz':
      return 'text'
    // 分已经算完写进快照（ROUND_SCORED 发过了），答案和解析这才公开。
    // finished 是最后一轮结算完的收场，同一档。
    case 'settle':
    case 'finished':
      return 'answer'
  }
}

/** 按揭晓程度裁一道题。关键词数组拷一份，免得改视图连带改到题库。 */
function questionView(question: Question, reveal: QuestionView['reveal']): QuestionView {
  switch (reveal) {
    case 'keywords':
      return { reveal, category: question.category, keywords: question.keywords.slice() }
    case 'text':
      return {
        reveal,
        id: question.id,
        category: question.category,
        text: question.text,
        keywords: question.keywords.slice(),
      }
    case 'answer':
      return { reveal, ...question, keywords: question.keywords.slice() }
  }
}

/** 摘出一道题公开的那一半，答案和解析留下。 */
function publicQuestionOf(question: Question | PublicQuestion): PublicQuestion {
  return {
    id: question.id,
    category: question.category,
    text: question.text,
    keywords: question.keywords.slice(),
  }
}

/**
 * JSON 深拷贝，理由同 engine.ts 的 clone：视图是一份快照，改它不该改到状态；
 * 顺带钉死"视图必须可 JSON 序列化"这条（它是要走网络的）。
 */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
