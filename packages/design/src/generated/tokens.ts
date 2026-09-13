/**
 * 本文件由 sd.config.mjs 自动生成，不要手改。
 * 改令牌请改 packages/design/tokens/*.json，然后跑 `pnpm --filter @ai-duel/design build` 并把产物一起提交。
 */

export const tokens = {
  duration: {
    hand: {
      /** 手牌重排（加牌、减牌、改窗口大小）的时长。两侧手牌共用同一个值，加减牌时上下两排的节奏才是一套的。来源：黑客松版的 ui/fanMath.ts 的 LAYOUT_DUR，HandFan 和 OpponentFan 都读它。 */
      layout: 0.4,
    },
    card: {
      /** 卡牌放大查看的进场时长。来源：黑客松版的 ui/CardZoomOverlay.tsx 的 ZOOM_IN_DUR，CardZoomOverlay、HeroScreen、DeckScreen 三处共用。 */
      zoomIn: 0.55,
      /** 卡牌放大查看的退场时长，比进场略长。来源：CardZoomOverlay.tsx 的 ZOOM_OUT_DUR，同样三处共用（DeckScreen 还拿它当后续动作的延迟基准）。 */
      zoomOut: 0.6,
      /** 卡片加载动画弹一次的周期，卡片和它的影子共用同一个周期。来源：styles.css 的 .card-loader --cl-speed（index.html 里的首屏 loader 抄了同一份）。 */
      loaderCycle: 1.75,
    },
    home: {
      /** 首页人物金色高亮和介绍卡片的淡入时长。进入比离开慢一点，出现时看得出是「浮上来的」。来源：styles.css 的 .home__stage --home-cast-fade-in。 */
      castFadeIn: 0.26,
      /** 首页人物高亮和介绍卡片的淡出时长。必须短于淡入：换人时是两张介绍卡片在同一块地方交叉，旧卡要先退干净才不会叠成重影。来源：styles.css 的 .home__stage --home-cast-fade-out。 */
      castFadeOut: 0.2,
      /** 首页人物介绍卡片淡入的起跑延迟，只有卡片用、高亮不用。和上面那对时长配合，让旧卡先退干净。来源：styles.css 的 .home__stage --home-cast-panel-in-delay。 */
      castPanelDelay: 0.08,
      /** 首页「开始游戏」匾额那条常驻上下浮动的周期。慢到几乎看不出在动，但页面因此不是死的。来源：styles.css 的 .home__start 动画。 */
      startFloat: 3.2,
    },
    plaque: {
      /** 匾额按钮压下去那一下。快得几乎看不见过程，压入本身才像"当场吃住了力"。来源：styles.css 的 .plaque-button:active transition-duration，也是 PlaqueButton.tsx 的 MIN_PRESS_MS（70ms）。 */
      press: 0.07,
      /** 匾额按钮弹回来那一下。比压下去慢三倍，弹性曲线才有余地走完。来源：styles.css 的 .plaque-button transition。 */
      release: 0.22,
    },
    button: {
      /** 按钮悬停换色的过渡。旧样式里多处都是 0.16~0.18s 这一档，取最长的那档。来源：styles.css 的 .plaque-button::before background-color 180ms。 */
      hover: 0.18,
    },
    reveal: {
      /** 展示层里那张卡上下浮一趟的时长。强制观看的 1.5 秒停留期间它一直浮着，所以这个数决定「停住的那张牌看起来活不活」。来源：ui/MatchStage.tsx 强制展示那段停留里的 yoyo 补间。 */
      float: 1.15,
      /** 展示层卡底下那行字幕淡入的时长。来源：ui/MatchStage.tsx:2568-2577 的字幕补间。 */
      caption: 0.28,
    },
    targeting: {
      /** 选目标层压暗淡入淡出的时长，进出同一个数。旧版这一层是 CSS 直接切的，Pixi 这边给一小段过渡观感更连贯，取的是 styles.css 里那一档最常见的过渡时长。 */
      in: 0.18,
    },
    settle: {
      /** 结算层结果卡上「作答中」那三个点跳一次的周期。来源：styles.css 的 .settle__loader-dot 动画。 */
      dots: 0.45,
      /** 结算层顶栏比分跳动那一下的单程时长（来回各一趟，合起来 0.35 秒，正好是 SETTLE_SCORE_MS 的最后一段）。来源：ui/RoundSettleLayer.tsx:591-635 的比分脉冲。 */
      scorePulse: 0.175,
    },
    bubble: {
      /** 气泡淡入。来源：styles.css 的 battle-urge-bubble-in。 */
      in: 0.24,
      /** 气泡淡出。来源：ui/HandFan.tsx 里 lock-tip 的收尾补间。 */
      out: 0.25,
      /** 喊话气泡从弹出到自己消失的停留时长。来源：ui/MatchStage.tsx 的 URGE_BUBBLE_MS。 */
      hold: 3.2,
    },
  },
  size: {
    card: {
      /** 卡面基准宽。全站卡牌的几何都从这个数派生，扇形手牌的间距和 hover 放大的下限也按它算。来源：黑客松版的 styles.css 的 :root --card-w（和 ui/fanMath.ts 的 CARD_WIDTH 是同一个数）。 */
      width: 150,
      /** 卡面基准高，和宽保持 2:3。来源：styles.css 的 :root --card-h（和 fanMath.ts 的 CARD_HEIGHT 同值）。 */
      height: 225,
      /** 卡面圆角，按卡宽 150 配。不放进 radius 阶梯里：那一组是全站通用的圆角档位（按 styles.css 的取值统计出来的），而这一个是卡牌自己的几何，和 width / height 一样要按比例缩放——图集里 512 宽的原画烤的是 512 × 8 / 150 ≈ 27 的圆角。来源：黑客松版 styles.css 的 .card-face（正式版简化第 4 步之三按它把 10 改回 8；10 是从 ui/paper/paper.css 的 .paper-card 抄来的，那是纸面组件的圆角，不是卡面的）。凡是画到卡角的地方都必须用它，用它的那几处列在 canvas 的 layout/fanMath.ts 的 CARD_RADIUS 上（加一处就往那儿补一条，别在这里再抄一份）。 */
      radius: 8,
      /** 战场上小卡的宽。来源：styles.css 的 :root --tile-w。 */
      tileWidth: 110,
      /** 战场小卡的高。必须和卡面同比例，否则打出时的飞行会把卡面拉变形。来源：styles.css 的 :root --tile-h。 */
      tileHeight: 165,
      /** 战场小卡相对卡面的缩放倍数（110 / 150）。来源：styles.css 的 :root --tile-scale。 */
      tileScale: 0.733333,
      /** 点开放大查看时，屏幕中央那张展示卡相对卡面的倍数，桌面档普通卡（150x225 放到 255x382.5）。来源：styles.css 的 :root --reveal-scale。 */
      revealScale: 1.7,
      /** 桌面档英雄牌的放大倍数。侧栏那张英雄牌本身就有 259x389，按 1.7 飞到中央反而比原位还小，所以单独调高一档。来源：styles.css 的 .reveal-clip--hero --reveal-scale。 */
      revealScaleHero: 2.2,
      /** 触屏档普通卡的放大倍数。1.7 倍在手机上只有约 126 个屏幕像素宽，和「点开看清楚」差得远。来源：styles.css 末尾 @media (pointer: coarse) 的 .battle-scaler --reveal-scale。 */
      revealScaleTouch: 2.2,
      /** 触屏档英雄牌的放大倍数，上界是舞台高 941（卡上沿落在 107，字幕落在 781，都进得来）。来源：styles.css 末尾 @media (pointer: coarse) 的 .reveal-clip--hero。 */
      revealScaleHeroTouch: 2.9,
    },
    battle: {
      /** 对局顶栏高度，桌面档。不止排版要用：展示卡的裁剪层也拿它当「顶栏下沿」那条线。来源：styles.css 的 .battle --battle-topbar-h。 */
      topbarHeight: 72,
      /** 对局顶栏高度，触屏档。字放大之后要把地方让给战场和手牌，而顶栏只有轮次和比分，是最不需要看清的部分。来源：styles.css 末尾 @media (pointer: coarse) 的 .battle。 */
      topbarHeightTouch: 56,
      /** 对局左侧栏宽度，桌面档。两排扇形手牌靠它让开侧栏、正对战场居中，三处必须是同一个数。来源：styles.css 的 .battle --battle-side-w。 */
      sidebarWidth: 306,
      /** 战场底部留给自己手牌的高度。来源：styles.css 的 .battle__battlefield --battle-hand-zone-h。 */
      handZoneHeight: 250,
      /** 战场顶部留给对方手牌的高度。正式对局里对方手牌是不占文档流的倒扇形，在顶栏下方露出约 72px，84 正好给它让开。来源：styles.css 的 .battle__battlefield --battle-foe-hand-h。 */
      foeHandHeight: 84,
    },
    settle: {
      /** 回合结算层里每张结算卡的最小宽度，也是「一行最多摆几列」的推导依据（超宽就改成横向滚动）。来源：styles.css 的 .settle__cards --settle-card-min-w。 */
      cardMinWidth: 300,
    },
    rail: {
      /** 战场右缘 Token 细条的宽。来源：styles.css 的 .battle__token-rail。 */
      width: 44,
      /** Token 细条的高。来源同上。 */
      height: 470,
    },
  },
} as const

/** 全部设计令牌的类型，值精确到字面量。 */
export type Tokens = typeof tokens
