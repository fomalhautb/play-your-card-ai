/**
 * 出牌阶段：一张牌打不打得出去、打出去之后怎么扣费进场，以及这一轮出牌怎么结束。
 *
 * 这里只管**校验和落地**：费用、轮次、目标合不合法都在 playCard / denyReason，
 * 技能牌真正改局面的那一步交给 engineSkills.ts 的 applySkillEffect，
 * 后手结束出牌之后进答题交给 engineQuiz.ts 的 enterQuiz。方向都是单向的，那两边不反过来用这里。
 */

import type { HandCard, HeroId, InstanceId, SkillCard } from './cards'
import { getCard } from './catalog'
import { enterQuiz } from './engineQuiz'
import { applySkillEffect } from './engineSkills'
import { clone, other, reject } from './engineUtils'
import type { ExecuteResult, GameEvent } from './events'
import type { AiInstance, CardInstance, GameState, PlayerId, PlayerState } from './state'

/**
 * 一张牌对这位玩家的**实际费用**：卡面费用减去这一方本轮的核电站减免，最低 1 点。
 *
 * 减免是各记各的：只有打出核电站的那一方后续的牌便宜，对手照卡面原价付，
 * 所以这里必须传具体是谁在打，不能只看整局的状态。
 *
 * 客户端的"打不起就变灰"和引擎的扣费校验必须用同一个数，所以这个函数导出给界面用——
 * 两边各算一遍的话，玩家会遇到"看着能打，点下去说 Token 不够"。
 * 入参只收 `costReduction` 那一项，是为了**视图也能直接传进来**：界面手里只有 `PlayerView`
 * （`PlayerSideView` 带着同名字段），限死成 `PlayerState` 的话它就只能自己抄一遍这条式子。
 *
 * 金钟罩管不着这里：罩子挡的是落在场上单位身上的效果，而减费改的是"这张牌打出去要花多少"
 * （完整口径见 state.ts 的 `PlayerState.shielded`）。
 */
export function effectivePlayCost(
  player: Pick<PlayerState, 'costReduction'>,
  card: HandCard,
): number {
  return Math.max(1, card.tokenCost - player.costReduction)
}

/**
 * 打出一张手牌。
 *
 * 只有一道闸：每张牌按 effectivePlayCost 算出来的实际费用扣 Token、扣不起就整条拒绝。
 * AI 牌和技能牌都不限张数，一轮里 Token 够就能接着打。
 * 实际费用不一定等于卡面 tokenCost：自己打过的核电站会给它减价，见 effectivePlayCost。
 * 另外只有卡面标了 `target` 的技能牌要指定目标。
 */
