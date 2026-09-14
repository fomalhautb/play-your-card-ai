/**
 * 首页橱窗里摆哪四张卡。
 *
 * 这份名单放在装配层，因为它挑的是**内容**里的卡，而 canvas 不许 import `content`
 *（依赖方向见架构 7.2 第 1 条）。
 *
 * 这里原先还有两样东西：一张「七张人物抠图 ↔ 英雄 id」的表（`HOME_CAST`，随简化第 2 步
 * 删掉首页人物层一起去掉），以及那幅画各层的地址（`HOME_OCCLUDERS` / `homeArtUrl`，
 * 随简化第 4 步把首页剥成素方块一起去掉）。
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
