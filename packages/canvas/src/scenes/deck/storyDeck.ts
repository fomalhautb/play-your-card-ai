/**
 * 目录页那几条构筑页条目要的一份**最小卡池**和几套牌组。
 *
 * 只服务 `DeckScene.stories.ts`。为什么不用真卡池：`canvas` 不许依赖 `content`
 *（依赖方向见《正式版架构》7.2 第 1 条），而目录页要的只是「一屏每次都长一样的卡」。
 * 牌的 id 用真图集里的贴图名——「id 即文件名」那条约定（见 duel/cardVisuals.ts）
 * 让它们直接查得到卡面。
 */

import type { Catalog } from '@ai-duel/core'
import type { DeckView } from '../deckContract'
import type { PoolCard } from './logic/types'

/** 十二张 AI 牌加两张技能牌。够摆满桌面档两页、手机档三页，还能试出翻页钮的灰态。 */
const AI_IDS = [
  'gpt-3-5',
  'gpt-4o',
  'chatgpt-5-6-sol',
  'claude-5-sonnet',
  'claude-fable-5',
  'deepseek-r1',
  'deepseek-v4',
  'kimi-k2-6',
  'kimi-k3',
  'gemini',
  'qwen',
  'doubao',
] as const
const SKILL_IDS = ['safe-pass', 'model-distillation'] as const
/** 一张「即将上线」的灰卡，专门用来拍那块牌子和压暗那一层。 */
const BLOCKED_ID = 'fixed-answer'

const NAMES: Record<string, string> = {
  'gpt-3-5': 'GPT-3.5',
  'gpt-4o': 'GPT-4o',
  'chatgpt-5-6-sol': 'ChatGPT-5.6',
  'claude-5-sonnet': 'Claude',
  'claude-fable-5': 'Claude Fable',
  'deepseek-r1': 'DeepSeek R1',
  'deepseek-v4': 'DeepSeek V4',
  'kimi-k2-6': 'Kimi K2.6',
  'kimi-k3': 'Kimi K3',
  gemini: 'Gemini',
  qwen: '通义千问',
  doubao: '豆包',
  'safe-pass': '保送',
  'model-distillation': '模型蒸馏',
  'fixed-answer': '复读机',
}

/** 阵营按 id 前缀分，和 content 的 `factionForAi` 同一条规则（那份是正本）。 */
function factionOf(cardId: string): string {
  if (cardId.startsWith('gpt-') || cardId.startsWith('chatgpt-')) return 'gpt'
  if (cardId.startsWith('claude-')) return 'claude'
  if (cardId.startsWith('kimi-')) return 'kimi'
  if (cardId.startsWith('deepseek-')) return 'deepseek'
  return 'other'
}

export const STORY_FACTIONS: readonly { id: string; label: string }[] = [
  { id: 'gpt', label: 'GPT' },
  { id: 'claude', label: 'Claude' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'other', label: '其他' },
]

/** 卡池：能选的那批在前，灰卡拼在最后（顺序即摆放顺序，同 content 的展示清单）。 */
export const STORY_POOL: readonly PoolCard[] = [
  ...AI_IDS.map(
    (cardId): PoolCard => ({
      cardId,
      kind: 'ai',
      faction: factionOf(cardId),
      blockedReason: null,
    }),
  ),
  ...SKILL_IDS.map(
    (cardId): PoolCard => ({
      cardId,
      kind: 'skill',
      faction: 'other',
      blockedReason: null,
    }),
  ),
  { cardId: BLOCKED_ID, kind: 'skill', faction: 'other', blockedReason: '即将上线' },
]

function makeCatalog(): Catalog {
  const cards: Catalog['cards'] = {}
  for (const entry of STORY_POOL) {
    const name = NAMES[entry.cardId] ?? entry.cardId
    cards[entry.cardId] =
      entry.kind === 'ai'
        ? {
            kind: 'ai',
            id: entry.cardId,
            name,
            model: name,
            skillName: '示例技能',
            skillText: '目录页用的占位说明。',
            openrouter: null,
            tokenCost: 3,
            text: '目录页用的占位卡面文案。',
          }
        : {
            kind: 'skill',
            id: entry.cardId,
            name,
            tokenCost: 2,
            text: '目录页用的占位卡面文案。',
          }
  }
  /*
   * 英雄一个都不带。`Catalog.heroes` 的类型要求七位齐全，而构筑页一次都不查这张表
   *（英雄不进牌组，见 core 的 HeroCard）。编七份假英雄只是为了让类型过关。
   */
  return { cards, heroes: {} as Catalog['heroes'] }
}

export const STORY_CATALOG: Catalog = makeCatalog()

/**
 * 目录页这一池卡的卡面展示配置。
 *
 * 真构筑页读的是 `@ai-duel/content` 的 `CARD_FACES`，canvas 不许依赖 content，
 * 所以这里按卡池顺序轮着发几个颜色。不配的话整页的费用章都是兜底的卡种色
 *（AI 一片亮蓝、技能一片亮橙），而这一条条目要拍的正是卡面在真界面里的样子。
 * AI 牌给 `accent`（盘底由它调出来），技能牌给 `costFill`（真数据里那是从原画采的色）。
 * 圆心一律走兜底位置：这一页的卡缩得很小，那点偏移在截图上分不出来。
 */
export const STORY_CARD_FACES: Record<string, { accent?: string; costFill?: string }> =
  Object.fromEntries(
    STORY_POOL.map((entry, index) => [
      entry.cardId,
      entry.kind === 'ai'
        ? { accent: ['#46584b', '#87502d', '#304e70', '#37646b'][index % 4] ?? '#304e70' }
        : { costFill: ['#4f5652', '#484c46', '#584954'][index % 3] ?? '#4f5652' },
    ]),
  )

/** 三套牌组。第一套空着、第二套满 20 张、第三套半满，正好把三种画面都摆得出来。 */
export function storyDecks(): DeckView[] {
  const full: string[] = []
  // 满 20 张：每张带三份，同名满份数那一档的压暗和角标也就一起拍到了。
  while (full.length < 20) {
    for (const id of AI_IDS) {
      if (full.length >= 20) break
      if (full.filter((one) => one === id).length >= 3) continue
      full.push(id)
    }
  }
  return [
    { id: 'empty', name: '新牌组', cards: [] },
    { id: 'full', name: '满编', cards: full },
    { id: 'half', name: '配一半', cards: full.slice(0, 9) },
  ]
}
