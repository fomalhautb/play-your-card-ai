/**
 * 顶栏那一行连接状态字：现在该不该说「连不上」，说哪一句。
 *
 * 单独拎成纯函数，因为这里有两处只有联机时才看得见、看见时又很难复现的判断：
 * 1. **收场之后不许再说「正在重连」**。对局走到 `finished` / `aborted` 时连接是**故意**
 *    关掉的（收到 `room:closed` 或握手被拒之后不许重连，见 match/driver.ts 的 `MatchLink`），
 *    那时的 `link: 'down'` 是正常收场。照直显示的话，玩家会在结算页背后看到一行
 *    「正在重连…」，以为这一局还没完。
 * 2. **自己断线优先于对方断线**。两边同时断的时候，本端根本收不到对方的状态更新，
 *    `peer` 里还是断线前的旧值；先说自己那一句才是此刻唯一确定的事实。
 */

import type { MatchView } from '../match/driver'

/** 顶栏那行字，null 表示恢复成比分。单机玩法永远是 null（`link` 恒为 `'ok'`、`peer` 恒为 null）。 */
export function linkStatusOf(view: MatchView): string | null {
  if (view.status === 'finished' || view.status === 'aborted') return null
  if (view.link === 'down') return '正在重连…'
  /*
   * 不给具体的秒数：新服务端**没有**「断线宽限期」这回事。旧转发器那个 `PEER_GRACE 60_000`
   * 是客户端自己判「对手是真走了还是掉线了」用的，权威房间没有对应的东西——
   * 房间只在「一个人都没连着」满十分钟时才收摊（server 的 lifecycle.ts），
   * 而本端此刻正连着，所以只要玩家不走，对方随时回得来。
   * 写一个假的期限比不写更糟：玩家会盯着秒数等，等过了又发现还能打。
   */
  if (view.peer !== null && !view.peer.online) return '对方掉线，正在等他回来'
  return null
}
