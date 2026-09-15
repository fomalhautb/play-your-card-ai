/**
 * 各界面要用的图片清单——**图集之外的那些**。
 *
 * 卡面（AI 牌、技能牌、卡背）不在这里：它们打成了图集，由场景自己按需装卸
 *（`pnpm assets:build` 的 models / skills / backs 三组）。这里列的是整幅的界面底图和
 * 英雄牌，它们一张一用，进图集只会浪费图集页。
 *
 * **这里是图集之外全部图片的总目录**：`assets/source` 下每一张进了壳 public 的图都要落进
 * 下面某一份清单，漏掉的那张就会退回「用到时才开始下」，玩家先看到一块白再看到它显影。
 * 反过来也一样：没人用的图该连源文件一起删，而不是留在清单里白等
 *（正式版简化第 5 步就是这么处理关于页那张背景的）。
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
 * 后台预加载的排队顺序，按「主流程会先用到谁」排，前一组下完才开下一组。
 *
 * 现在只剩一组。玩家的实际路径是首页 → 房间 → 选英雄 → 对局，而首页、房间页、对局页和
 * 关于页都已经不要图了（正式版简化第 4 步把三页剥成素方块，对局页那六张底图连源文件一起删；
 * 第 5 步删掉了关于页那张没人用的背景 `INFO_IMAGES`），所以队列里只有选英雄页。
 * 分组这层结构留着：加一页要等图时照旧往后排一组，不用改 useAssets 那边。
 */
export const PRELOAD_GROUPS: readonly (readonly string[])[] = [HERO_IMAGES]
