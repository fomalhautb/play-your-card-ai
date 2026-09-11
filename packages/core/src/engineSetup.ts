/**
 * 开局：`createGame` 和它收的那份配置。
 *
 * 这是整局唯一一处**从外面拿种子**掷随机的地方：先手、两副牌堆、题序在这里一次掷完，
 * 之后抽牌只是从牌堆末尾 pop、题目按洗好的顺序逐轮取，都不再需要随机。
 * `execute` 那条路上还要掷随机的只剩「内存紧缺」，它用的是状态里的 `rngSeed`
 *（见 engineUtils.ts 的 withRng）。
 *
 * 为什么用 mersenne 而不是更快的生成器，见 engineUtils.ts 那两行 import 上的注释。
 */

// pure-rand v8 只提供子路径入口，没有包根入口，所以这两行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { mersenne } from 'pure-rand/generator/mersenne'
import type { CardId, Catalog, HeroId } from './cards'
import { getHero } from './catalog'
import { ADA_TOKEN_MAX_BONUS, INITIAL_TOKEN_MAX, STARTING_HAND_SIZE } from './constants'
import { announceRound } from './engineRound'
import { drawCards, RNG_SEED_MAX, shuffle } from './engineUtils'
import type { ExecuteResult, GameEvent } from './events'
import type { Question } from './question'
import type { CardInstance, GameState, PlayerId, PlayerState } from './state'

/** 没指定英雄时用谁。留一个兜底是为了让「不关心英雄」的调用方（大多是测试）能少写一个字段。 */
const DEFAULT_HERO: HeroId = 'grace-hopper'

export interface PlayerSetup {
  name: string
  /** 牌组，元素是卡牌定义 id，可以重复。 */
  deck: CardId[]
  /**
   * 这一方的英雄，不填就是 DEFAULT_HERO。
   * 联机对局双方都会明确传（匹配后的选英雄那一步，见黑客松版的 RoomScreen）；
   * 测试房只在存档里存过英雄时才传，没存过就吃默认值。
   * 传 null 表示这一方不带英雄（现在只有测试会这么用）。
   */
  hero?: HeroId | null
}

export interface GameSetup {
  /** 洗牌种子。同一个种子 + 同一串指令 = 同一场对局，先手也由它掷出。 */
  seed: number
  /**
   * 本局的卡牌和英雄定义（`content` 的 `createCatalog()`）。
   * core 自己不带数据，这份目录原样存进 `GameState.catalog`，之后引擎只从状态里查
   *（为什么这么放见 cards.ts 的 Catalog）。
   */
  catalog: Catalog
  players: [PlayerSetup, PlayerSetup]
  /**
   * 本局题库，开局洗一遍当题序用（noShuffle 时按原序）。题目和卡牌一样在 `content` 里。
   *
   * 和下面的 questions 是两个口子：这个是"整份题库，交给引擎洗"，
   * 那个是"我已经排好了，照这个顺序来"。两个都给时以 questions 为准。
   */
  questionPool: Question[]
  /**
   * 指定本局的题序，不填就把 questionPool 洗一遍（noShuffle 时按原序）。
   * 留这个口子是给测试、调试和教程用的：只塞一两道题，一两轮就能打到 GAME_OVER，
   * 不必为了看结算界面把整局走完。传进来的顺序原样使用，不再洗。
   */
  questions?: Question[]
  /**
   * 指定第一轮先手，跳过抛硬币。之后每轮照常交换。
   *
   * 教程用：先后手是教学脚本的一部分（第 1 轮玩家先手学出牌、第 2 轮对手先手好让干扰技能
   * 有目标），不能靠掷硬币碰运气。
   * 填了就**不消耗那次随机数**（整个跳过，不是掷完丢掉），所以同一个 seed 下改先手，
   * 后面洗出来的牌堆和题序一字不差——排剧本时定牌序和定先手互不牵连。
   * 反过来，指定先手和不指定先手在同一个 seed 上洗出来的牌不一样，那是两种玩法，本就不必对齐。
   * `GAME_STARTED` 事件照常带 firstPlayer，客户端的抛硬币过场不用为它改。
   */
  firstPlayer?: PlayerId
  /**
   * 双方牌组和题库都按传入顺序原样使用，不洗。
   *
   * 教程用：起手 5 张和每轮抽到的牌要完全由教学牌组的排列决定。
   * **抽牌是从数组末尾取的**（牌堆顶在末尾，见 engineUtils.ts 的 drawCards），
   * 所以排剧本时要把最先抽到的牌放在牌组数组的**最后**——
   * 想让起手是 A、B、C、D、E，牌组就得写成 `[..., E, D, C, B, A]`。
   * 题库相反，是从头往后按轮次取的（questions[round - 1]）。
   */
  noShuffle?: boolean
}

