/**
 * Steam 能力的假实现：票据、昵称、在不在，全部由测试摆布。
 *
 * 它是唯一一条能把「Steam 登录」这条路跑到底的办法：真票据要 Steam 客户端在跑、
 * 还要一个真的 appId，本机跑不了，CI 上更不可能。
 *
 * **默认 `isAvailable()` 是 false**，和另外七项的假实现不一样（那几个默认是「支持」）。
 * 理由是这一项默认就该是「没有」：`createFakePlatform()` 建出来的是一台**普通机器**，
 * 大多数用例要验的正是「没有 Steam 时走游客那条路」。要测 Steam 的用例自己 `setAvailable(true)`。
 */

import type { SteamCapability } from '../steam'

export interface FakeSteam extends SteamCapability {
  setAvailable(available: boolean): void
  /** 下一张票据的内容。`null` 表示「取票据会失败」，用来测 Steam 客户端中途退出。 */
  setTicket(ticket: string | null): void
  setPersonaName(name: string | null): void
  /** `authTicket()` 被调了几次。票据是一次性的，所以「有没有每次现取」是要验的。 */
  ticketCount(): number
}

export function createFakeSteam(): FakeSteam {
  let available = false
  let ticket: string | null = 'fake-ticket'
  let personaName: string | null = '假玩家'
  let tickets = 0

  return {
    isAvailable: () => available,
    authTicket() {
      tickets += 1
      if (ticket === null) return Promise.reject(new Error('取不到 Steam 票据'))
      return Promise.resolve(ticket)
    },
    personaName: () => personaName,

    setAvailable(next) {
      available = next
    },
    setTicket(next) {
      ticket = next
    },
    setPersonaName(next) {
      personaName = next
    },
    ticketCount: () => tickets,
  }
}