export function playCard(
  state: GameState,
  playerId: PlayerId,
  instanceId: InstanceId,
  targetInstanceId?: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const foe = next.players[other(playerId)]
  const handIndex = player.hand.findIndex((c) => c.instanceId === instanceId)
  if (handIndex < 0) return reject(state, '手牌里没有这张卡')

  const instance = player.hand[handIndex]!
  const card = getCard(next.catalog, instance.cardId)
  const cost = effectivePlayCost(player, card)

  // 费用排在选目标之前：Token 不够的话这张牌根本不该进"指定目标"那一步，
  // 否则客户端会先让玩家挑完目标、再回一句打不起，白挑一次。
  if (player.tokens < cost) {
    return reject(state, `Token 不够：这张牌要 ${cost} 点，只剩 ${player.tokens} 点`)
  }

  // 目标和前置条件先校验完再动手牌：拒绝要退回原样的 state（reject 回的就是传进来那份），
  // 而下面这些改动全落在副本 next 上，顺序写反了以后加分支时容易漏掉。
  // 找到的目标是 next 里的那一份，后面直接改它就行。
  let target: AiInstance | undefined
  let handTarget: CardInstance | undefined
  if (card.kind === 'skill') {
    const denied = denyReason(next, playerId, card, targetInstanceId)
    if (denied !== null) return reject(state, denied)
    if (card.target === 'own-hand-ai') {
      handTarget = player.hand.find((c) => c.instanceId === targetInstanceId)
    } else if (card.target !== undefined) {
      const owner = card.target === 'foe-ai' ? foe : player
      target = owner.board.find((a) => a.instanceId === targetInstanceId)
    }
  }

  player.hand.splice(handIndex, 1)
  // 扣费和抽走手牌绑在一起：上面所有会拒绝的分支都已经走完，到这里这张牌必定打得出去。
  player.tokens -= cost
  // 同一笔钱记两处：tokens 是"还剩多少"，会在进下一轮时被补满冲掉；
  // spentThisRound 是"这一轮花了多少"，结算要用它比大小，所以得单独攒着。
  // 技能牌待会儿被英雄技能抵消也不退——Token 是真花出去的，作废的只是效果。
  // 答对数量相同时比的就是这个数（见 engineQuiz.ts 的 submitAnswers），
  // 所以这一笔记的是实际费用而不是卡面 tokenCost：核电站减了价，真正付出去的就是减价后那个数。
  player.spentThisRound += cost

  const events: GameEvent[] = []
  if (card.kind === 'ai') {
    // AI 牌进场后跨轮留在场上，答错才罚下，所以实例 id 沿用手牌那一份，
    // 罚下时才能原样塞回弃牌堆。
    const ai: AiInstance = {
      instanceId: instance.instanceId,
      cardId: card.id,
      owner: playerId,
    }
    player.board.push(ai)
    events.push({ type: 'AI_DEPLOYED', player: playerId, ai })
  } else {
    player.discard.push(instance)
    // grace-hopper 的 Debug：抵消对方本局打出的第一张技能牌。
    // 牌本身照常打出、照常进弃牌堆，作废的只是**效果**，所以要赶在结算之前先问一句
    // 「这张会不会被抵消」——被抵消的干扰技能不能给目标盖上 interference，
    // 否则玩家会看到"技能被抵消了，那个 AI 却再也不能被干扰"这种自相矛盾的局面。
    // 每张技能牌的效果都写在 engineSkills.ts 的 applySkillEffect 里，
    // 而它只在 canceledBy === null 时被调用。
    const canceledBy: HeroId | null =
      foe.hero === 'grace-hopper' && !foe.heroSkillUsed ? foe.hero : null

    // 带上 instanceId 不是结算需要，是给客户端定位用的：技能牌打出后就进弃牌堆，
    // 客户端只能靠这个 id 在出牌方的手牌里找到起飞的那张，播"飞到中央亮相"的动画。
    events.push({
      type: 'SKILL_PLAYED',
      player: playerId,
      cardId: card.id,
      instanceId: instance.instanceId,
      // 无目标技能、以及打向手牌的模型蒸馏都不带这个字段，客户端据此决定亮相完是原地淡出
      // 还是飞向战场上的某个格子。
      // 被抵消时也照常带：牌确实是冲着那个 AI 打出去的，客户端先演飞过去、再演抵消，
      // 玩家才看得懂"这一下本来要打谁"。
      ...(target === undefined ? {} : { targetInstanceId: target.instanceId }),
    })
    // 抵消这条排在 SKILL_PLAYED 之后：客户端才能先演出牌、再演抵消。
    if (canceledBy !== null) {
      foe.heroSkillUsed = true
      events.push({
        type: 'SKILL_CANCELED',
        player: playerId,
        by: foe.id,
        heroId: canceledBy,
        cardId: card.id,
        instanceId: instance.instanceId,
      })
    } else {
      // 效果事件跟在 SKILL_PLAYED 后面：客户端先演牌打出去，再演它造成了什么。
      applySkillEffect(next, playerId, card, target, handTarget, events)
    }
  }
  return { state: next, events }
}