/**
 * 开一局：建好双方状态、洗牌、洗题序、抛硬币定先手、发起始手牌，
 * 最后给状态留一颗随机种子。
 *
 * 开局这一串随机（先手、两副牌堆、题序）在这里一次掷完，之后抽牌就是从牌堆末尾 pop、
 * 题目按洗好的顺序逐轮取，都不再需要随机。
 * `execute` 里只剩「内存紧缺」一处要掷随机，它用的是状态里的 `rngSeed`
 * （为什么不能把生成器本身塞进状态见 state.ts 的 `GameState.rngSeed`）。
 */
export function createGame(setup: GameSetup): ExecuteResult {
  const rng = mersenne(setup.seed)
  let seq = 0

  const makePlayer = (id: PlayerId, config: PlayerSetup): PlayerState => {
    const deck: CardInstance[] = config.deck.map((cardId) => ({
      instanceId: `p${id}-c${seq++}`,
      cardId,
      owner: id,
    }))
    // 用 === undefined 而不是 ??：null 是"这一方明确不带英雄"，不能被默认值盖掉。
    // 英雄初始化不碰 rng，所以加了它也不影响下面抛硬币/洗牌那串随机数的顺序。
    const hero = config.hero === undefined ? DEFAULT_HERO : config.hero
    // 目录里没有这位英雄说明调用方传了张不存在的牌，属于数据错误而不是玩家操作能触发的情况，
    // 和 getCard 一样当场抛错，别等到界面查卡面时才炸。
    if (hero !== null) getHero(setup.catalog, hero)
    // ada-lovelace 的「第一算法」是开局就算进数值的被动，不占 heroSkillUsed 那个标志。
    const tokenMax = INITIAL_TOKEN_MAX + (hero === 'ada-lovelace' ? ADA_TOKEN_MAX_BONUS : 0)
    return {
      id,
      name: config.name,
      score: 0,
      // 开局就是满的：第 1 轮双方各 INITIAL_TOKEN_MAX 点（ada-lovelace 再加 ADA_TOKEN_MAX_BONUS），
      // 之后每轮补满并涨 TOKEN_MAX_GROWTH（见 engineRound.ts 的 confirmRound）。
      tokens: tokenMax,
      tokenMax,
      spentThisRound: 0,
      costReduction: 0,
      hand: [],
      deck: setup.noShuffle === true ? deck : shuffle(deck, rng),
      board: [],
      discard: [],
      hero,
      heroSkillUsed: false,
    }
  }

  // 抛硬币定第一轮先手，之后每轮交换，所以只掷这一次。
  // 放在洗牌之前是有意的：洗牌会按牌组长度推进 rng，先手要是排在后面，
  // 换一副牌组或换一份题库就会掷出另一个结果，"同一个 seed 谁先手"这件事就不好复盘了。
  // setup 指定了先手就整个跳过这一掷（?? 的右边根本不求值），不消耗那次随机数。
  // 于是同一个 seed 下改先手不会连带把牌堆和题序也洗成另一副，
  // 教程排剧本时"先定牌序、再单独安排谁先手"这两件事才互不牵连。
  // 代价是指定先手和不指定先手在同一个 seed 上洗出来的牌不一样——那是两种玩法，本就不必对齐。
  const firstPlayer: PlayerId = setup.firstPlayer ?? (uniformInt(rng, 0, 1) === 0 ? 0 : 1)
  // 先建好两个玩家再组装 state：makePlayer 会推进 seq，
  // 写在对象字面量里的话 seq 那一行会按书写顺序取到发牌前的旧值。
  const players: [PlayerState, PlayerState] = [
    makePlayer(0, setup.players[0]),
    makePlayer(1, setup.players[1]),
  ]
  const questions = setup.questions
    ? setup.questions.slice()
    : setup.noShuffle === true
      ? setup.questionPool.slice()
      : shuffle(setup.questionPool, rng)

  const state: GameState = {
    catalog: setup.catalog,
    round: 1,
    totalRounds: questions.length,
    firstPlayer,
    activePlayer: firstPlayer,
    phase: 'play',
    questions,
    players,
    winner: null,
    settleConfirmed: [false, false],
    // 这颗种子必须排在洗牌、洗题序**之后**取：rng 是就地推进的，往前插一次取值
    // 会把后面所有随机的结果整体挪位，"哪个 seed 谁先手、牌堆什么顺序"这些既有对应关系
    // 全部作废（测试里那两个先手种子就是查出来的现成答案）。
    rngSeed: uniformInt(rng, 0, RNG_SEED_MAX),
    seq,
  }

  const events: GameEvent[] = [{ type: 'GAME_STARTED', firstPlayer }]
  for (const player of state.players) {
    drawCards(player, STARTING_HAND_SIZE, events)
  }
  announceRound(state, events)
  return { state, events }
}
