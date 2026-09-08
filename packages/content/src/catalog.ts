import type { Catalog } from '@ai-duel/core'
import { CARDS } from './cards'
import { HEROES } from './heroes'

/**
 * 交给 `createGame` 的那份内容目录：整个公开卡池 + 全部英雄。
 *
 * 规则引擎自己不带数据，一局要用的定义在开局那一刻整份存进 `GameState.catalog`
 *（为什么这么放见 core 的 Catalog 注释）。
 *
 * 返回的是模块里那两张表本身，不做拷贝：目录是只读的，引擎一个字都不改，
 * 每开一局拷一份几十 KB 的卡表纯属浪费。反过来说，**谁都不许改它**——
 * 改了会波及所有正在进行的对局。
 */
export function createCatalog(): Catalog {
  return { cards: CARDS, heroes: HEROES }
}
