/**
 * 枚举「当前状态下所有合法的指令」和「保证会被拒绝的指令」，随机走局器从这两个池子里挑。
 *
 * 合法那半边是把引擎的校验（enginePlay.ts 的 playCard 扣费和 denyReason 选目标、
 * engineSkills.ts 的 useHeroSkill 英雄与链头链尾）**照着抄了一遍**。
 * 抄一遍是有意的：引擎哪天改了校验而这里没跟着改，
 * properties.test.ts 里「合法指令不该出 COMMAND_REJECTED」那条就会红，
 * 等于给规则改动加了一道"记得同步"的提醒。红了先看是引擎真变了还是这里过时了。
 */

import type {
  AiInstance,
  CardInstance,
  Command,
  GameState,
  InstanceId,
  PlayerId,
  Question,
  SkillCard,
} from '../../src/index'
import {
  downgradeTargetOf,
  effectivePlayCost,
  getCard,
  other,
  upgradeTargetOf,
} from '../../src/index'

/** 场上根本不存在的实例 id，专门用来造"目标不存在"这类必被拒的指令。 */
const GHOST_ID: InstanceId = 'ghost-instance-id'

/** 目录里没有的卡牌 id，用来造必被拒的调试指令。 */
const GHOST_CARD_ID = 'ghost-card-id'

const SEATS: PlayerId[] = [0, 1]

/** 场上双方的全部 AI 单位，答题结果要覆盖它们每一个。 */
export function boardUnits(state: GameState): AiInstance[] {
  return [...state.players[0].board, ...state.players[1].board]
}

/** 本轮的题目。 */
export function currentQuestion(state: GameState): Question {
  const question = state.questions[state.round - 1]
  if (!question) throw new Error(`第 ${state.round} 轮没有对应的题目`)
  return question
}

/**
 * 这张技能牌现在能打向哪些目标：每一项是一条 `PLAY_CARD` 的 `targetInstanceId`，
 * `undefined` 表示这张牌不需要目标。返回空数组就是"这张牌现在打不出去"。
 *
 * 判断口径逐条对着 enginePlay.ts 的 denyReason，顺序也一样。
 */
function skillTargets(
  state: GameState,
  playerId: PlayerId,
  card: SkillCard,
): (InstanceId | undefined)[] {
  const player = state.players[playerId]
  const foe = state.players[other(playerId)]
  // 金钟罩罩着自己时，落在自己场上单位身上的技能牌一律打不出去。
  const selfTargeted = card.target === 'own-ai' || card.target === 'own-affected-ai'
  if (selfTargeted && player.shielded === true) return []
  if (card.id === 'golden-bell-shield' && player.shielded === true) return []
  if (card.target === undefined) return [undefined]
  if (card.target === 'foe-ai') {
    if (foe.shielded === true) return []
    return foe.board.filter((a) => a.interference === undefined).map((a) => a.instanceId)
  }
  if (card.target === 'own-hand-ai') {
    // 技能牌自己也在手牌里，但它不是 AI 牌，所以这一条顺带排除了"拿自己当目标"。
    return player.hand
      .filter((c) => getCard(state.catalog, c.cardId).kind === 'ai')
      .map((c) => c.instanceId)
  }
  if (card.target === 'own-ai') {
    return player.board.filter((a) => a.safePassed !== true).map((a) => a.instanceId)
  }
  // own-affected-ai：玉净瓶要有干扰可解才打得出去。
  return player.board.filter((a) => a.interference !== undefined).map((a) => a.instanceId)
}

/** 出牌阶段：当前行动方能打的每一张手牌（技能牌按每个合法目标各算一条）。 */
function handPlays(state: GameState, playerId: PlayerId): Command[] {
  const player = state.players[playerId]
  const commands: Command[] = []
  for (const instance of player.hand) {
    const card = getCard(state.catalog, instance.cardId)
    if (player.tokens < effectivePlayCost(player, card)) continue
    if (card.kind === 'ai') {
      commands.push({ type: 'PLAY_CARD', player: playerId, instanceId: instance.instanceId })
      continue
    }
    for (const targetInstanceId of skillTargets(state, playerId, card)) {
      commands.push({
        type: 'PLAY_CARD',
        player: playerId,
        instanceId: instance.instanceId,
        ...(targetInstanceId === undefined ? {} : { targetInstanceId }),
      })
    }
  }
  return commands
}

/** 出牌阶段：主动英雄技能（升级打自己场上、降级打对面场上，到链头链尾就不能发）。 */
function heroSkillPlays(state: GameState, playerId: PlayerId): Command[] {
  const player = state.players[playerId]
  if (player.heroSkillUsed) return []
  const upgrade = player.hero === 'danqi-chen'
  const downgrade = player.hero === 'melanie-perkins'
  if (!upgrade && !downgrade) return []
  const board = upgrade ? player.board : state.players[other(playerId)].board
  return board
    .filter((ai) =>
      upgrade
        ? upgradeTargetOf(state.catalog, ai.cardId) !== null
        : downgradeTargetOf(state.catalog, ai.cardId) !== null,
    )
    .map((ai) => ({
      type: 'USE_HERO_SKILL' as const,
      player: playerId,
      targetInstanceId: ai.instanceId,
    }))
}

