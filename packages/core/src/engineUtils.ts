/**
 * 引擎各阶段共用的小工具：拒绝一条指令、深拷贝状态、洗牌、掷随机、抽牌、换一方。
 *
 * 它是引擎这一摞文件的**最底层**：只依赖类型，一个阶段模块都不 import。
 * 各阶段一律单向依赖它，「出牌结束要进答题」「开局要宣告第一轮」这类横向调用才不会绕成环
 *（完整分层见 engine.ts 的文件头）。
 *
 * 这里放的都是**没有阶段属性**的东西。某个函数只有一个阶段用得上，就该待在那个阶段的文件里，
 * 别因为"看起来像工具"往这儿搬——那样这份文件迟早变成谁都要 import 的杂物间。
 */

// pure-rand v8 只提供子路径入口，没有包根入口，所以这几行 import 看起来才这么长。
import { uniformInt } from 'pure-rand/distribution/uniformInt'
// 用 mersenne 而不是更快的 xoroshiro128plus：后者从整数种子起步时，
// 相邻种子头几个输出的低位是强相关的（实测连续种子掷硬币有约 65% 概率翻面，
// 空转多少次都甩不掉），而这里的 seed 就是 Date.now()，会掷出"隔一毫秒换一次先手"的规律。
// mersenne 的种子扩散做得干净，连续种子的首个输出实测就是均匀且互不相关的。
import { mersenne } from 'pure-rand/generator/mersenne'
import type { RandomGenerator } from 'pure-rand/types/RandomGenerator'
import type { ExecuteResult, GameEvent } from './events'
import type { GameState, PlayerId, PlayerState } from './state'

/**
 * 状态内随机种子的取值上界。
 *
 * 取 2^31 - 1 而不是更大的数：种子要跟着 GameState 走 JSON，
 * 停在 32 位有符号整数范围内最不容易在序列化两端出岔子。
 */
export const RNG_SEED_MAX = 0x7fffffff

/**
 * 拒绝一条指令：原样退回传进来的那份 state，只多一条回执事件。
 *
 * 它**不拷贝**，退回的就是参数本身。所以各阶段拒绝时一律传**没动过的**那一份
 *（也就是函数最外层收到的 state），别把已经改了一半的副本传进来。
 */
export function reject(state: GameState, reason: string): ExecuteResult {
  return { state, events: [{ type: 'COMMAND_REJECTED', reason }] }
}

export function other(playerId: PlayerId): PlayerId {
  return playerId === 0 ? 1 : 0
}

/**
 * JSON 深拷贝。
 * 慢，但顺带把"GameState 必须可序列化"这条约束钉死了：
 * 一旦有人往状态里塞函数或 Map，拷贝会立刻丢数据暴露问题。
 */
export function clone(state: GameState): GameState {
  // 目录被摘出来单独接回去：它是只读的内容快照（几十张卡的卡面文案），引擎一个字都不改，
  // 跟着深拷贝走一遍纯属每条指令白拷几十 KB。摘出来之后新旧状态共用同一份目录对象，
  // 这也正是 content 的 createCatalog() 本来的用法——所有对局共用那一份表。
  const { catalog, ...rest } = state
  return { ...(JSON.parse(JSON.stringify(rest)) as Omit<GameState, 'catalog'>), catalog }
}

/** Fisher-Yates 洗牌。rng 会被就地推进，所以用同一个生成器连洗两副牌不会得到相同顺序。 */
export function shuffle<T>(items: readonly T[], rng: RandomGenerator): T[] {
  const result = items.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = uniformInt(rng, 0, i)
    const tmp = result[i]!
    result[i] = result[j]!
    result[j] = tmp
  }
  return result
}

/**
 * 用状态里的种子跑一次随机，跑完把下一颗种子写回状态。
 *
 * 这样引擎既保持"同一份状态 + 同一条指令 = 同一个结果"，又不用把生成器本身
 * （不可 JSON 序列化）塞进状态。联机时房主广播完快照，客人手上的种子和房主一致。
 */
export function withRng<T>(state: GameState, use: (rng: RandomGenerator) => T): T {
  const rng = mersenne(state.rngSeed)
  const result = use(rng)
  state.rngSeed = uniformInt(rng, 0, RNG_SEED_MAX)
  return result
}

/** 抽牌。牌堆空了就是抽不到，不做疲劳伤害——牌组比一局用得到的张数长，先不管。 */
export function drawCards(player: PlayerState, count: number, events: GameEvent[]): void {
  for (let i = 0; i < count; i++) {
    const card = player.deck.pop()
    if (!card) return
    player.hand.push(card)
    events.push({ type: 'CARD_DRAWN', player: player.id, card })
  }
}
