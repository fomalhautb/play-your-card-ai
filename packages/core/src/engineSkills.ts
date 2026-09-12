/**
 * 技能牌和英雄技能真正改局面的那一步。
 *
 * 和 enginePlay.ts 的分界是「校验」与「结算」：这张牌打不打得出去（费用、目标合不合法）
 * 在那边的 playCard / denyReason，判完了才调到这里来；这里默认调用方已经把关过，
 * 一条也不再退回 COMMAND_REJECTED。唯一的例外是英雄技能 useHeroSkill——
 * 它自成一条指令（USE_HERO_SKILL），校验和结算都在这儿，没有别处替它把关。
 *
 * 加新牌时先想清楚该写在哪边：看一眼就退回去的写 denyReason，动状态的写 applySkillEffect。
 */

import type { CardId, InstanceId, SkillCard } from './cards'
import { downgradeTargetOf, getAiCard, getCard, upgradeTargetOf } from './catalog'
import { clone, other, reject, shuffle, withRng } from './engineUtils'
import type { ExecuteResult, GameEvent } from './events'
import type { AiInstance, CardInstance, GameState, PlayerId, PlayerState } from './state'

/**
 * 一张技能牌打出后真正改局面的那一步，只在"没被英雄技能抵消"时调用。
 *
 * 按 `card.id` 分派而不是按 `target`：目标只说明"选谁"，选中之后要干什么是每张牌自己的事。
 * 24 张里 10 张在这里有分支，其余的落到 default——那些还是占位牌，打出即进弃牌堆。
 *
 * `target` / `handTarget` 由 enginePlay.ts 的 playCard 校验完传进来，
 * 用得上它们的分支必定拿得到值，所以下面直接用 `!`。
 */
export function applySkillEffect(
  state: GameState,
  playerId: PlayerId,
  card: SkillCard,
  target: AiInstance | undefined,
  handTarget: CardInstance | undefined,
  events: GameEvent[],
): void {
  const player = state.players[playerId]
  switch (card.id) {
    // 干扰两张：记下是被哪张打中的，答题时按这个种类去查对应那一档的预生成回答
    // （见 content 的 script.ts；写字面量而不是 card.id 是为了对上 InterferenceCardId 的类型）。
    // 这个函数只在没被英雄技能抵消时才被调用，所以被抵消的那一下目标身上什么都不会留。
    case 'fixed-answer':
      target!.interference = 'fixed-answer'
      markAffected(target!, 'fixed-answer')
      return
    case 'black-white-reversal':
      target!.interference = 'black-white-reversal'
      markAffected(target!, 'black-white-reversal')
      return
    case 'jade-purification-vase': {
      // 解掉干扰之后这个 AI 又是"没被干扰过"的了，本轮还可能被对面再打一张。
      // 被解掉的那张也要从 affectedBy 里撤掉，否则小卡会一直挂着「复读中」这种已经不存在的角标；
      // 换上玉净瓶自己这一笔，玩家才看得出这个单位本轮被净化过（也就是还吃得下一张干扰）。
      const cleansed = target!.interference!
      delete target!.interference
      unmarkAffected(target!, cleansed)
      markAffected(target!, 'jade-purification-vase')
      return
    }
    case 'safe-pass':
      target!.safePassed = true
      markAffected(target!, 'safe-pass')
      return
    case 'golden-bell-shield':
      player.shielded = true
      return
    case 'nuclear-power-station':
      // 只加在打出方自己身上：这张牌减的是他后续出牌的费用，对手不受影响。
      player.costReduction += 1
      return
    case 'model-distillation': {
      // 手牌数组在打出这张技能牌时已经变短了，所以要按 id 重新定位那张 AI 牌。
      const index = player.hand.findIndex((c) => c.instanceId === handTarget!.instanceId)
      const removed = player.hand.splice(index, 1)[0]!
      player.discard.push(removed)
      // 用印刷费用而不是 effectivePlayCost：核电站减的是自己"打出去要花多少"，
      // 不该连带把回收价也压下去。
      // 换来的 Token 可能顶破 tokenMax，这是有意允许的——多出来的部分在下一轮补满时被覆盖。
      player.tokens += getCard(state.catalog, removed.cardId).tokenCost
      events.push({ type: 'CARD_REMOVED', player: playerId, instanceId: removed.instanceId })
      return
    }
    case 'memory-shortage':
      // 一次 withRng 覆盖双方：两边各洗一次也行，但那样每打一张牌种子要推进两次，
      // 复盘时不好数。
      withRng(state, (rng) => {
        for (const side of state.players) {
          if (side.shielded === true) continue
          // 空场就什么都不发生：这张牌允许打空（对面也许正好被清干净了）。
          if (side.board.length === 0) continue
          const keep = Math.ceil(side.board.length / 2)
          const survivors = new Set(
            shuffle(
              side.board.map((a) => a.instanceId),
              rng,
            ).slice(0, keep),
          )
          removeFromBoard(side, (ai) => !survivors.has(ai.instanceId), card.id, events)
        }
      })
      return
    case 'domestic-substitution':
      for (const side of state.players) {
        if (side.shielded === true) continue
        removeFromBoard(
          side,
          (ai) => getAiCard(state.catalog, ai.cardId).domestic !== true,
          card.id,
          events,
        )
      }
      return
    case 'rising-tide':
      for (const side of state.players) {
        if (side.shielded === true) continue
        for (const ai of side.board) {
          const toCardId = getAiCard(state.catalog, ai.cardId).evolvesTo
          if (toCardId === undefined) continue
          const fromCardId = ai.cardId
          // 只换卡面身份：instanceId 不变，interference / safePassed 也跟着这个单位留下，
          // 因为它还是刚才那个单位，只是升了一级。
          ai.cardId = toCardId
          // 两笔标记各管一段时间：affectedBy 是本轮的（放大查看时说清"这轮它被哪张牌打过"），
          // evolvedTimes 跟着单位走不按轮清——卡面身份换了是永久的，
          // 隔几轮回头看战场也得看得出哪几个是被带飞上来的（口径见 state.ts）。
          markAffected(ai, 'rising-tide')
          ai.evolvedTimes = (ai.evolvedTimes ?? 0) + 1
          events.push({
            type: 'AI_TRANSFORMED',
            instanceId: ai.instanceId,
            owner: ai.owner,
            fromCardId,
            toCardId,
          })
        }
      }
      return
    default:
      // 其余 14 张还是占位牌：打出即进弃牌堆，什么都不发生（名单见 content 的 skillCards.ts）。
      return
  }
}

