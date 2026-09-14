/**
 * 本地存档：玩家的卡牌收藏、胜场，以及上次确认的英雄。
 *
 * 只有本机这一层，不做账号、不上服务器——换个浏览器就是新号。
 * 所有 IO 走 `platform.storage`（隐私模式下读写会抛，那一层已经吞掉了），
 * 随机数由调用方传进来，`content` 那边的收藏逻辑保持纯函数。
 *
 * 牌组不在这里：玩家可以存多套、还要能改名删除，那份数据自己一位存档，见 deckStore.ts。
 * 这边只剩「一次性的选择结果」这一类。
 */

import { CARD_POOL, drawNewCard, HEROES, heroIdSchema, INITIAL_COLLECTION } from '@ai-duel/content'
import type { CardId, HeroId } from '@ai-duel/core'
import type { Platform, StorageSlot } from '@ai-duel/platform'
import { z } from 'zod'

export interface SaveData {
  /** 已拥有的卡牌定义 id。有序：构筑页可以把卡拖到卡池的指定位置，存的就是那一下的顺序。 */
  ownedCards: CardId[]
  /** 累计胜场。 */
  wins: number
  /** 上次确认的英雄；没确认过是 null。 */
  savedHero: HeroId | null
  /**
   * 玩家在设置页要求「减少动效」。
   *
   * 两边都读它：DOM 那半边由应用壳翻成 `<html data-reduced-motion="true">`，
   * 约定是 `ui` 的 CSS 认这个属性（同时也认系统的 `prefers-reduced-motion`），
   * 不过现在一份都没在认，原委见 app/reducedMotion.ts；
   * 画布那半边由 `DuelStage` 透给场景，关掉震屏和跟指针跑的倾斜 / 反光
   *（见 canvas 的 duelContract.ts 的 `reducedMotion`）。
   *
   * 放在主存档而不是像静音那样单独一位：静音是玩家在对局里随手按的，
   * 主存档换版本号作废时不该连它一起忘掉；这一项是在设置页里点的，
   * 和「上次选的英雄」一样属于这个号的一次性选择。代价是主存档作废时它会回到默认的关，
   * 而默认关本来就是安全的那一档。
   */
  reducedMotion: boolean
}

/**
 * 存档的形状。字段级的校验到此为止，「这张卡还在不在卡池里」那类要查内容表的规整在下面做。
 *
 * `wins` 卡成非负整数而不是任意 number：存档是玩家机器上的一段文本，
 * 手改成 -1 或 NaN 之后胜场会一路带进界面，不如整份当坏档作废，回到新号。
 */
const rawSaveSchema = z.object({
  ownedCards: z.array(z.string()),
  wins: z.number().int().min(0),
  // 缺字段和写坏都按「没选过 / 没开」算，所以这两项收成 unknown 再自己判。
  // `.optional()` 不能省：zod 4 里光写 z.unknown() 仍然要求这个键存在，
  // 而这几项恰恰是「上个版本的存档里根本没有」最常见的。
  savedHero: z.unknown().optional(),
  reducedMotion: z.unknown().optional(),
})

/**
 * 存档里的卡 id 白名单。
 *
 * 用卡池而不是初始收藏：这两份现在恰好相等（见 content 的 collection.ts），
 * 但意思不同——卡池是「这张牌能不能上桌」，初始收藏是「新号一开始送什么」。
 * 卡池扩容之后，玩家赢来的卡在卡池里、不在初始收藏里，拿初始收藏当白名单会把它们全丢掉。
 */
const POOL = new Set<CardId>(CARD_POOL)

/**
 * 存档位。
 *
 * 版本号是「作废旧档」的开关而不是迁移的路标（见 platform 的 storage.ts）：
 * 改了字段就 +1，旧数据读不到就当新号。
 * 正式版从 1 起，和旧版那把 `ai-duel-save-v7` 是两把不同的钥匙，同一个域名下互不影响。
 */
const SAVE_SLOT: StorageSlot<SaveData> = {
  name: 'ai-duel-save',
  // 简化第 1 步删掉了 `tutorialDone`，所以从 2 升到 3：旧档读不出来，当新号。
  version: 3,
  parse(raw) {
    const parsed = rawSaveSchema.safeParse(raw)
    if (!parsed.success) return null
    const { ownedCards, wins, savedHero, reducedMotion } = parsed.data

    // 卡池随时可能删卡，存档里残留的卡 id 必须丢掉，否则渲染时按 id 取卡会抛错。
    const owned = ownedCards.filter((id): id is CardId => POOL.has(id))
    // 一张都不剩说明这份存档已经和当前卡池对不上了，当作新号处理。
    if (owned.length === 0) return null

    return {
      // 基础收藏始终可用，存档只决定额外解锁的卡。去重是必须的：
      // 有重复项的话抽卡的候选集会被算错。
      ownedCards: [...new Set([...owned, ...INITIAL_COLLECTION])],
      wins,
      savedHero: validHero(savedHero),
      // 写坏或缺字段时按「没开」算。真需要它的人会自己去设置页打开，而系统级的
      // `prefers-reduced-motion` 那条路不经过存档，任何时候都照常生效。
      reducedMotion: reducedMotion === true,
    }
  },
}

