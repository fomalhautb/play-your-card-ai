import { createCatalog } from '@ai-duel/content'
import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import { describe, expect, it } from 'vitest'
import type {
  CardId,
  Command,
  GameEvent,
  GameState,
  HeroId,
  PlayerId,
  Question,
} from '../src/index'
import { createGame, execute, filterEvent, getCard, viewFor } from '../src/index'

/**
 * 通用防泄漏：随机走完整局，每一步都盯着双方的视图和事件，看有没有漏出隐藏信息。
 *
 * 这是《正式版架构》6.3「隐藏信息测试」的主力——view.ts 那份清单里的每一条，
 * 靠一条条正向断言是守不住的（新加一个字段没人记得回来补），只有"整局跑一遍、
 * 把该藏的东西当字符串在输出里找一遍"才拦得住顺手把新字段抄进视图的那种漏。
 *
 * 题库用编出来的记号串（`TEXT-Q3-XYZ` 这种）而不是真题：真题的答案短到只有一个「否」字，
 * 拿它去 JSON 里做子串查找，随便哪张卡的文案都能撞上，这条测试就全是假警报。
 * 卡牌用的是真卡表（createCatalog），走的是真实的技能结算。
 */

const CATALOG = createCatalog()

/** 8 道记号题：每一段都长到不可能和别的内容撞车，好在 JSON 里做子串查找。 */
const QUESTIONS: Question[] = Array.from({ length: 8 }, (_, i) => ({
  id: `QID-Q${i}-XYZ`,
  category: 'meme',
  text: `TEXT-Q${i}-XYZ`,
  keywords: [`KW-Q${i}-A`, `KW-Q${i}-B`],
  answer: `ANSWER-Q${i}-XYZ`,
  explanation: `EXPL-Q${i}-XYZ`,
}))

/**
 * 双方共用的牌组：便宜的 AI 牌管够（场上得有单位，技能牌才有目标），
 * 外加 10 张接进引擎的技能牌各一到两张，好让随机指令能摸到每一种结算。
 */
const DECK: CardId[] = [
  'gpt-2',
  'gpt-2',
  'gpt-3-5',
  'gpt-3-5',
  'doubao',
  'doubao',
  'deepseek-r1',
  'deepseek-r1',
  'gemini',
  'qwen',
  'claude-5-sonnet',
  'rising-tide',
  'rising-tide',
  'jade-purification-vase',
  'model-distillation',
  'safe-pass',
  'golden-bell-shield',
  'nuclear-power-station',
  'black-white-reversal',
  'fixed-answer',
  'domestic-substitution',
  'memory-shortage',
]

/** 轮着换英雄：霍珀出 SKILL_CANCELED，陈丹琦和珀金斯出 HERO_SKILL_USED。 */
const HERO_PAIRS: [HeroId, HeroId][] = [
  ['grace-hopper', 'grace-hopper'],
  ['danqi-chen', 'melanie-perkins'],
  ['ada-lovelace', 'grace-hopper'],
  ['melanie-perkins', 'danqi-chen'],
]

/**
 * 全部事件类型的清单。`satisfies` 那一行是编译期的穷举检查：
 * 往 GameEvent 里加一种事件而不往这里加一行，类型就不过——和 filterEvent 里那个
 * 不写 default 的 switch 是同一套办法，两边一起逼着新事件被决定一次。
 */
const EVENT_TYPES = {
  GAME_STARTED: true,
  CARD_DRAWN: true,
  CARD_REMOVED: true,
  ROUND_STARTED: true,
  PLAY_TURN_STARTED: true,
  AI_DEPLOYED: true,
  SKILL_PLAYED: true,
  SKILL_CANCELED: true,
  HERO_SKILL_USED: true,
  QUESTION_REVEALED: true,
  AI_ANSWERED: true,
  AI_ELIMINATED: true,
  AI_SAFE_PASSED: true,
  AI_REMOVED: true,
  AI_TRANSFORMED: true,
  ROUND_SCORED: true,
  ROUND_CONFIRMED: true,
  GAME_OVER: true,
  COMMAND_REJECTED: true,
} satisfies Record<GameEvent['type'], true>

const GAMES = 40
/** 一局最多发这么多条指令。随机指令里有相当一部分会被拒，所以要给得宽。 */
const MAX_STEPS = 300

function seat(rng: RandomGenerator): PlayerId {
  return uniformInt(rng, 0, 1) === 0 ? 0 : 1
}

function pick<T>(items: readonly T[], rng: RandomGenerator): T | undefined {
  if (items.length === 0) return undefined
  return items[uniformInt(rng, 0, items.length - 1)]
}

/** 给一张技能牌挑个说得过去的目标；挑不着就返回 undefined，让引擎去拒。 */
function targetFor(state: GameState, me: PlayerId, cardId: CardId, rng: RandomGenerator) {
  const card = getCard(state.catalog, cardId)
  if (card.kind !== 'skill' || card.target === undefined) return undefined
  const player = state.players[me]
  const foe = state.players[me === 0 ? 1 : 0]
  switch (card.target) {
    case 'foe-ai':
      return pick(foe.board, rng)?.instanceId
    case 'own-ai':
      return pick(player.board, rng)?.instanceId
    case 'own-affected-ai':
      return pick(
        player.board.filter((ai) => ai.interference !== undefined),
        rng,
      )?.instanceId
    case 'own-hand-ai':
      return pick(
        player.hand.filter((c) => getCard(state.catalog, c.cardId).kind === 'ai'),
        rng,
      )?.instanceId
  }
}