/**
 * 记一笔"这个单位本轮被这张技能牌打中过"，只给界面画角标和放大查看时列牌名用
 *（字段口径见 state.ts 的 `AiInstance.affectedBy`）。
 *
 * 效果落在场上单位身上的技能牌都要调它一次，不然那张牌打出去战场上不留痕迹。
 * 同一张牌不会重复记：干扰和保送本来就不允许打第二次，玉净瓶要有干扰可解，
 * 「鸡犬升天」倒是一轮里能连打两张，但两次说的是同一件事（这个单位被升级过），
 * 挂两枚一模一样的角标只是把小卡糊住。
 */
function markAffected(ai: AiInstance, cardId: CardId): void {
  const list = ai.affectedBy ?? []
  if (!list.includes(cardId)) list.push(cardId)
  ai.affectedBy = list
}

/**
 * 撤掉一笔（效果被别的牌移除了，眼下只有玉净瓶解干扰这一处）。
 * 撤到空就把字段整个删掉，让"没被打过的单位不带这一项"这条始终成立。
 */
function unmarkAffected(ai: AiInstance, cardId: CardId): void {
  const list = (ai.affectedBy ?? []).filter((id) => id !== cardId)
  if (list.length === 0) delete ai.affectedBy
  else ai.affectedBy = list
}

/**
 * 把场上符合条件的单位移进弃牌堆，各发一条 AI_REMOVED。
 *
 * 留下的按原顺序排好，客户端的战场格子才不会因为清场而整排重新洗位置。
 * `by` 是干这件事的那张技能牌，客户端靠它给不同的牌配不同的演出。
 */
function removeFromBoard(
  player: PlayerState,
  doomed: (ai: AiInstance) => boolean,
  by: CardId,
  events: GameEvent[],
): void {
  const removed = player.board.filter(doomed)
  player.board = player.board.filter((ai) => !doomed(ai))
  for (const ai of removed) {
    player.discard.push({ instanceId: ai.instanceId, cardId: ai.cardId, owner: ai.owner })
    events.push({
      type: 'AI_REMOVED',
      instanceId: ai.instanceId,
      owner: ai.owner,
      // 事件发出时这个单位已经不在场上了，界面要画它只剩这里这一份卡面身份。
      cardId: ai.cardId,
      by,
    })
  }
}

