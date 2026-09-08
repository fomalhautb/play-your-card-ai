/**
 * 现开一局真实对局，给消息测试当载荷用。
 *
 * 手写一份假的 `PlayerView` 也能过 schema（视图那条是粗筛，见 src/room.ts），
 * 但那样测的就只是「我编的对象等于我编的对象」。真视图是几十 KB、带整份卡池和嵌套数组的东西，
 * 拿它走一遍 JSON 往返才问得出「这个载荷真的过得了网线」。事件同理。
 *
 * 走的是服务端将来那条路（《正式版架构》5.2）：`createGame` 拿到状态和事件，
 * 事件逐条过 `filterEvent`，视图过 `viewFor`，两样都只属于某一个座位。
 */

import { createCatalog, PRESET_DECKS, QUESTION_POOL } from '@ai-duel/content'
import type { GameEvent, PlayerId, PlayerView } from '@ai-duel/core'
import { createGame, filterEvent, viewFor } from '@ai-duel/core'
import type { ViewDelta } from '../../src/index'
import { stripCatalog } from '../../src/index'

/** 收件人固定 0 号座位，测试里不需要两边都来一遍。 */
const VIEWER: PlayerId = 0

const opening = createGame({
  // 固定种子：同一个种子 + 同一副牌永远得到同一局，测试不会因为洗牌不同而飘。
  seed: 20260914,
  catalog: createCatalog(),
  questionPool: QUESTION_POOL,
  players: [
    { name: '甲', deck: PRESET_DECKS[0]!, hero: 'danqi-chen' },
    { name: '乙', deck: PRESET_DECKS[1]!, hero: 'melanie-perkins' },
  ],
})

/** 开局那批事件，已经按 0 号座位裁剪过（对手摸的牌在这里只剩「多了一张」）。 */
export const SAMPLE_EVENTS: GameEvent[] = opening.events
  .map((event) => filterEvent(event, VIEWER))
  .filter((event): event is GameEvent => event !== null)

/** 开局之后 0 号座位能看到的那份裁剪视图。 */
export const SAMPLE_VIEW: PlayerView = viewFor(opening.state, VIEWER)

/** 同一份视图摘掉卡池之后的样子，`match:events` 发的就是这个（见 src/view.ts）。 */
export const SAMPLE_DELTA: ViewDelta = stripCatalog(SAMPLE_VIEW)

/** 0 号座位手上第一张牌的实例 id，用来造一条合法的 `PLAY_CARD`。 */
export const SAMPLE_INSTANCE_ID: string = SAMPLE_VIEW.self.hand[0]!.instanceId
