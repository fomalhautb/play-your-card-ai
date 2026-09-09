/**
 * cue → 播放器的总表。
 *
 * 类型是 `Record<Cue['kind'], CuePlayer>`，**每一种 cue 都必须在这里有一条**：
 * 编排层加一种演出而这边没跟上，是编译错误，不用等测试跑（《正式版架构》6.5 的对偶）。
 * 反过来，这里多出一条编排层没有的，同样编译不过。
 *
 * 分组按「演在哪儿」而不是按「谁发的」：横幅和全屏过场一组、展示层一组、战场一组、
 * 手牌一组、结算层一组、剩下的杂项一组。找一段演出时先想「它出现在屏幕哪个位置」，
 * 比想「它是哪条事件引出来的」快得多。
 */

import type { Cue } from '../../../director/cues'
import type { DuelContext } from '../context'
import { boardPlayers } from './board'
import { handPlayers } from './hand'
import { miscPlayers } from './misc'
import { overlayPlayers } from './overlays'
import { revealPlayers } from './reveal'
import { settlePlayers } from './settle'
import type { CuePlayers } from './types'

export const CUE_PLAYERS: CuePlayers = {
  ...overlayPlayers,
  ...revealPlayers,
  ...boardPlayers,
  ...handPlayers,
  ...settlePlayers,
  ...miscPlayers,
}

/**
 * 播一条 cue。
 *
 * 那一下类型断言是必要的：表本身已经把「kind 和载荷配对」钉死了，
 * 但按一个联合类型的 `kind` 取出播放器之后，TS 只知道它是「某一条的播放器」，
 * 认不出手上这条 cue 正好是它要的那一条。断言收在这一处，别处不需要。
 */
export function playCue(ctx: DuelContext, cue: Cue): void {
  const player = CUE_PLAYERS[cue.kind] as (context: DuelContext, one: Cue) => void
  player(ctx, cue)
}
