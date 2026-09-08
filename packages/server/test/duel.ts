/**
 * 把一局从建房打到 `GAME_OVER` 的驱动器，两个真客户端各走一条 WebSocket。
 *
 * ## 为什么可以写成「一步一等」
 *
 * 玩家能发的四种指令，每一种产生的事件里都至少有一条是双方都看得见的
 *（出牌是 `AI_DEPLOYED`、结束出牌是 `PLAY_TURN_STARTED` 或 `QUESTION_REVEALED`、
 * 确认是 `ROUND_CONFIRMED`，答题结算是 `AI_ANSWERED` 那一串），
 * 所以每执行一条指令，**两边各收到恰好一条 `match:events`**。
 * 于是驱动器可以严格串行：发一条、两边各等一条、更新视图、再决定下一条。
 * 不靠 sleep 也不靠"等一小会儿看还有没有"，测试因此是确定的（《正式版架构》6 的第一条原则）。
 *
 * ## 出什么牌
 *
 * 只出不需要选目标的 AI 牌，出不起就结束出牌。这不是为了打得好，是为了让每一局
 * 都能在有限步内走到终局，同时保证场上真有单位可以答题、可以被裁剪掉。
 * 技能牌要选目标，规则分支多，那部分由 core 自己的属性测试覆盖，不在这一层重复。
 */

import { BALANCED_DECK } from '@ai-duel/content'
import type { GameEvent, HeroId, PlayerId, PlayerView } from '@ai-duel/core'
import { getCard } from '@ai-duel/core'
import type { ClientMessage } from '@ai-duel/protocol'
import { attachCatalog, PROTOCOL_VERSION } from '@ai-duel/protocol'
import { autoAnswer, Client, setupRoom, signToken } from './helpers'

/** 一条能用的 `session:hello`。 */
export const HELLO: ClientMessage = {
  type: 'session:hello',
  protocolVersion: PROTOCOL_VERSION,
  clientVersion: '0.0.0-test',
}

/** 一方在这一局里的连接、最新视图和收到过的一切。 */
interface Side {
  client: Client
  seat: PlayerId
  view: PlayerView
  /** 收到过的每一条 `match:events` 的序号，用来验连续性。 */
  seqs: number[]
  /** 收到过的全部事件（已经过 `filterEvent`），用来验裁剪。 */
  events: GameEvent[]
}

/** 一局：两方加房间码。 */
export interface Duel {
  code: string
  sides: [Side, Side]
}

/** 连上、打招呼、把开局前那串 `room:peer` 读掉。 */
async function joinSeat(code: string, userId: string, seat: PlayerId): Promise<Side> {
  const client = await Client.connect(code, await signToken(userId))
  client.send(HELLO)
  const welcome = await client.expect('session:welcome')
  if (welcome.place.kind !== 'room' || welcome.place.seat !== seat) {
    throw new Error(`${userId} 没坐到 ${seat} 号座`)
  }
  // view 先放一份占位，`match:started` 到了才是真的。
  return { client, seat, view: undefined as unknown as PlayerView, seqs: [], events: [] }
}

/**
 * 建房、两人进场、装载、就绪，一直到双方都拿到 `match:started`。
 *
 * 装载用的是 content 的预设牌组：它是玩家真能编出来的一副（20 张、同名不超 3 张、
 * 全在卡池里），正好也把服务端那道牌组校验走一遍。
 *
 * `hero` 默认 null（这一方不带英雄）。要传就只能传已实装的那 4 位——
 * 标了 `comingSoon` 的服务端不收（见 membership.ts 的 validateLoadout）。
 */
export async function openDuel(code: string, hero: HeroId | null = null): Promise<Duel> {
  await setupRoom(code, ['alice', 'bob'])
  const alice = await joinSeat(code, 'alice', 0)
  const bob = await joinSeat(code, 'bob', 1)
  const sides: [Side, Side] = [alice, bob]

  for (const side of sides) {
    side.client.send({ type: 'room:loadout', deck: [...BALANCED_DECK], hero })
  }
  for (const side of sides) side.client.send({ type: 'room:ready' })

  for (const side of sides) {
    const started = await side.client.until('match:started')
    if (started.seat !== side.seat) throw new Error('match:started 里的座位号不对')
    side.view = started.view
    side.seqs.push(started.seq)
    side.events.push(...started.events)
  }
  return { code, sides }
}

/** 一条指令之后，两边各收一条事件批，视图跟着换成新的。 */
async function settle(duel: Duel): Promise<void> {
  for (const side of duel.sides) {
    const batch = await side.client.expect('match:events')
    side.seqs.push(batch.seq)
    side.events.push(...batch.events)
    side.view = attachCatalog(batch.view, side.view.catalog)
  }
}

/** 这个座位手上有没有一张现在出得起、又不用选目标的 AI 牌。 */
function playableAi(view: PlayerView): string | null {
  for (const card of view.self.hand) {
    const definition = getCard(view.catalog, card.cardId)
    if (definition.kind !== 'ai') continue
    if (Math.max(1, definition.tokenCost - view.self.costReduction) > view.self.tokens) continue
    return card.instanceId
  }
  return null
}

/**
 * 把这一局打到终局。返回走了多少步，步数封顶是防死循环用的
 *（题库只有 8 道，正常几十步就完），走到顶还没完就说明规则或驱动器出问题了。
 */
export async function playToEnd(duel: Duel, maxSteps = 400): Promise<number> {
  for (let step = 1; step <= maxSteps; step += 1) {
    const view = duel.sides[0].view
    if (view.phase === 'finished') return step
    if (view.phase === 'quiz') {
      // 答题指令只有服务端能发（见 MatchRoom.submitAnswers），所以这一步走 RPC 不走电线。
      await autoAnswer(duel.code)
      await settle(duel)
      continue
    }
    const seat = view.phase === 'settle' ? (view.settleConfirmed[0] ? 1 : 0) : view.activePlayer
    const side = duel.sides[seat]
    if (view.phase === 'settle') {
      side.client.send({ type: 'match:command', command: { type: 'CONFIRM_ROUND', player: seat } })
    } else {
      const instanceId = playableAi(side.view)
      side.client.send({
        type: 'match:command',
        command:
          instanceId === null
            ? { type: 'END_PLAY', player: seat }
            : { type: 'PLAY_CARD', player: seat, instanceId },
      })
    }
    await settle(duel)
  }
  throw new Error(`${maxSteps} 步还没打完，八成是驱动器或规则出问题了`)
}
