/**
 * 对局交互那几条测试共用的假卡池。
 *
 * 单独一个文件，因为它是**一份数据**而不是一件工具：摆假视图（`fakeView`）和摆假场景都要它，
 * 而它里面每一张牌都是为了覆盖某一条分支才存在的，说明比代码长。
 * 和指针替身放在一起的话，读替身的人要先翻过六十行卡定义。
 */

import type { Catalog } from '@ai-duel/core'

/**
 * 一份最小卡池：一张 AI 牌、三张技能牌。
 * 技能牌的 `target` 是 `skillTargets.ts` 唯一的分档依据，这里覆盖「无目标 / 打对面场上 /
 * 打自己手牌」三条分支——`own-ai` 和 `own-affected-ai` 走的是和 `foe-ai` 同一条战场分支。
 */
export const INPUT_CATALOG: Catalog = {
  cards: {
    ai: {
      kind: 'ai',
      id: 'ai',
      name: '假模型',
      model: 'fake',
      skillName: '假技能',
      skillText: '假',
      openrouter: null,
      tokenCost: 1,
      text: '假',
    },
    /*
     * 老一代的假模型，`evolvesTo` 指着上面那张。
     *
     * 英雄技能的候选名单是「这个单位升（降）得动吗」，而这一条最终问的是
     * core 的 `upgradeTargetOf` / `downgradeTargetOf`，也就是卡定义上有没有 `evolvesTo`。
     * 所以这份卡池必须有一条真的两代链，否则「有合法目标」那一档根本摆不出来。
     * 反过来，只带 `ai` 的场上单位就天然是「升不动也降不动」，正好当反例用。
     */
    'ai-old': {
      kind: 'ai',
      id: 'ai-old',
      name: '假模型（旧）',
      model: 'fake-old',
      skillName: '假技能',
      skillText: '假',
      openrouter: null,
      tokenCost: 1,
      text: '假',
      evolvesTo: 'ai',
    },
    plain: { kind: 'skill', id: 'plain', name: '无目标技能', tokenCost: 1, text: '假' },
    'hit-foe': {
      kind: 'skill',
      id: 'hit-foe',
      name: '打对面',
      tokenCost: 1,
      text: '假',
      target: 'foe-ai',
    },
    distill: {
      kind: 'skill',
      id: 'distill',
      name: '模型蒸馏',
      tokenCost: 1,
      text: '假',
      target: 'own-hand-ai',
    },
  },
  heroes: {},
} as unknown as Catalog
