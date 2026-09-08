import { createCatalog, QUESTION_POOL } from '@ai-duel/content'
import { describe, expect, it } from 'vitest'
import type { CardId, GameState, InstanceId, PlayerId } from '../src/index'
import { createGame, execute, filterEvent, viewFor } from '../src/index'

/**
 * `viewFor` / `filterEvent` 的正向断言：该给的确实给了，该裁的确实裁成了预期的形状。
 *
 * 反面（"该藏的一个都没漏"）由 viewLeak.test.ts 用随机整局扫，两条互补：
 * 这边守"别裁过头"，那边守"别裁漏了"。
 */

const CATALOG = createCatalog()

/** 牌组里带够 AI 牌，好让场上真有单位可看；技能牌各留一张给正向断言用。 */
const DECK: CardId[] = [
  'gpt-2',
  'gpt-3-5',
  'doubao',
  'deepseek-r1',
  'gemini',
  'qwen',
  'gpt-2',
  'gpt-3-5',
  'black-white-reversal',
  'safe-pass',
]

/** 三道真题就够打完一局（先到 3 分或题库出完）。 */
const QUESTIONS = QUESTION_POOL.slice(0, 3)

function newGame(): GameState {
  return createGame({
    seed: 7,
    catalog: CATALOG,
    players: [
      // 两位英雄都不会自动改局面：霍珀的 Debug 会把下面那张干扰牌抵消掉，
      // 这几条正向断言要的是"技能真的结算了"，所以避开他。
      { name: '甲', deck: DECK, hero: 'danqi-chen' },
      { name: '乙', deck: DECK, hero: 'ada-lovelace' },
    ],
    // questionPool 是必填的，questions 排在它前面生效（见 GameSetup）：
    // 这几条测试要的是"第 1 轮就是 QUESTIONS[0]"，所以两个口子都塞同一份。
    questionPool: QUESTIONS,
    questions: QUESTIONS,
    // 不洗牌：起手牌是牌组末尾那几张，测试里好定位。
    noShuffle: true,
    firstPlayer: 0,
  }).state
}

/** 从某人手上按卡牌 id 找出那张牌。起手 5 张就是牌组末尾那 5 张（noShuffle + 从末尾抽）。 */
function inHand(state: GameState, player: PlayerId, cardId: CardId): InstanceId {
  return state.players[player].hand.find((card) => card.cardId === cardId)!.instanceId
}

/** 双方各打一张 AI 牌，然后结束出牌进答题阶段。 */
function toQuiz(state: GameState): GameState {
  let next = state
  for (const player of [0, 1] as const) {
    next = execute(next, {
      type: 'DEBUG_PLAY_CARD',
      player,
      instanceId: inHand(next, player, 'gpt-2'),
    }).state
    next = execute(next, { type: 'END_PLAY', player }).state
  }
  return next
}

/** 答完题进结算阶段（全答对，免得单位被罚下）。 */
function toSettle(state: GameState): GameState {
  const results = [...state.players[0].board, ...state.players[1].board].map((ai) => ({
    instanceId: ai.instanceId,
    correct: true,
    answer: '回答占位',
    reasoning: '理由占位',
  }))
  return execute(state, { type: 'SUBMIT_ANSWERS', results }).state
}

describe('viewFor：自己那一半', () => {
  it('viewer 就是自己的座位号，另一边是对手', () => {
    for (const viewer of [0, 1] as const) {
      const view = viewFor(newGame(), viewer)
      expect(view.viewer).toBe(viewer)
      expect(view.self.id).toBe(viewer)
      expect(view.opponent.id).toBe(viewer === 0 ? 1 : 0)
    }
  })

  it('自己的手牌一张不少，对手只有张数', () => {
    const state = newGame()
    const view = viewFor(state, 0)
    expect(view.self.hand).toEqual(state.players[0].hand)
    expect(view.opponent.handCount).toBe(state.players[1].hand.length)
    // 对手那一半连"手牌"这个字段都不存在，泄漏在类型上就无处安放。
    expect('hand' in view.opponent).toBe(false)
  })

  it('双方牌堆都只给张数，自己的也一样', () => {
    const state = newGame()
    const view = viewFor(state, 0)
    expect(view.self.deckCount).toBe(state.players[0].deck.length)
    expect(view.opponent.deckCount).toBe(state.players[1].deck.length)
    expect('deck' in view.self).toBe(false)
    expect('deck' in view.opponent).toBe(false)
  })

  it('种子和实例计数器整个不给', () => {
    const view = viewFor(newGame(), 0)
    expect('rngSeed' in view).toBe(false)
    expect('seq' in view).toBe(false)
  })
})

