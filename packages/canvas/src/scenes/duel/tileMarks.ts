/**
 * 战场小卡上那一列角标：这个单位现在怎么了。
 *
 * 纯函数，只读一份 `AiInstance` 加一个「主人被金钟罩罩着吗」，所以不用起画布就测得了。
 * 原样搬自旧客户端 `ui/tileMarks.ts`。旧版每一档还带一个配色（CSS 修饰类），
 * 正式版简化第 4 步之二把角标剥成素方块之后没有配色可挑了，只剩文案。
 *
 * 写的是这个单位**现在是什么状态**而不是牌名（「复读中」不是「复读机」）：
 * 角标要回答的是「这张卡怎么了」。干扰按种类分而不是笼统写「已干扰」——
 * 两种干扰这一轮的后果完全不同（复读机必错、黑白颠倒把判定翻面），
 * 玩家要据此决定救哪一个。
 */

import type { AiInstance, CardId } from '@ai-duel/core'
import type { TileMark } from '../../components/BoardTile'

/**
 * 本轮打在场上单位身上的技能牌各挂一枚什么角标，键就是牌 id（跟着 `affectedBy` 查）。
 *
 * 凡是效果落在某个单位身上的技能牌都得在这里有一格，否则那张牌打出去战场上不留痕迹——
 * 引擎往 `affectedBy` 记一笔的同时，这里也要补上文案（漏了会落到通用的「被影响」）。
 * 「金钟罩」不在表里：它罩的是整个人而不是某个单位，另算一档。
 */
const SKILL_EFFECT_MARKS: Record<CardId, TileMark> = {
  'fixed-answer': { text: '复读中' },
  'black-white-reversal': { text: '已颠倒' },
  'jade-purification-vase': { text: '已净化' },
  'safe-pass': { text: '保送' },
}

/**
 * 挂常驻角标、所以不再进本轮那一批的技能牌。
 *
 * 只有「鸡犬升天」一张：它的痕迹记在 `AiInstance.evolvedTimes` 上，一直挂到单位下场，
 * 本轮那一批照常跳过它（不跳过会落到通用的「被影响」上，同一件事说两遍）。
 */
const PERSISTENT_MARK_CARDS = new Set<CardId>(['rising-tide'])

/**
 * 这个单位该挂哪几枚角标，按从上到下的顺序排。
 *
 * 先排本轮打在它身上的技能牌（按命中先后，进下一轮自己消失），接着是主人的金钟罩，
 * 最后两枚跟着单位走：鸡犬升天的「已进化」和英雄技能的升降级。
 * 顺序固定是为了同时挂两三枚时不会跳来跳去。
 *
 * `levelShift` 是净升降次数：一方升、另一方又降回去会留下一个 0，
 * 那时这张卡的 cardId 已经变回原样，所以 0 不挂角标。
 */
export function tileMarksOf(ai: AiInstance, shielded: boolean): TileMark[] {
  const marks: TileMark[] = []
  for (const cardId of ai.affectedBy ?? []) {
    if (PERSISTENT_MARK_CARDS.has(cardId)) continue
    marks.push(SKILL_EFFECT_MARKS[cardId] ?? { text: '被影响' })
  }
  if (shielded) marks.push({ text: '金钟罩' })
  const evolved = ai.evolvedTimes ?? 0
  if (evolved > 0) {
    marks.push({ text: evolved > 1 ? `已进化 ×${evolved}` : '已进化' })
  }
  const shift = ai.levelShift ?? 0
  if (shift > 0) marks.push({ text: '已升级' })
  else if (shift < 0) marks.push({ text: '已降级' })
  return marks
}