/**
 * 当前状态下的全部合法指令。走局器每步从里面随机挑一条。
 *
 * 答题阶段只有一条：全场答题结果由 content 的 `scriptedAnswers` 查表生成（房主/本地 driver
 * 在真对局里也是这么发的）。为了不让 core 的测试直接依赖那张表的形状，
 * 生成函数由调用方传进来。
 */
export function legalCommands(
  state: GameState,
  answersFor: (state: GameState) => Command,
): Command[] {
  if (state.phase === 'finished') return []
  if (state.phase === 'quiz') return [answersFor(state)]
  if (state.phase === 'settle') {
    return SEATS.filter((p) => !state.settleConfirmed[p]).map((p) => ({
      type: 'CONFIRM_ROUND' as const,
      player: p,
    }))
  }
  const active = state.activePlayer
  return [
    ...handPlays(state, active),
    ...heroSkillPlays(state, active),
    { type: 'END_PLAY', player: active },
  ]
}

/** 手牌里第一张现在付不起的牌（没有就返回 undefined）。 */
function unaffordable(state: GameState, playerId: PlayerId): CardInstance | undefined {
  const player = state.players[playerId]
  return player.hand.find(
    (c) => player.tokens < effectivePlayCost(player, getCard(state.catalog, c.cardId)),
  )
}

/** 手牌里第一张要选目标的技能牌（用来造"目标不存在"）。 */
function needsTarget(state: GameState, playerId: PlayerId): CardInstance | undefined {
  return state.players[playerId].hand.find((c) => {
    const card = getCard(state.catalog, c.cardId)
    return card.kind === 'skill' && card.target !== undefined
  })
}

/**
 * 当前状态下**保证会被拒绝**的指令。
 *
 * 每一条都必须是"引擎一定回 COMMAND_REJECTED"的，不能是"多半会被拒"：
 * properties.test.ts 拿它断言"非法指令不改状态"，混进一条其实合法的会把那条测试变成假红。
 * 所以凡是要看局面才能确定的（付不起、重复确认），都先检查条件再放进池子。
 */
export function illegalCommands(state: GameState): Command[] {
  const commands: Command[] = [
    // 目录里没有这张卡，任何阶段都被拒。
    { type: 'DEBUG_ADD_CARD', player: 0, cardId: GHOST_CARD_ID },
    // 手牌里没有这个实例（手牌为空时报"手牌为空"，一样是拒）。
    { type: 'DEBUG_REMOVE_CARD', player: 1, instanceId: GHOST_ID },
  ]
  if (state.phase === 'play') {
    const active = state.activePlayer
    const idle = other(active)
    // 错误阶段：出牌阶段发答题和确认结算。
    commands.push({ type: 'SUBMIT_ANSWERS', results: [] })
    commands.push({ type: 'CONFIRM_ROUND', player: active })
    // 还没轮到你：用对方的牌、对方的结束出牌、对方的英雄技能。
    commands.push({ type: 'END_PLAY', player: idle })
    commands.push({ type: 'USE_HERO_SKILL', player: idle, targetInstanceId: GHOST_ID })
    const idleCard = state.players[idle].hand[0]
    if (idleCard) {
      commands.push({ type: 'PLAY_CARD', player: idle, instanceId: idleCard.instanceId })
    }
    // 手牌里没有这张卡。
    commands.push({ type: 'PLAY_CARD', player: active, instanceId: GHOST_ID })
    // 付不起。
    const broke = unaffordable(state, active)
    if (broke) {
      commands.push({ type: 'PLAY_CARD', player: active, instanceId: broke.instanceId })
    }
    // 目标不存在。
    const targeted = needsTarget(state, active)
    if (targeted) {
      commands.push({
        type: 'PLAY_CARD',
        player: active,
        instanceId: targeted.instanceId,
        targetInstanceId: GHOST_ID,
      })
    }
    // 英雄技能的目标不存在；没有可发动技能的英雄时报的是另一句，同样是拒。
    commands.push({ type: 'USE_HERO_SKILL', player: active, targetInstanceId: GHOST_ID })
    return commands
  }
  if (state.phase === 'quiz') {
    // 错误阶段：答题阶段发出牌、结束出牌、确认结算、跳到答题。
    commands.push({ type: 'END_PLAY', player: 0 })
    commands.push({ type: 'CONFIRM_ROUND', player: 1 })
    commands.push({ type: 'DEBUG_SKIP_TO_QUIZ' })
    commands.push({ type: 'PLAY_CARD', player: 0, instanceId: GHOST_ID })
    return commands
  }
  // settle：错误阶段的几条，外加"这一轮你已经确认过了"。
  commands.push({ type: 'END_PLAY', player: 0 })
  commands.push({ type: 'SUBMIT_ANSWERS', results: [] })
  commands.push({ type: 'USE_HERO_SKILL', player: 0, targetInstanceId: GHOST_ID })
  commands.push({ type: 'DEBUG_SKIP_TO_QUIZ' })
  for (const seat of SEATS) {
    if (state.settleConfirmed[seat]) commands.push({ type: 'CONFIRM_ROUND', player: seat })
  }
  return commands
}
