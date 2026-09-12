/**
 * 引擎单元测试（`engine*.test.ts` 那一组）共用的夹具：开一局、把局面推到某个样子、
 * 造牌摆场、凑一份答题结果。
 *
 * 和同目录下 `randomPlay.ts` / `commandPool.ts` 那套的分工：那两份是给属性测试和 golden
 * 用的**随机走局器**，只挑合法指令、一路打到分出胜负；这一份是给单元测试用的**摆盘工具**，
 * 一条规则一个用例，局面靠调试指令精确摆到位。
 *
 * 这里只放**跨文件**用得上的。某个夹具只有一节用例需要（比如「摆一个乙场上两个 AI 的局面」），
 * 就留在那个 `describe` 里面，别往这儿搬——搬过来只会让人读一条用例要跳两个文件。
 */

import { BALANCED_DECK, createCatalog, QUESTION_POOL } from '@ai-duel/content'
import type {
  AnswerResult,
  CardId,
  Command,
  GameEvent,
  GameState,
  HeroId,
  InstanceId,
  PlayerId,
  Question,
} from '../../src/index'
import { createGame, execute, other } from '../../src/index'

/**
 * 这一整套测试打的都是真实卡牌，所以要一份真实目录（core 自己不带数据，见 src/cards.ts 的
 * Catalog）。目录是只读的，一份全局共用就够，不必每局新建。
 */
export const CATALOG = createCatalog()

/**
 * 先手是抛硬币掷出来的，测试里要能指定谁先手，这两个种子就是查出来的现成答案。
 * 换掉引擎里的随机数生成器或调整 createGame 里取随机数的顺序，这两个常量都要重查。
 */
export const SEED_FIRST_0 = 2
export const SEED_FIRST_1 = 1

interface NewGameOptions {
  seed?: number
  deck0?: CardId[]
  deck1?: CardId[]
  /** 只想打一两轮就见到 GAME_OVER 时，塞一份短题库。 */
  questions?: Question[]
  /** 不填就是默认英雄（格蕾丝·霍珀）；传 null 是这一方不带英雄。 */
  hero0?: HeroId | null
  hero1?: HeroId | null
  /** 直接指定第一轮先手，不掷硬币（比挑种子好使，见 GameSetup.firstPlayer）。 */
  firstPlayer?: PlayerId
  /** 牌组和题库都按传入顺序原样使用，不洗（见 GameSetup.noShuffle）。 */
  noShuffle?: boolean
}

/**
 * 开一局。默认 0 号玩家先手。
 * 洗牌是随机的，所以想测某张卡时就给该玩家一副单卡牌组，
 * 这样"手上一定有这张卡"是规则保证的，不靠种子碰运气。
 */
export function newGame(options: NewGameOptions = {}) {
  return createGame({
    seed: options.seed ?? SEED_FIRST_0,
    catalog: CATALOG,
    questionPool: QUESTION_POOL,
    players: [
      // hero 只在显式传了的时候才带上：不传才走 createGame 里的默认英雄，
      // 而这条默认路径正是联机和测试房实际走的那条。
      { name: '甲', deck: [...(options.deck0 ?? BALANCED_DECK)], ...heroOf(options.hero0) },
      { name: '乙', deck: [...(options.deck1 ?? BALANCED_DECK)], ...heroOf(options.hero1) },
    ],
    questions: options.questions,
    // 这两项都是可选覆盖，不传就一个字段都不出现（exactOptionalPropertyTypes 打开着）。
    ...(options.firstPlayer === undefined ? {} : { firstPlayer: options.firstPlayer }),
    ...(options.noShuffle === undefined ? {} : { noShuffle: options.noShuffle }),
  })
}

function heroOf(hero: HeroId | null | undefined) {
  return hero === undefined ? {} : { hero }
}

export function deckOf(cardId: CardId, count = 12): CardId[] {
  return Array.from({ length: count }, () => cardId)
}

/** 连续执行多条指令，收集全部事件。 */
export function run(state: GameState, commands: Command[]) {
  let current = state
  const events: GameEvent[] = []
  for (const command of commands) {
    const result = execute(current, command)
    current = result.state
    events.push(...result.events)
  }
  return { state: current, events }
}

/** 从手牌里找指定卡牌的第一张，找不到直接失败，免得测试里到处判空。 */
export function handCard(state: GameState, player: PlayerId, cardId: CardId) {
  const found = state.players[player].hand.find((c) => c.cardId === cardId)
  if (!found) throw new Error(`${player} 号玩家手上没有 ${cardId}`)
  return found
}