/** 掷一条指令。故意掺着非法的：COMMAND_REJECTED 也要走一遍过滤。 */
function randomCommand(state: GameState, rng: RandomGenerator): Command {
  if (state.phase === 'quiz') {
    return {
      type: 'SUBMIT_ANSWERS',
      results: [...state.players[0].board, ...state.players[1].board].map((ai) => ({
        instanceId: ai.instanceId,
        // 回答文本用固定占位串：真回答有可能正好等于某道题的答案，
        // 那样下面的子串查找会把一条合法的公开事件误判成泄漏。
        correct: uniformInt(rng, 0, 3) > 0,
        answer: '回答占位',
        reasoning: '理由占位',
      })),
    }
  }
  if (state.phase === 'settle') return { type: 'CONFIRM_ROUND', player: seat(rng) }

  const me = state.activePlayer
  const roll = uniformInt(rng, 0, 19)
  if (roll === 0) return { type: 'DEBUG_REMOVE_CARD', player: seat(rng) }
  if (roll === 1) return { type: 'DEBUG_ADD_CARD', player: seat(rng) }
  if (roll === 2) return { type: 'PLAY_CARD', player: me, instanceId: '这张手牌不存在' }
  if (roll === 3) {
    const board = [...state.players[0].board, ...state.players[1].board]
    return {
      type: 'USE_HERO_SKILL',
      player: me,
      targetInstanceId: pick(board, rng)?.instanceId ?? '这个单位不存在',
    }
  }
  const instance = roll < 17 ? pick(state.players[me].hand, rng) : undefined
  if (instance === undefined) return { type: 'END_PLAY', player: me }
  const targetInstanceId = targetFor(state, me, instance.cardId, rng)
  return {
    type: 'PLAY_CARD',
    player: me,
    instanceId: instance.instanceId,
    ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
  }
}

/**
 * 此刻对这一方还藏着的东西，全部写成"在 JSON 里不该出现的字符串"。
 *
 * 实例 id 连着两边的引号一起找（`"p1-c2"`）：光找 `p1-c2` 的话，
 * 公开的 `p1-c20` 会把它当成子串，好端端的视图会被判成泄漏。
 */
function secretsOf(state: GameState, viewer: PlayerId): string[] {
  const foe = state.players[viewer === 0 ? 1 : 0]
  const secrets = [
    ...foe.hand.map((c) => JSON.stringify(c.instanceId)),
    ...state.players[0].deck.map((c) => JSON.stringify(c.instanceId)),
    ...state.players[1].deck.map((c) => JSON.stringify(c.instanceId)),
  ]
  state.questions.forEach((question, index) => {
    const round = index + 1
    // 打过的轮次整题公开。
    if (round < state.round) return
    if (round > state.round) {
      // 还没轮到的题一个字都不给，连关键词也不提前给。
      secrets.push(question.id, question.text, question.answer, question.explanation)
      secrets.push(...question.keywords)
      return
    }
    // 本轮：题面等 QUESTION_REVEALED，答案和解析等 ROUND_SCORED。
    if (state.phase === 'play') secrets.push(question.id, question.text)
    if (state.phase === 'play' || state.phase === 'quiz') {
      secrets.push(question.answer, question.explanation)
    }
  })
  return secrets
}

function leaksIn(json: string, secrets: string[]): string[] {
  return secrets.filter((secret) => json.includes(secret))
}

describe('隐藏信息：随机整局都不漏', () => {
  it(`${GAMES} 局随机对局里，每一步的视图和事件都不含隐藏信息`, () => {
    const problems: string[] = []
    const seenEvents = new Set<GameEvent['type']>()
    let steps = 0
    let finished = 0

    for (let game = 0; game < GAMES; game++) {
      const rng = mersenne(game + 1)
      const heroes = HERO_PAIRS[game % HERO_PAIRS.length]!
      let { state, events } = createGame({
        seed: game + 1,
        catalog: CATALOG,
        players: [
          { name: '甲', deck: DECK, hero: heroes[0] },
          { name: '乙', deck: DECK, hero: heroes[1] },
        ],
        questionPool: QUESTIONS,
      })

      for (let step = 0; step <= MAX_STEPS; step++) {
        for (const event of events) seenEvents.add(event.type)
        for (const viewer of [0, 1] as const) {
          const secrets = secretsOf(state, viewer)
          const view = viewFor(state, viewer)
          // 卡池摘掉再查：它是静态公开数据（谁看都一样），而它占了视图九成的体积，
          // 每一步都扫一遍会让这条测试慢一个数量级。
          const json = JSON.stringify({ ...view, catalog: undefined })
          const where = `第 ${game} 局第 ${step} 步 viewer=${viewer}`
          for (const leak of leaksIn(json, secrets)) problems.push(`${where} 视图漏了 ${leak}`)
          if (json.includes('"rngSeed"')) problems.push(`${where} 视图带着 rngSeed`)
          if (json.includes('"seq"')) problems.push(`${where} 视图带着 seq`)
          for (const event of events) {
            const filtered = filterEvent(event, viewer)
            if (filtered === null) continue
            for (const leak of leaksIn(JSON.stringify(filtered), secrets)) {
              problems.push(`${where} ${event.type} 漏了 ${leak}`)
            }
          }
        }
        if (state.phase === 'finished') {
          finished++
          break
        }
        const result = execute(state, randomCommand(state, rng))
        state = result.state
        events = result.events
        steps++
      }
    }

    expect(problems.slice(0, 10)).toEqual([])
    // 上面全绿也可能是因为压根没跑起来（比如开局就被拒到底），所以顺带量一下规模。
    expect(steps).toBeGreaterThan(GAMES * 30)
    expect(finished).toBeGreaterThan(GAMES / 2)
    // 穷举：每种事件都被这轮随机跑过滤过一遍，漏了说明这条测试根本没覆盖到它。
    expect(Object.keys(EVENT_TYPES).filter((type) => !seenEvents.has(type as never))).toEqual([])
  })
})
