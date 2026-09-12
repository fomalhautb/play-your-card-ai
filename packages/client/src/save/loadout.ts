/**
 * 「这台机器上现在用哪副牌、哪位英雄」——单机和联机开局都从这里取。
 *
 * 从 match/localMatch.ts 里拎出来的：联机（迁移第 27 条后半）要报同一份东西给服务端
 *（`room:loadout`），而抄一份的下场是「本地能打、联机摸空」这种只有两台机器凑齐才看得见的错。
 *
 * 选牌和选英雄的界面是第 28、30 条的事，在那之前这两个函数就是全部的「出战配置」。
 */

import { BALANCED_DECK, isLegalDeck } from '@ai-duel/content'
import type { CardId, HeroId } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import { loadDecks } from './deckStore'
import { loadSave } from './saveStore'

/**
 * 存档里当前那副牌，不合法就退回平衡预设。
 *
 * 必须自己查一遍合法性：`deckStore` 存的是**正在编辑**的牌组，允许只有几张甚至一张都没有
 *（玩家可以编到一半就走人），直接拿去开局会摸空。联机时更严重——服务端那边会直接回
 * `room:error bad-loadout`，玩家只看得到一句「这副牌组不合法」，却不知道该去哪儿改。
 */
export function currentDeck(platform: Platform): CardId[] {
  const data = loadDecks(platform)
  const cards = data.decks.find((deck) => deck.id === data.currentId)?.cards ?? []
  return isLegalDeck(cards) ? [...cards] : [...BALANCED_DECK]
}

/** 存档里确认过的英雄。没选过是 null——协议和引擎都认这一档（各自吃自己的默认英雄）。 */
export function currentHero(platform: Platform): HeroId | null {
  return loadSave(platform).savedHero
}