export function board(state: GameState, player: PlayerId) {
  return state.players[player].board
}

/** 按场上顺序凑一份完整答题结果，wrong 里列出的实例算答错。 */
export function answersFor(state: GameState, wrong: InstanceId[] = []): AnswerResult[] {
  return [...state.players[0].board, ...state.players[1].board].map((ai) => ({
    instanceId: ai.instanceId,
    correct: !wrong.includes(ai.instanceId),
    answer: '占位',
    reasoning: '占位理由',
  }))
}

/** 双方都不出牌，直接把这一轮推进到答题阶段。 */
export function toQuiz(state: GameState) {
  return run(state, [
    { type: 'END_PLAY', player: state.activePlayer },
    { type: 'END_PLAY', player: other(state.activePlayer) },
  ]).state
}

/** 结算阶段双方都点确认：这一步之后才会推进下一轮或结束整局。 */
export function confirmBoth(state: GameState) {
  return run(state, [
    { type: 'CONFIRM_ROUND', player: 0 },
    { type: 'CONFIRM_ROUND', player: 1 },
  ])
}

/**
 * 从出牌阶段一路推到下一轮的出牌阶段：
 * 双方结束出牌 → 场上所有 AI 全答对 → 双方确认结算。
 * 给"要摆一个跨轮局面"的用例用。
 */
export function nextRound(state: GameState) {
  const quiz = toQuiz(state)
  const settle = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
  return confirmBoth(settle).state
}

/** 本轮的 ROUND_SCORED，用来一次断言完得分和判定依据。 */
export function scoredOf(events: GameEvent[]) {
  return events.find((e) => e.type === 'ROUND_SCORED')
}

/**
 * 把局面推到第 n 轮的出牌阶段：中间几轮双方都不出牌，场上的 AI 全部答对，双方确认后进下一轮。
 *
 * 用它是为了攒 Token 上限（第 1 轮 INITIAL_TOKEN_MAX 点，之后每轮 +TOKEN_MAX_GROWTH）。
 * 「复读机」一张 4 点，要连打两张就得等额度攒到 8 点，也就是第 4 轮。
 * 场上的 AI 一路全答对，所以推几轮它们都还站在原地。
 */
export function toRound(state: GameState, round: number): GameState {
  let current = state
  while (current.round < round) {
    const quiz = execute(current, { type: 'DEBUG_SKIP_TO_QUIZ' }).state
    const answered = execute(quiz, { type: 'SUBMIT_ANSWERS', results: answersFor(quiz) }).state
    current = confirmBoth(answered).state
  }
  return current
}

/** 凭空塞一张牌进某方手牌，返回新局面和那张牌的实例 id。造出来的牌一定落在手牌末尾。 */
export function give(state: GameState, player: PlayerId, cardId: CardId) {
  const next = execute(state, { type: 'DEBUG_ADD_CARD', player, cardId }).state
  return { state: next, instanceId: next.players[player].hand.at(-1)!.instanceId }
}

/**
 * 凭空造几张牌再替某方打出去，用来一次把场面摆好（走调试指令是为了绕开出牌轮次）。
 * 费用照常扣，所以摆大场面之前得先用 toRound 把额度攒够；
 * 打不起会当场抛错，免得局面没摆成还让后面的断言去猜哪里不对。
 */
export function deploy(state: GameState, player: PlayerId, cardIds: CardId[]): GameState {
  let current = state
  for (const cardId of cardIds) {
    const added = give(current, player, cardId)
    const result = execute(added.state, {
      type: 'DEBUG_PLAY_CARD',
      player,
      instanceId: added.instanceId,
    })
    const rejected = result.events.find((e) => e.type === 'COMMAND_REJECTED')
    if (rejected) throw new Error(`摆场失败（${cardId}）：${rejected.reason}`)
    // execute 回的是一份新克隆，改它不会污染传进来的 state。
    current = result.state
  }
  return current
}

/**
 * 凭空给某方一张技能牌并立刻打出去，返回引擎的完整返回。
 * 不校验是否被拒——测拒绝的用例也用它。
 */
export function playSkill(
  state: GameState,
  player: PlayerId,
  cardId: CardId,
  targetInstanceId?: InstanceId,
) {
  const added = give(state, player, cardId)
  return execute(added.state, {
    type: 'DEBUG_PLAY_CARD',
    player,
    instanceId: added.instanceId,
    ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
  })
}

