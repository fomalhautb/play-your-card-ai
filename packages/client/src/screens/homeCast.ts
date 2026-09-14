/**
 * 首页橱窗里摆哪四张卡，以及那幅画各层的地址。
 *
 * 这份对照表放在装配层，因为它把**素材**和**内容**接在一起，而 canvas 两样都不认识：
 * 它不许 import `content`（依赖方向见架构 7.2 第 1 条），也不管资源从哪来（第 2 节第 5 条）。
 *
 * 这里原先还有一张「七张人物抠图 ↔ 英雄 id」的表（`HOME_CAST`），
 * 随正式版简化第 2 步删掉首页人物层一起去掉了。
 */

import type { CardId } from '@ai-duel/core'

/**
 * 橱窗里那四张展示卡：四家各自的旗舰款（GPT / Claude / DeepSeek / 豆包）。
 *
 * 首页是门面，摆一眼能认出品牌的那张，比摆早期型号更说明这游戏在玩什么（旧版同一份挑法）。
 * 取的是卡池里的**真卡**，所以这里看到的名字、费用、插画和对局里抽到同一张时完全一致。
 */
export const HOME_SHOWCASE: readonly CardId[] = [
  'chatgpt-5-6-sol',
  'claude-fable-5',
  'deepseek-v4',
  'doubao',
]

/** 压在展示卡之上的两层：桌面弧和前景道具。顺序就是层叠顺序。 */
export const HOME_OCCLUDERS = ['home-table', 'home-props'] as const

/** 首页那幅画各层的地址。和 `preload/manifests.ts` 的 `HOME_IMAGES` 是同一批图。 */
export function homeArtUrl(file: string): string {
  return `/home/${file}.webp`
}
