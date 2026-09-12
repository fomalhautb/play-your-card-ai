/**
 * 现开一局真实对局，给消息测试当载荷用（做法照抄 packages/protocol 的同名 helper）。
 *
 * 手写一份假的 `PlayerView` 也能过 schema（视图那条是粗筛，见 protocol 的 view.ts），
 * 但那样测的就只是「我编的对象等于我编的对象」。真视图是几十 KB、带整份卡池和嵌套数组的东西，
 * 拿它走一遍 JSON 往返才问得出「这份载荷真的过得了网线」——而 driver 恰好要在
 * 往返之后把卡池接回去，用假对象连这一步对不对都验不出来。
 */

import { createCatalog, PRESET_DECKS, QUESTION_POOL } from '@ai-duel/content'
import type { GameEvent, PlayerId, PlayerView } from '@ai-duel/core'
import { createGame, filterEvent, viewFor } from '@ai-duel/core'
import type { ViewDelta } from '@ai-duel/protocol'
import { stripCatalog } from '@ai-duel/protocol'

/** 收件人固定 0 号座位，测试里不需要两边都来一遍。 */
export const SAMPLE_SEAT: PlayerId = 0

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
  .map((event) => filterEvent(event, SAMPLE_SEAT))
  .filter((event): event is GameEvent => event !== null)

/** 开局之后 0 号座位能看到的那份裁剪视图，带完整卡池。 */
export const SAMPLE_VIEW: PlayerView = viewFor(opening.state, SAMPLE_SEAT)

/** 同一份视图摘掉卡池之后的样子，`match:events` 里发的就是这个。 */
export const SAMPLE_DELTA: ViewDelta = stripCatalog(SAMPLE_VIEW)

/** 一条随便挑的事件，只在「这批有没有被转发」这种断言里当标记用。 */
export const SAMPLE_ONE_EVENT: GameEvent[] = [SAMPLE_EVENTS[0]!]