describe('viewFor：公开的那些照给', () => {
  it('对手场上的单位和身上的本轮标记都看得见', () => {
    let state = newGame()
    const foeAi = inHand(state, 1, 'gpt-2')
    state = execute(state, { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: foeAi }).state
    state = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: inHand(state, 0, 'black-white-reversal'),
      targetInstanceId: foeAi,
    }).state

    const view = viewFor(state, 0)
    // 技能是当着两个人的面打出去的，命中谁、留下什么标记都得看得见，
    // 否则客户端画不出战场小卡上那排角标。
    expect(view.opponent.board).toEqual(state.players[1].board)
    expect(view.opponent.board[0]?.interference).toBe('black-white-reversal')
  })

  it('双方弃牌堆、分数、Token 这些原样给', () => {
    const state = toSettle(toQuiz(newGame()))
    const view = viewFor(state, 0)
    expect(view.opponent.discard).toEqual(state.players[1].discard)
    expect(view.opponent.score).toBe(state.players[1].score)
    expect(view.opponent.tokens).toBe(state.players[1].tokens)
    expect(view.opponent.spentThisRound).toBe(state.players[1].spentThisRound)
    expect(view.opponent.hero).toBe(state.players[1].hero)
    expect(view.settleConfirmed).toEqual(state.settleConfirmed)
    expect(view.catalog).toBe(state.catalog)
  })
})

describe('viewFor：题目按阶段揭晓', () => {
  it('出牌阶段只有类别和关键词，题面和 id 都不给', () => {
    const state = newGame()
    const view = viewFor(state, 0)
    // 数组长度就是"已经开始过的轮次数"，以后几轮的题连关键词都不在里面。
    expect(view.questions).toHaveLength(1)
    expect(view.questions[0]).toEqual({
      reveal: 'keywords',
      category: QUESTIONS[0]!.category,
      keywords: QUESTIONS[0]!.keywords,
    })
  })

  it('进答题阶段之后题面公开，答案和解析还遮着', () => {
    const view = viewFor(toQuiz(newGame()), 0)
    const question = view.questions[0]!
    expect(question.reveal).toBe('text')
    expect(question).toMatchObject({ id: QUESTIONS[0]!.id, text: QUESTIONS[0]!.text })
    expect('answer' in question).toBe(false)
    expect('explanation' in question).toBe(false)
  })

  it('本轮结算之后整题公开', () => {
    const state = toSettle(toQuiz(newGame()))
    expect(state.phase).toBe('settle')
    expect(viewFor(state, 0).questions[0]).toEqual({ reveal: 'answer', ...QUESTIONS[0] })
  })

  it('打过的轮次一直是整题公开，本轮回到只有关键词', () => {
    let state = toSettle(toQuiz(newGame()))
    for (const player of [0, 1] as const) {
      state = execute(state, { type: 'CONFIRM_ROUND', player }).state
    }
    expect(state.round).toBe(2)
    const view = viewFor(state, 0)
    expect(view.questions).toHaveLength(2)
    expect(view.questions[0]?.reveal).toBe('answer')
    expect(view.questions[1]?.reveal).toBe('keywords')
  })
})

