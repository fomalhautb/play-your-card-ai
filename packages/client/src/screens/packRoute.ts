/**
 * 开包页那条路的两半：赢了一局之后**去不去**开包，以及到了开包页之后开的是**哪张牌**。
 *
 * 抽出来是为了这两条分流测得了：它们都是纯函数，而它们所在的两个组件（`MatchScreen`、
 * `PackScreen`）一个要 driver、一个要 Pixi，起一遍的代价远大于这几行本身。
 *
 * 卡 id 走查询串而不是内存里的一个变量，理由见 `PackScreen.tsx` 的文件头：
 * 那张牌在 `recordWin` 里已经写进收藏了，地址里带着它不是秘密，刷新还能重看一遍。
 */

import { CARD_POOL } from '@ai-duel/content'
import type { CardId } from '@ai-duel/core'

/** 卡池当白名单。地址是玩家能改的，改成一张不存在的牌就当没这回事。 */
const POOL = new Set<CardId>(CARD_POOL)

/**
 * 这一局该不该去开包，去的话是哪个地址。
 *
 * @param drawn `recordWin` 抽到的那张牌；没抽到（现在恒抽不到，见 content 的
 *   collection.ts）就是 null，那时结算页只有「再来一局 / 回首页」。
 */
export function packPathOf(drawn: CardId | null): string | null {
  return drawn === null ? null : `/pack?card=${encodeURIComponent(drawn)}`
}

/** 查询串里那张牌。不在卡池里（手改了地址、卡池删过牌）就是 null，开包页会跳回首页。 */
export function packCardOf(search: string): CardId | null {
  const raw = new URLSearchParams(search).get('card')
  return raw !== null && POOL.has(raw) ? raw : null
}
