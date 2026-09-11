/**
 * 卡牌、英雄、题库、预生成答案这些游戏内容数据，以及校验它们的 zod schema。
 *
 * 只放数据和读数据的纯函数，不放**对局**规则：那些在 `core`，它一张卡都不带。
 * 例外是要查内容表才成立的几条规矩——牌组构筑（`decks.ts`）、催一催的 id
 *（`urgeLines.ts`）——core 够不着卡表和喊话表，放它那儿反而要把数据倒灌回去。
 * 允许依赖：`core`（用它的类型描述卡牌、英雄、题目）。除此以外谁都不依赖。
 *
 * 数据分两种格式，按"谁在改它"分：
 * - **手写、注释多的定义**（AI 牌、技能牌、英雄）留在 TS 里——那些注释是设计依据，
 *   转成 JSON 就全丢了；
 * - **脚本生成或要被脚本读的表**（题库、注入提示词、预生成答案）放 `data/*.json`，
 *   离线脚本和游戏因此读的是同一份文件（《正式版架构》6.4）。
 *
 * 开一局要的是 `createCatalog()`：它把卡表和英雄表打包成 core 的 `Catalog`，
 * 由 `createGame` 存进对局状态。
 */

export * from './aiModels'
export * from './cards'
export * from './catalog'
export * from './collection'
export * from './deckPool'
export * from './decks'
export * from './heroes'
export * from './questions'
export * from './schema'
export * from './script'
export * from './skillCards'
export * from './urgeLines'