/**
 * 这批技能用例给双方发的 Token 额度。
 *
 * 按正常规则第 5 轮也才 INITIAL_TOKEN_MAX + 4 × TOKEN_MAX_GROWTH 点，而这里好几个用例要在
 * 一轮里连打两三张技能牌（光金钟罩一张就 7 点）。额度怎么涨另有专门的用例守着，
 * 这批直接把上限撑到管够，免得断言挂在"打不起"这种和被测效果无关的地方。
 */
export const SKILL_TEST_TOKENS = 12

/**
 * 摆一个双方都不带英雄、额度已经撑到 SKILL_TEST_TOKENS 的出牌阶段局面。
 *
 * 不带英雄是因为默认的格蕾丝·霍珀会抵消对方本局第一张技能牌，而被抵消的技能一点效果都不留，
 * 会把这一批用例想测的东西整个盖掉（抵消本身另有专门的一节）。
 * 额度攒够是因为技能牌里最贵的金钟罩要 7 点，第 1 轮的 4 点连它都打不出来。
 *
 * 一局就 5 轮，第 5 轮确认完是终局，所以要测"进下一轮"的用例得传 4。
 */
export function skillGame(round = 5): GameState {
  const game = newGame({
    deck0: deckOf('gpt-2'),
    deck1: deckOf('gpt-2'),
    hero0: null,
    hero1: null,
  })
  const state = toRound(game.state, round)
  for (const player of state.players) {
    // 比分抹平：toRound 每推一轮双方各 +1 分（双方同错、消耗都是 0，判成 equal-tokens），
    // 推到第 4 轮就已经 3:3。这批用例再分出个高低就会触发 WIN_TARGET 当场收场，
    // 后面"进下一轮才清标记"的断言全落在一个已经 finished 的局面上。
    player.score = 0
    player.tokenMax = SKILL_TEST_TOKENS
    player.tokens = SKILL_TEST_TOKENS
  }
  return state
}

export function rejection(result: { events: GameEvent[] }): string | undefined {
  const rejected = result.events.find((e) => e.type === 'COMMAND_REJECTED')
  return rejected?.reason
}

/** 给甲凭空造一张和乙同费用的 AI 并打出去，让本轮双方消耗持平。 */
function matchFoeAi(state: GameState, cardId: CardId): GameState {
  const added = execute(state, { type: 'DEBUG_ADD_CARD', player: 0, cardId }).state
  return execute(added, {
    type: 'DEBUG_PLAY_CARD',
    player: 0,
    instanceId: added.players[0].hand.at(-1)!.instanceId,
  }).state
}

/**
 * 摆一个「乙场上两个 AI、轮到甲出牌、甲满手复读机」的第 4 轮局面。
 *
 * 摆法绕了一点，是因为三件事必须同时成立：
 * - 「复读机」一张 4 点，而有的用例要在一轮里连打两张，得等额度攒到 8 点，也就是第 4 轮；
 * - 一路推到第 4 轮的过程中不能有人先到 WIN_TARGET 分把对局结束掉。所以每轮都让甲跟着乙
 *   打一张同费用的 AI：双方同对、消耗相同，判成 equal-tokens 各 +1，分数一直咬平
 *   （3:3 也不算分出胜负，见 engineRound.ts 的 confirmRound 里的 decided），对局才走得到第 4 轮。
 *
 * 甲的 AI 用调试指令凭空造（它牌组里全是复读机），乙的第二张也走调试指令：
 * 这两下都只免掉"轮到谁出牌"，费用照旧生效。
 */
export function stageTwoFoeAis(start: GameState, foeAi: CardId): GameState {
  // 第 1 轮乙先手派一张，甲跟一张。
  const round1 = matchFoeAi(
    execute(start, {
      type: 'PLAY_CARD',
      player: 1,
      instanceId: handCard(start, 1, foeAi).instanceId,
    }).state,
    foeAi,
  )
  // 第 2 轮换甲先手，乙靠调试指令补上第二张，甲再跟一张。
  const round2 = nextRound(round1)
  const staged = matchFoeAi(
    execute(round2, {
      type: 'DEBUG_PLAY_CARD',
      player: 1,
      instanceId: handCard(round2, 1, foeAi).instanceId,
    }).state,
    foeAi,
  )
  // 第 3 轮双方都不出牌（消耗同为 0，照样各 +1），确认完就是要的那个第 4 轮局面。
  return toRound(nextRound(staged), 4)
}
