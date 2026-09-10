/**
 * 首页那幅画里的七个人是谁、橱窗里摆哪四张卡。
 *
 * 这两份对照表放在装配层，因为它们把**素材**和**内容**接在一起，而 canvas 两样都不认识：
 * 它不许 import `content`（依赖方向见架构 7.2 第 1 条），也不管资源从哪来（第 2 节第 5 条）。
 *
 * 抠图文件名和英雄 id 之所以要一张表而不是「id 即文件名」，是因为这七张图画的是
 * 同一幅画里各自站位的那个人（左后、左前、右侧戴眼镜……），文件名说的是**站位**不是身份。
 * 换人只要重新导出同名的图，这张表跟着改一行。
 */

import type { CardId, HeroId } from '@ai-duel/core'

/**
 * 七个人物，**顺序就是叠放顺序**：数组靠后的盖住靠前的，也就是站在前排的排在后面。
 * 这个顺序同时是 hover 命中的优先级（见 canvas 的 castHit.ts）。
 */
export const HOME_CAST: readonly { file: string; hero: HeroId }[] = [
  { file: 'cast-left-back', hero: 'margaret-hamilton' },
  { file: 'cast-left-officer', hero: 'grace-hopper' },
  { file: 'cast-left-front', hero: 'fei-fei-li' },
  { file: 'cast-right-glasses', hero: 'danqi-chen' },
  { file: 'cast-right-laugh', hero: 'melanie-perkins' },
  { file: 'cast-right-classic', hero: 'ada-lovelace' },
  { file: 'cast-right-front', hero: 'mira-murati' },
]

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

/** 压在人物之上的两层：桌面弧和前景道具。它们既是画面也是命中的遮挡层。 */
export const HOME_OCCLUDERS = ['home-table', 'home-props'] as const

/** 首页那幅画各层的地址。和 `preload/manifests.ts` 的 `HOME_IMAGES` 是同一批图。 */
export function homeArtUrl(file: string): string {
  return `/home/${file}.webp`
}