/**
 * 发动主动英雄技能：把场上一个 AI 换成同系列的上一代或下一代。
 *
 * 两位英雄共用这一条路径，升还是降、目标该在哪一侧，全由英雄自己决定，指令里不带方向：
 * danqi-chen 的「精准检索」升**己方**一个，melanie-perkins 的「化繁为简」降**对方**一个。
 *
 * 完全免费：不扣 tokens、不记 spentThisRound，也不结束出牌轮——发动完照样接着出牌或 END_PLAY。
 * 不记消耗这一点会影响胜负：答对数量相同时比的就是本轮 spentThisRound
 *（见 engineQuiz.ts 的 submitAnswers），发动技能不会让自己在那条决胜线上吃亏。
 * 每局只能发一次，用掉就置上 heroSkillUsed。
 */
export function useHeroSkill(
  state: GameState,
  playerId: PlayerId,
  targetInstanceId: InstanceId,
): ExecuteResult {
  const next = clone(state)
  const player = next.players[playerId]
  const hero = player.hero
  // 只有这两位的技能是"指定一个 AI 升/降级"。grace-hopper 的 Debug 是被动
  //（在 enginePlay.ts 的 playCard 里触发），其余几位还没实装（见 content 的 HeroCard.comingSoon），
  // 发这条指令一律拒绝。
  // hero === null 这半边是给类型收窄用的：没英雄时 direction 本来就是 null。
  const direction: 'upgrade' | 'downgrade' | null =
    hero === 'danqi-chen' ? 'upgrade' : hero === 'melanie-perkins' ? 'downgrade' : null
  if (hero === null || direction === null) return reject(state, '你的英雄没有可发动的技能')
  if (player.heroSkillUsed) return reject(state, '英雄技能这一局已经用过了')

  // 升级只能打自己场上、降级只能打对面场上。选错边和目标压根不存在报同一句：
  // 对玩家来说这两种都是"这个格子不能选"。
  const ownerId = direction === 'upgrade' ? playerId : other(playerId)
  const target = next.players[ownerId].board.find((a) => a.instanceId === targetInstanceId)
  if (target === undefined) {
    return reject(
      state,
      direction === 'upgrade' ? '目标必须是你场上的 AI' : '目标必须是对方场上的 AI',
    )
  }

  const fromCardId = target.cardId
  const toCardId =
    direction === 'upgrade'
      ? upgradeTargetOf(next.catalog, fromCardId)
      : downgradeTargetOf(next.catalog, fromCardId)
  // 链顶、链底，以及压根不在任何升级链上的那几张，都到头了（见 content 的 AI_UPGRADE_CHAINS）。
  if (toCardId === null) {
    return reject(
      state,
      direction === 'upgrade' ? '这个 AI 没有可升级的下一代' : '这个 AI 没有可降级的上一代',
    )
  }

  // 换掉 cardId 就是这个技能的全部效果：费用、卡面、预生成的答题表现全部跟着新卡走。
  // 身上那几个「本轮」标记（affectedBy / interference / safePassed）原样留着——被干扰、
  // 被保送和升降级是三码事，同一个单位身上互不影响：升完仍按新卡查被干扰那一档的回答，
  // 也照样答错不罚下。英雄技能自己不往 affectedBy 里记（那份只记技能牌），
  // 它留下的是永久的 levelShift 角标。
  // 降到链底可能降出没跑过预生成的那种卡，那一档由 content 的 script.ts 兜底，不会缺格抛错。
  // 金钟罩同理管不着这里：它挡的是技能牌，而英雄技能不是技能牌（见 state.ts 的 shielded）。
  target.cardId = toCardId
  target.levelShift = (target.levelShift ?? 0) + (direction === 'upgrade' ? 1 : -1)
  player.heroSkillUsed = true
  return {
    state: next,
    events: [
      {
        type: 'HERO_SKILL_USED',
        player: playerId,
        heroId: hero,
        targetInstanceId,
        fromCardId,
        toCardId,
        direction,
      },
    ],
  }
}
