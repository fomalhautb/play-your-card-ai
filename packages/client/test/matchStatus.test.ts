/**
 * 对局顶栏那行连接状态字。
 *
 * 两条判断都只有联机时才走得到，而走错了很难发现：收场之后连接是**故意**关掉的，
 * 照直显示的话玩家会在结算页背后看到一行「正在重连…」，以为这一局还没完。
 */

import { describe, expect, it } from 'vitest'
import type { MatchStatus, MatchView } from '../src/match/driver'
import { linkStatusOf } from '../src/screens/matchStatus'

function view(extra: Partial<MatchView> = {}): MatchView {
  return {
    view: null,
    seat: 0,
    status: 'playing',
    lastRejection: null,
    abortReason: null,
    link: 'ok',
    peer: null,
    ...extra,
  }
}

describe('顶栏状态字', () => {
  it('一切正常时不占着顶栏，让比分显示出来', () => {
    expect(linkStatusOf(view())).toBeNull()
  })

  it('链路断了说正在重连', () => {
    expect(linkStatusOf(view({ link: 'down' }))).toContain('重连')
  })

  it('对方掉线了说对方掉线', () => {
    const peer = { online: false, loaded: true, ready: true }
    expect(linkStatusOf(view({ peer }))).toContain('对方掉线')
  })

  it('自己断线压过对方断线：那时 peer 里还是断线前的旧值', () => {
    const peer = { online: false, loaded: true, ready: true }
    expect(linkStatusOf(view({ link: 'down', peer }))).toContain('重连')
  })

  it('收场之后一律不说话——那时的 down 是正常收场，不是故障', () => {
    for (const status of ['finished', 'aborted'] satisfies MatchStatus[]) {
      expect(linkStatusOf(view({ status, link: 'down' }))).toBeNull()
    }
  })

  it('单机玩法永远是 null（link 恒为 ok、peer 恒为 null）', () => {
    expect(linkStatusOf(view({ link: 'ok', peer: null }))).toBeNull()
  })
})