describe('viewFor：视图是一份快照', () => {
  it('可 JSON 序列化，往返之后相等', () => {
    const view = viewFor(toQuiz(newGame()), 1)
    expect(JSON.parse(JSON.stringify(view))).toEqual(view)
  })

  it('改视图改不到状态', () => {
    const state = newGame()
    const view = viewFor(state, 0)
    view.self.hand.pop()
    view.self.board.push({ instanceId: '凭空', cardId: 'gpt-2', owner: 0 })
    expect(state.players[0].hand).toHaveLength(5)
    expect(state.players[0].board).toHaveLength(0)
  })
})

describe('filterEvent：逐条事件', () => {
  it('自己抽的牌照实给，对手抽的只剩"多了一张"', () => {
    const drawn = createGame({
      seed: 7,
      catalog: CATALOG,
      players: [
        { name: '甲', deck: DECK },
        { name: '乙', deck: DECK },
      ],
      questionPool: QUESTIONS,
      questions: QUESTIONS,
    }).events.filter((event) => event.type === 'CARD_DRAWN')
    const mine = drawn.find((event) => event.player === 0)!
    const foes = drawn.find((event) => event.player === 1)!

    expect(filterEvent(mine, 0)).toBe(mine)
    expect(filterEvent(foes, 0)).toEqual({ type: 'CARD_DRAWN', player: 1 })
    // 反过来看也一样：0 号的牌对 1 号才是秘密。
    expect(filterEvent(mine, 1)).toEqual({ type: 'CARD_DRAWN', player: 0 })
    expect(filterEvent(foes, 1)).toBe(foes)
  })

  it('QUESTION_REVEALED 只转题面，答案和解析摘掉', () => {
    const revealed = execute(newGame(), { type: 'DEBUG_SKIP_TO_QUIZ' }).events[0]!
    expect(revealed.type).toBe('QUESTION_REVEALED')
    for (const viewer of [0, 1] as const) {
      expect(filterEvent(revealed, viewer)).toEqual({
        type: 'QUESTION_REVEALED',
        question: {
          id: QUESTIONS[0]!.id,
          category: QUESTIONS[0]!.category,
          text: QUESTIONS[0]!.text,
          keywords: QUESTIONS[0]!.keywords,
        },
      })
    }
  })

  it('COMMAND_REJECTED 不进广播', () => {
    const rejected = execute(newGame(), { type: 'END_PLAY', player: 1 }).events[0]!
    expect(rejected).toEqual({ type: 'COMMAND_REJECTED', reason: '还没轮到你出牌' })
    // 回执由服务端直接回给发指令的那条连接，不经过这里（见 view.ts）。
    expect(filterEvent(rejected, 0)).toBeNull()
    expect(filterEvent(rejected, 1)).toBeNull()
  })

  it('公开事件原样通过，连对象都不换一个', () => {
    const game = createGame({
      seed: 7,
      catalog: CATALOG,
      players: [
        { name: '甲', deck: DECK },
        { name: '乙', deck: DECK },
      ],
      questionPool: QUESTIONS,
      questions: QUESTIONS,
    })
    const publicEvents = game.events.filter((event) => event.type !== 'CARD_DRAWN')
    expect(publicEvents.map((event) => event.type)).toEqual([
      'GAME_STARTED',
      'ROUND_STARTED',
      'PLAY_TURN_STARTED',
    ])
    for (const event of publicEvents) {
      for (const viewer of [0, 1] as const) expect(filterEvent(event, viewer)).toBe(event)
    }
  })

  it('对手打出的技能牌照实给：牌面、手牌实例、打向谁一样不少', () => {
    let state = newGame()
    const foeAi = inHand(state, 1, 'gpt-2')
    state = execute(state, { type: 'DEBUG_PLAY_CARD', player: 1, instanceId: foeAi }).state
    const played = execute(state, {
      type: 'PLAY_CARD',
      player: 0,
      instanceId: inHand(state, 0, 'black-white-reversal'),
      targetInstanceId: foeAi,
    }).events.find((event) => event.type === 'SKILL_PLAYED')!
    expect(filterEvent(played, 1)).toBe(played)
  })
})
