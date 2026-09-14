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
 * 首页那张画的各层：夜空底、桌子、道具、匾额。
 *
 * 首页要等这些全部到齐才上场——浏览器是拿到一张画一张，不等的话玩家会看着
 * 夜空、桌子、道具一层层往上冒。
 */
export const HOME_IMAGES: readonly string[] = [
  '/home/home-bg.webp',
  '/home/home-table.webp',
  '/home/home-props.webp',
  '/home/home-plaque.webp',
]

/** 房间页：底图那一套雕花切片，外加和英雄页共用的那张背景。 */
export const ROOM_IMAGES: readonly string[] = [
  '/hero/hero-bg.webp',
  '/room/book.webp',
  '/room/flourish-l.webp',
  '/room/flourish-r.webp',
  '/room/substar-l.webp',
  '/room/substar-r.webp',
  '/room/panel.webp',
  '/room/code-plaque.webp',
  '/room/copy-frame.webp',
  '/room/divider.webp',
  '/room/input-frame.webp',
  '/room/join-btn.webp',
  '/room/banner-deck.webp',
  '/room/banner-hero.webp',
  '/room/foot.webp',
]

/**
 * 选英雄页：背景加七张人物卡。
 *
 * 卡面按英雄 id 现算而不是写死文件名（「id 即文件名」，见 content 的 test/assets.test.ts）：
 * 加一位英雄就自动进清单，抄一份文件名迟早对不上。
 */
export const HERO_IMAGES: readonly string[] = [
  '/hero/hero-bg.webp',
  ...Object.keys(HEROES).map((id) => `/hero/card-${id}.webp`),
]

/**
 * 关于页那张背景，就一张。
 *
 * 现在**没有界面在用它**：正式版简化第 3 步把关于页的背景图（纯装饰）去掉了，
 * 那一页也不再设等图闸门。仍然列在这里是因为这份清单是「图集之外全部图片的总目录」
 *（见文件头），图还在 assets/source 下就得有人登记，否则 test/assetManifests.test.ts 会红。
 */
export const INFO_IMAGES: readonly string[] = ['/info/info-bg.webp']

/**
 * 对局页：战场底图、猜先的两张硬币、终局结算的三张底板。
 *
 * 三张结算底板暂时没人用：正式版简化第 3 步把结算面板的底图（纯装饰）去掉了。
 * 留在这里的理由同 `INFO_IMAGES`——这份清单要盖住 assets/source 下的每一张图。
 */
export const BATTLE_IMAGES: readonly string[] = [
  '/battle/battle-bg.webp',
  '/battle/coin-first.webp',
  '/battle/coin-second.webp',
  '/battle/final-victory-bg.webp',
  '/battle/final-defeat-bg.webp',
  '/battle/final-draw-bg.webp',
]

/**
 * 后台预加载的排队顺序，按「主流程会先用到谁」排，前一组下完才开下一组。
 *
 * 玩家的实际路径是首页 → 房间 → 选英雄 → 对局，所以房间页排第一、对局页排第三。
 * 首页那份排最后：能跑到这行代码就说明首页的闸门已经放行、那批图早在缓存里了，
 * 列它只为让「每张图都在某份清单里」这条不变量成立，实际不会真发出请求。
 * 关于页在主流程之外，和首页一起垫底。
 *
 * 清单之间重复不要紧（房间页和英雄页都含 hero-bg）：分组是串行的，
 * 排到后一组时这张已经有结果了，会被直接跳过。
 */
export const PRELOAD_GROUPS: readonly (readonly string[])[] = [
  ROOM_IMAGES,
  HERO_IMAGES,
  BATTLE_IMAGES,
  INFO_IMAGES,
  HOME_IMAGES,
]
