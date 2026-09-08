/**
 * 冻结的 core 快照：迁移第 12 条动手**之前** packages/core/src 的整份拷贝。
 *
 * 这一版客户端还在线上跑，不跟着正式版 core 的破坏性改动走（卡牌数据搬去 content、
 * createGame 多收一份 catalog……），所以把当时那份规则和数据整个拷了过来。
 * tsconfig 的 paths 和 vite 的 resolve.alias 把 `@ai-duel/core` 指到这里，
 * 于是这个包的源码一行 import 都不用改。
 *
 * **别改这个目录**，也别把新 core 的改动往这儿同步——它就是要停在那一刻。
 * 迁移第 38 条删掉 legacy-client 时一起删。详见本包 README。
 */

export * from './aiModels'
export * from './cards'
export * from './collection'
export * from './engine'
export * from './heroes'
export * from './questions'
export * from './script'
export * from './skillCards'
export * from './types'
