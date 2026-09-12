/**
 * 剧本用的那一局：最小卡池、题库、牌组，以及「谁在什么时候出哪张牌」的算法。
 *
 * 为什么不用 `content` 的真卡池：6.9 要的是**一段每次跑都一模一样的对局**，
 * 而真卡池会跟着内容迭代变（加一张牌、改一次费用，所有指标就跟着变，历史比不了）。
 * 这里的卡池写死在剧本里，和 `profiles.ts` 里那份牌库是同一批贴图名——
 * 「id 即文件名」那条约定（见 canvas 的 scenes/duel/cardVisuals.ts）让它们直接查得到卡面。
 *
 * 全部费用取 1：开局双方各 5 点 Token，正好够一人打五张，`play10` 那段的十次出牌
 * 因此都落在第一轮里，不用穿过回合结算（那一段有打字机效果，不适合当稳态指标的样本）。
 */

import type { CardFaceStyle } from '@ai-duel/canvas'
import type { Catalog, HeroId, Question } from '@ai-duel/core'
import { DECK } from '../node/profiles'

/**
 * 交互用例（tests/interaction.spec.ts）要打的那张技能牌。
 *
 * 目标档选 `own-hand-ai`（模型蒸馏那一档）：它的合法目标是**自己手里**的另一张 AI 牌，
 * 不需要先在场上摆出单位，一局刚发完牌就能走「拖进落区 → 选目标 → 点中」这整条路。
 * 三段确定性剧本抽不到它（它只在 INTERACTION_DECK 里），所以那边的指标一个数都不会动。
 */
export const INTERACTION_SKILL = 'bench-distill'

/**
 * 交互用例给我方配的英雄：陈丹琦，主动技能是「升己方一个单位一代」。
 *
 * 七位英雄里只有她和梅拉妮·珀金斯有主动技能（判据见 canvas 的 scenes/duel/skillTargets.ts），
 * 选升级那一位是因为她打的是**自己**场上的单位——一局刚开局只要自己打出一张牌就有目标了，
 * 不用先等对手也上场。
 *
 * 三段确定性剧本双方都是 `hero: null`（见 duelSession.ts），所以配上这位英雄之后
 * 那边一个数都不会动：没有英雄就没有那颗钮，也没有任何一条 cue 会变。
 */
export const INTERACTION_HERO: HeroId = 'danqi-chen'

/**
 * 同代际的下一张牌，键是上一代。抄 content 的四条真链（GPT / Claude / DeepSeek / Kimi）。
 *
 * 只有升得动（或降得动）的单位才是英雄技能的合法目标，而那一条最终问的是卡定义上的
 * `evolvesTo`（见 core 的 upgradeTargetOf）。剧本卡池要是一条链都没有，
 * 交互用例点开那颗钮只会看到空空的一片，测不到任何东西。
 * 三段确定性剧本读不到这个字段（引擎只在结算英雄技能时查它），所以指标不受影响。
 */
const EVOLVES_TO: Readonly<Record<string, string>> = {
  'gpt-2': 'gpt-3-5',
  'gpt-3-5': 'gpt-4o',
  'gpt-4o': 'chatgpt-5-6-sol',
  'claude-5-sonnet': 'claude-fable-5',
  'deepseek-r1': 'deepseek-v4',
  'kimi-k2-6': 'kimi-k3',
}

/** 卡池：`profiles.ts` 那批贴图名各一张 AI 牌，外加交互用例要的那张技能牌。 */
function makeCatalog(): Catalog {
  const cards: Catalog['cards'] = {}
  cards[INTERACTION_SKILL] = {
    kind: 'skill',
    id: INTERACTION_SKILL,
    name: '剧本用的技能牌',
    tokenCost: 1,
    text: '交互用例专用：打自己手里的一张 AI 牌。',
    target: 'own-hand-ai',
  }
  for (const id of DECK) {
    cards[id] = {
      kind: 'ai',
      id,
      name: id,
      model: id,
      skillName: '剧本用的占位技能',
      skillText: '剧本用的占位说明。',
      openrouter: null,
      tokenCost: 1,
      text: '剧本用的占位卡面文案。',
      ...(EVOLVES_TO[id] === undefined ? {} : { evolvesTo: EVOLVES_TO[id] }),
    }
  }
  /*
   * 英雄表里只放交互用例要的那一位。
   *
   * `Catalog.heroes` 的类型要求七位齐全，编七份假英雄只是为了让类型过关，所以这里断言一下：
   * 引擎只在 `hero !== null` 时查这张表（见 core 的 createGame），而三段确定性剧本双方都是
   * `hero: null`，一次都查不到。
   */
  const heroes = {
    [INTERACTION_HERO]: {
      kind: 'hero',
      id: INTERACTION_HERO,
      name: '剧本用的英雄',
      enName: 'Bench Hero',
      text: '交互用例专用。',
      skillName: '精准检索',
      skillText: '把己方场上一个单位升一代。',
    },
  } as unknown as Catalog['heroes']
  return { cards, heroes }
}

export const BENCH_CATALOG: Catalog = makeCatalog()

/**
 * 剧本用的卡面展示配置（费用圆章的圆心和插画主色）。
 *
 * 同样不用 `content` 的真数据：bench 不许依赖 content（依赖方向见《正式版架构》7.2），
 * 而且那张表跟着美术迭代变，指标就没法和历史比。这里按牌在牌库里的下标稳定地取几个值，
 * 覆盖的是「逐张配的圆心」和「按主色调出来的盘底」这两条代码路径本身，
 * 具体是哪个色、偏几个像素不影响任何一条确定性指标。
 *
 * 圆心的取值范围抄真数据里的分布（x 10.7~11.9、y 7.1~8.1），也就都落在卡面里。
 */
export const BENCH_CARD_FACES: Record<string, CardFaceStyle> = Object.fromEntries(
  DECK.map((id, index) => [
    id,
    {
      accent: ['#46584b', '#87502d', '#304e70', '#37646b'][index % 4] ?? '#304e70',
      costBadge: { x: 10.7 + (index % 4) * 0.4, y: 7.1 + (index % 3) * 0.5 },
    } satisfies CardFaceStyle,
  ]),
)

/** 三道题，够打三轮。题面长度取中等——它决定结算层那一屏要烤多少文字。 */
export const BENCH_QUESTIONS: Question[] = [1, 2, 3].map((round) => ({
  id: `bench-q${round}`,
  category: 'meme',
  text: `剧本用的第 ${round} 道题：这句话里到底藏了什么梗？`,
  keywords: ['剧本', '占位'],
  answer: `第 ${round} 题的标准答案`,
  explanation: `第 ${round} 题的解析，两行以内。`,
}))

/**
 * 牌组。**抽牌是从数组末尾取的**（见 core 的 `GameSetup.noShuffle`），
 * 所以最先摸到的那几张写在最后。这里一律用同一批牌，谁先谁后不影响指标。
 */
export const BENCH_DECK = [...DECK, ...DECK].slice(0, 24)

/**
 * 交互用例的牌组：和 `BENCH_DECK` 一样，只是把最先摸到的那张换成技能牌。
 *
 * 抽牌从数组**末尾**取，所以末尾那张是开局第一张。开局发五张，剩下四张都是 AI 牌，
 * 正好当那张技能牌的候选目标。
 */
export const INTERACTION_DECK = [...BENCH_DECK.slice(0, -1), INTERACTION_SKILL]
