/**
 * 牌组页的卡池：**摆哪些卡、按什么顺序摆、怎么筛**。
 *
 * 和旁边的 `decks.ts` 分工清楚：那边是「一副牌合不合规矩」（服务端也要查），
 * 这边是「构筑页那一屏该长什么样」，服务端一行都用不上。两边都放在 content，
 * 理由一样——都要查卡表才成立，而 core 一张卡都不带。
 *
 * 为什么不放在 `canvas`：阵营是按「这张卡画的是谁家的模型」归堆的，属于内容知识；
 * 而 canvas 不许依赖 content（依赖方向见《正式版架构》7.2 第 1 条），
 * 牌组场景收到的是**调用方已经算好的**那份清单（见 canvas 的 scenes/deck/deckContract.ts）。
 *
 * 旧版这两件事分在黑客松版的 `src/screens/deckFactions.ts` 和 `DeckScreen.tsx`
 * 的模块常量里，搬过来时并成一个文件：它们回答的是同一个问题的两半。
 */

import type { CardId } from '@ai-duel/core'
import { AI_MODEL_CARDS, UNAVAILABLE_AI_CARD_IDS } from './aiModels'
import { CARDS } from './cards'
import { CARD_POOL } from './collection'
import { COMING_SOON_SKILL_CARD_IDS } from './skillCards'

/**
 * 阵营。它是**纯界面上的分组**，规则引擎里没有任何东西读它
 *（费用、答题、结算都和阵营无关），只为了让卡池那一屏好找卡。
 */
export type DeckFaction = 'gpt' | 'claude' | 'kimi' | 'deepseek' | 'other'

/** 阵营药丸。数组顺序就是界面上从左到右的顺序。 */
export const DECK_FACTIONS: readonly { id: DeckFaction; label: string }[] = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'other', label: '其他' },
]

/**
 * 一张 AI 牌属于哪个阵营。技能牌不该走这里（它们没有阵营，见 `filterDeckCards`）。
 *
 * 归堆靠 id 前缀而不是另存一份「id → 阵营」的表：同一家的新模型进卡池时
 *（gpt-5、claude-6……）不用记得回来登记一次，忘了登记的后果是那张卡默默掉进「其他」，
 * 而这正是没登记过的模型该去的地方。
 *
 * 前四个阵营各自成一堆是因为同系列的卡够多（每家 2 张以上），单拎出来筛才有意义。
 * 剩下的模型（qwen、doubao、gemini、grok……）每家都只有一张，再拆药丸只会多一排按钮，
 * 所以不分国产与否，统一进「其他」。
 */
export function factionForAi(cardId: CardId): DeckFaction {
  if (cardId.startsWith('gpt-') || cardId.startsWith('chatgpt-')) return 'gpt'
  if (cardId.startsWith('claude-')) return 'claude'
  if (cardId.startsWith('kimi-')) return 'kimi'
  if (cardId.startsWith('deepseek-')) return 'deepseek'
  return 'other'
}

/** 种类页签的三档：全部 / AI 牌 / 技能牌。 */
export type DeckCardKindFilter = 'all' | 'ai' | 'skill'

/**
 * 卡池筛选：先按种类，再按阵营。
 *
 * **阵营只作用于 AI 牌**：技能牌没有阵营，传了阵营也照样全部显示——
 * 把它们一起筛掉等于让玩家选个阵营就再也看不见技能牌，而他并没有表达过「不想看技能牌」。
 * 界面上只有「AI 牌」页签摆阵营药丸，另外两档一律以 `faction = null` 进来，
 * 所以这条兜底规则只在直接调这个纯函数时才看得见（测试就是这么用的）。
 *
 * 卡表里查不到的 id 直接丢掉：这个函数吃的是调用方给的一串 id（可能来自存档），
 * 为一张不存在的卡抛错会让整页打不开，而少一张只是少一张。
 */
export function filterDeckCards(
  cardIds: readonly CardId[],
  kind: DeckCardKindFilter,
  faction: DeckFaction | null,
): CardId[] {
  return cardIds.filter((cardId) => {
    const card = CARDS[cardId]
    if (card === undefined) return false
    if (kind !== 'all' && card.kind !== kind) return false
    if (card.kind === 'skill') return true
    return faction === null || factionForAi(cardId) === faction
  })
}

/**
 * 构筑页要摆出来的全部卡，顺序就是卡池里从左到右、从上到下的顺序。
 *
 * = 能选的整个卡池 + 两批**选不了但要画出来**的灰卡（「即将上线」的技能牌、
 * OpenRouter 上调不到模型的两张 AI）。灰卡拼在最后，于是它们天然排在所有能选的卡之后——
 * 排序就靠这一行拼接，没有别的排序规则（旧版 `DeckScreen` 的 `DISPLAY_CARD_IDS` 同）。
 *
 * 灰卡照样画出来是有意的：那批牌已经有原画和文案，藏起来的话玩家根本不知道它们存在，
 * 而「看得见但选不了、碰一下说一句为什么」比「压根没有」更说得清后面还有内容。
 */
export const DECK_DISPLAY_CARD_IDS: readonly CardId[] = [
  ...CARD_POOL,
  ...COMING_SOON_SKILL_CARD_IDS,
  ...UNAVAILABLE_AI_CARD_IDS,
]

/**
 * 一张卡为什么选不了，`null` 表示能选。
 *
 * 只答「和牌组状态无关」的那一类：产品还没开放、模型调不到。
 * 「牌组满 20 张」「同名已经 3 份」那两条要看当前牌组，归界面自己算
 *（见 canvas 的 scenes/deck/logic/legality.ts）。
 *
 * 两句话写在这里而不是界面里，是因为它们说的是**卡本身的状态**，和牌组页、
 * 将来的图鉴页、开包页说的会是同一句；`NO_MODEL` 刻意不提 OpenRouter——
 * 那是我们的实现细节，玩家不需要知道。
 */
export function blockedReasonOf(cardId: CardId): string | null {
  if (COMING_SOON_SKILL_CARD_IDS.includes(cardId)) return '即将上线'
  if (UNAVAILABLE_AI_CARD_IDS.includes(cardId)) return '暂未接入'
  return null
}

/** 这张卡是不是 AI 牌。构筑页按它决定卡背有没有技能说明可翻。 */
export function isAiCard(cardId: CardId): boolean {
  return AI_MODEL_CARDS[cardId] !== undefined
}