/**
 * 存档里的英雄还算不算数。
 *
 * 两道关：名单里有没有这个人（`heroIdSchema` 是个 enum，所以 `'toString'` 这种
 * 原型链上的名字天然不算），以及她的技能实装了没有——选英雄界面已经把 `comingSoon`
 * 的几位置灰禁选，存档里留着的话下次进流程预填的就是一位现在选不了的英雄。
 */
function validHero(raw: unknown): HeroId | null {
  const parsed = heroIdSchema.safeParse(raw)
  if (!parsed.success) return null
  return HEROES[parsed.data].comingSoon === true ? null : parsed.data
}

function initialSave(): SaveData {
  return {
    ownedCards: [...INITIAL_COLLECTION],
    wins: 0,
    savedHero: null,
    reducedMotion: false,
  }
}

/** 读存档。读不到、解析失败、浏览器不让读，一律回落到初始收藏。 */
export function loadSave(platform: Platform): SaveData {
  return platform.storage.read(SAVE_SLOT) ?? initialSave()
}

/**
 * 记一场胜利：胜场 +1，并从未拥有的卡里抽一张。
 *
 * 注意现在的初始收藏就等于整个卡池（见 content 的 INITIAL_COLLECTION），
 * 所以这条抽卡链路暂时恒返回 null，只有胜场真的在涨。卡池扩容后会自动重新生效。
 *
 * @param random 取值范围 [0, 1) 的随机数。由调用方摇，这个模块和 content 都保持可复现。
 * @returns 写回后的存档，以及本次抽到的卡（已集齐时为 null）
 */
export function recordWin(
  platform: Platform,
  random: number,
): { save: SaveData; drawn: CardId | null } {
  const current = loadSave(platform)
  const drawn = drawNewCard(current.ownedCards, random)
  const save: SaveData = {
    ...current,
    wins: current.wins + 1,
    ownedCards: drawn === null ? current.ownedCards : [...current.ownedCards, drawn],
  }
  platform.storage.write(SAVE_SLOT, save)
  return { save, drawn }
}

/** 记下这次确认的英雄。 */
export function saveHero(platform: Platform, hero: HeroId): SaveData {
  return persist(platform, { ...loadSave(platform), savedHero: hero })
}

/**
 * 记下卡池的新排列。
 *
 * 参数里混着的其它 id 在这儿滤掉：构筑页会把「即将上线 / 暂未接入」那两类拼在卡池末尾展示，
 * 它们不在收藏里，写进去也会被下次读档丢掉，不如根本不写。
 * 这个顺序不影响任何玩法，读存档时也不做校正——只是玩家自己摆的架子。
 */
export function saveOwnedOrder(platform: Platform, order: readonly CardId[]): SaveData {
  const current = loadSave(platform)
  const kept = order.filter((id) => current.ownedCards.includes(id))
  // 漏了谁就按原来的顺序补在后面：调用方给的清单和存档对不上时（比如两个页面同时开着），
  // 宁可让顺序不完全如意，也不能把卡弄丢。
  const missing = current.ownedCards.filter((id) => !kept.includes(id))
  return persist(platform, { ...current, ownedCards: [...kept, ...missing] })
}

/**
 * 记下「减少动效」开关。设置页那一条走它。
 *
 * 只落盘，不负责让它生效：DOM 那半边由应用壳翻成 `<html>` 上的一个属性、
 * 画布那半边由 `DuelStage` 透给场景（两处都见 app/reducedMotion.ts）。
 */
export function setReducedMotion(platform: Platform, reducedMotion: boolean): SaveData {
  return persist(platform, { ...loadSave(platform), reducedMotion })
}

/** 清空存档，回到新号状态。设置页那颗「重置存档」和调试都走它。 */
export function resetSave(platform: Platform): SaveData {
  platform.storage.remove(SAVE_SLOT)
  return initialSave()
}

function persist(platform: Platform, save: SaveData): SaveData {
  platform.storage.write(SAVE_SLOT, save)
  return save
}