/**
 * 这张技能牌现在打不打得出去：能打返回 null，不能打返回**直接给玩家看的**那句理由。
 *
 * 拆成单独一个函数是因为这里全是"看一眼就退回去"的检查，一条都不许改状态；
 * 和真正动局面的那一步（engineSkills.ts 的 applySkillEffect）分开写，
 * 加新牌时不容易把校验混进结算。
 */
function denyReason(
  state: GameState,
  playerId: PlayerId,
  card: SkillCard,
  targetInstanceId: InstanceId | undefined,
): string | null {
  const player = state.players[playerId]
  const foe = state.players[other(playerId)]

  // 金钟罩罩的是人和他场上的 AI，这两档目标都落在自己场上的单位身上，
  // 自己正罩着的时候打出去必定一点作用都没有，与其让玩家白花 Token，不如当场拒掉。
  // 'own-hand-ai'（模型蒸馏）刻意不在这里：它动的是手牌，够不着场上单位，所以罩着也能打。
  // 挡的另一半（群体牌结算时跳过被罩的一方）在 engineSkills.ts 的 applySkillEffect 里。
  const selfTargeted = card.target === 'own-ai' || card.target === 'own-affected-ai'
  if (selfTargeted && player.shielded === true) {
    return '金钟罩生效中，本轮技能牌也影响不到你自己场上的 AI'
  }
  // 金钟罩自己是全挡口径唯一的例外（否则第一张就把自己挡住、这张牌永远打不出去），
  // 所以要单独拦住"再打一张"：第二张什么都不会改变，纯属白扔 7 点。
  if (card.id === 'golden-bell-shield' && player.shielded === true) {
    return '本轮已经有金钟罩了'
  }
  if (card.target === undefined) return null
  if (card.target === 'foe-ai' && foe.shielded === true) {
    return '对方金钟罩生效中，技能牌影响不到他的 Agent'
  }
  if (targetInstanceId === undefined) return '这张技能牌要先指定目标'

  if (card.target === 'own-hand-ai') {
    const inHand = player.hand.find((c) => c.instanceId === targetInstanceId)
    // 技能牌自己也在手牌里，但它不是 AI 牌，所以这一条顺带挡住了"拿自己当目标"。
    if (inHand === undefined || getCard(state.catalog, inHand.cardId).kind !== 'ai') {
      return '目标必须是你手牌里的一张 AI 牌'
    }
    return null
  }

  const owner = card.target === 'foe-ai' ? foe : player
  const target = owner.board.find((a) => a.instanceId === targetInstanceId)
  // "选错了人"和"这个人不符合条件"分开报：玩家该看到的提示不一样。
  if (target === undefined) {
    return card.target === 'foe-ai' ? '目标必须是对方场上的 AI' : '目标必须是你自己场上的 AI'
  }
  switch (card.target) {
    case 'foe-ai':
      // 一个 AI 同时只挂一种干扰，已经挂着的不能再被选。
      return target.interference === undefined ? null : '这个 AI 已经被干扰过了'
    case 'own-ai':
      return target.safePassed === true ? '这个 AI 已经被保送了' : null
    case 'own-affected-ai':
      // 玉净瓶要有东西可移除才打得出去，空放一张 2 点的牌不合算，也没法给玩家交代。
      return target.interference === undefined ? '这个 AI 身上没有可以移除的效果' : null
  }
}

/** 结束本方出牌：先手发就轮到后手，后手发就进答题阶段。 */
export function endPlay(state: GameState): ExecuteResult {
  const next = clone(state)
  if (next.activePlayer === next.firstPlayer) {
    next.activePlayer = other(next.firstPlayer)
    return { state: next, events: [{ type: 'PLAY_TURN_STARTED', player: next.activePlayer }] }
  }
  return { state: next, events: enterQuiz(next) }
}

/** 测试房：跳过双方剩下的出牌，直接进答题阶段。 */
export function skipToQuiz(state: GameState): ExecuteResult {
  const next = clone(state)
  return { state: next, events: enterQuiz(next) }
}
