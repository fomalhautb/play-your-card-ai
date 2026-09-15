/**
 * 各界面要用的图片清单——**图集之外的那些**。
 *
 * 卡面（AI 牌、技能牌、卡背）不在这里：它们打成了图集，由场景自己按需装卸
 *（`pnpm assets:build` 的 models / skills / backs 三组）。这里列的是整幅的界面底图和
 * 英雄牌，它们一张一用，进图集只会浪费图集页。
 *
 * **这里是图集之外全部图片的总目录**：`assets/source` 下每一张进了壳 public 的图都要落进
 * 下面某一份清单，漏掉的那张就会退回「用到时才开始下」，玩家先看到一块白再看到它显影。
 * test/assetManifests.test.ts 会扫源目录逐张核对，加图忘了登记会被它拦下。
 *
 * 地址是壳 public 下的路径，和 assets/source 下的目录一一对应（见 assets/README.md）。
 */

import { HEROES } from '@ai-duel/content'

/**
 * 选英雄页：七张人物卡。
 *
 * 背景底图在正式版简化第 4 步之五连源文件一起删了——那一页剥成素方块之后只剩一层底色。
 *
 * 卡面按英雄 id 现算而不是写死文件名（「id 即文件名」，见 content 的 test/assets.test.ts）：
 * 加一位英雄就自动进清单，抄一份文件名迟早对不上。
 */
export const HERO_IMAGES: readonly string[] = Object.keys(HEROES).map(
  (id) => `/hero/card-${id}.webp`,
)

/**
 * 关于页那张背景，就一张。
 *
 * 现在**没有界面在用它**：正式版简化第 3 步把关于页的背景图（纯装饰）去掉了，
 * 那一页也不再设等图闸门。仍然列在这里是因为这份清单是「图集之外全部图片的总目录」
 *（见文件头），图还在 assets/source 下就得有人登记，否则 test/assetManifests.test.ts 会红。
 */
export const INFO_IMAGES: readonly string[] = ['/info/info-bg.webp']

/**
 * 后台预加载的排队顺序，按「主流程会先用到谁」排，前一组下完才开下一组。
 *
 * 玩家的实际路径是首页 → 房间 → 选英雄 → 对局。首页、房间页和对局页都已经不要图了
 *（正式版简化第 4 步把这三页剥成素方块，对局页那六张底图连源文件一起删了），
 * 所以队头就是选英雄页。关于页在主流程之外，垫底。
 */
export const PRELOAD_GROUPS: readonly (readonly string[])[] = [HERO_IMAGES, INFO_IMAGES]
