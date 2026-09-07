/**
 * 本文件由 sd.config.mjs 自动生成，不要手改。
 * 改令牌请改 packages/design/tokens/*.json，然后跑 `pnpm --filter @ai-duel/design build` 并把产物一起提交。
 */

export const tokens = {
  color: {
    page: {
      /** 页面默认前景色。来源：legacy-client/src/styles.css 的 :root color。真正的界面文字都被各自的面板改过颜色，这一档只在没人管的地方露出来。 */
      foreground: "#e5e7eb",
      /** 页面底色，舞台之外露出来的那一圈。来源：legacy-client/src/styles.css 的 :root background。 */
      background: "#0d1117",
    },
    paper: {
      /** 纸张底色，纸面组件的默认面。来源：legacy-client/src/ui/paper/paper.css 的 --paper。 */
      base: "#f0ecdf",
      /** 纸面暗部，用在凹槽和次一级的底。来源：paper.css 的 --paper-shade。 */
      shade: "#e4ddc9",
      /** 常规细线和内框。来源：paper.css 的 --line。 */
      line: "#b9b19e",
      /** 外框，需要咬住视线的那种线。来源：paper.css 的 --paper-line-dark（--line-dark 只是它的别名）。 */
      lineDark: "#8a8270",
      /** 纸上的正文字色。来源：paper.css 的 --paper-ink（--ink 只是它的别名）。深色面板会就地翻成浅色，但画在纸上的东西始终读这一档。 */
      ink: "#2e2e38",
      /** 次级文字和说明文字。来源：paper.css 的 --ink-2。 */
      inkMuted: "#6b6a5f",
      /** 深色面：战场底、头像框里的星空。来源：paper.css 的 --night。 */
      night: "#323d57",
      /** 墨蓝：卡背和按钮。来源：paper.css 的 --navy。 */
      navy: "#232f4b",
    },
    theme: {
      /** 低饱和水彩感的主题色之一。来源：paper.css 的 --c-green。 */
      green: "#8a9a78",
      /** 低饱和水彩感的主题色之一。来源：paper.css 的 --c-rust。 */
      rust: "#c07a52",
      /** 低饱和水彩感的主题色之一，也是纸面组件 --accent 没被指定时的兜底。来源：paper.css 的 --c-blue。 */
      blue: "#5a72a0",
      /** 低饱和水彩感的主题色之一。来源：paper.css 的 --c-purple。 */
      purple: "#9186bd",
      /** 低饱和水彩感的主题色之一。来源：paper.css 的 --c-gold。 */
      gold: "#d9a441",
      /** 生命值那一档红。来源：paper.css 的 --c-life。 */
      life: "#b23f33",
    },
    battle: {
      /** 对局界面自己的一套纸色，比全局纸张略暖一点。来源：styles.css 的 .battle --battle-paper。 */
      paper: "#eee9dc",
      /** 对局纸色的暗部，也是纸白匾额按钮的底。来源：styles.css 的 .battle --battle-paper-shade。 */
      paperShade: "#e2dbc8",
      /** 对局界面的细线。来源：styles.css 的 .battle --battle-line。 */
      line: "#aaa391",
      /** 对局界面的外框线。来源：styles.css 的 .battle --battle-line-dark。 */
      lineDark: "#777465",
      /** 对局界面的正文字色。来源：styles.css 的 .battle --battle-ink。 */
      ink: "#30313b",
      /** 对局界面的次级文字。来源：styles.css 的 .battle --battle-ink-muted。 */
      inkMuted: "#6d6b61",
      /** 对局界面的墨蓝，纸白匾额上的字用它。来源：styles.css 的 .battle --battle-navy。 */
      navy: "#253149",
    },
    home: {
      /** 首页画面上所有米色字的颜色，从设计稿里取的。来源：styles.css 的 .home --home-ink。 */
      ink: "#e8c69f",
      /** 首页米色字被点亮的那一档（高亮标题、悬停态）。来源：styles.css 的 .home --home-ink-lit。 */
      inkLit: "#fbe6c4",
      /** 首页花饰（细线两端淡出、中间嵌一颗四角星）的颜色，和首页墨色是同一个值，只是各处带不同透明度（见 opacity.home.flourishStar / flourishLine）。来源：styles.css 的 .home__flourish-line / .home__cast-panel-rule。 */
      flourish: "#e8c69f",
    },
    accent: {
      /** AI 牌的标识色。来源：styles.css 的 .card-face--ai --accent。三种卡在对局侧栏里会同时出现，卡面底部那行标识的颜色是唯一的区分。 */
      ai: "#7fd1ff",
      /** 技能牌的标识色。来源：styles.css 的 .card-face--skill --accent。 */
      skill: "#ffc158",
      /** 英雄牌的标识色。挑紫是为了和 AI 牌的蓝、技能牌的橙都拉开距离。来源：styles.css 的 .card-face--hero --accent。 */
      hero: "#c9a6ff",
    },
    card: {
      /** 卡面边缘那圈米黄：边框、羽化带和卡面底色都是它，三者一致才没有硬接缝。来源：styles.css 的 .card-face --card-edge-tint（原值是 rgb 分量 244 235 214）。 */
      edgeTint: "#f4ebd6",
      /** 卡片加载动画的线框色。来源：styles.css 的 .card-loader --cl-color。 */
      loaderLine: "#ddcab7",
    },
    plaque: {
      navy: {
        default: {
          /** 八角匾额按钮默认变体（墨蓝）的板面。来源：styles.css 的 .plaque-button --plaque-fill。 */
          fill: "#253149",
          /** 墨蓝匾额的外框描边。来源：styles.css 的 .plaque-button --plaque-edge。 */
          edge: "#77766f",
          /** 墨蓝匾额的内框细线，实际使用带透明度（见 opacity.plaqueLine.navy.default）。来源：styles.css 的 .plaque-button --plaque-line。 */
          line: "#aea897",
        },
        hover: {
          /** 墨蓝匾额悬停时的板面。来源：styles.css 的 .plaque-button:hover。 */
          fill: "#2c3953",
          /** 墨蓝匾额悬停时外框不变，沿用默认态那一档（旧样式的 :hover 没有覆盖 --plaque-edge）。 */
          edge: "#77766f",
          /** 墨蓝匾额悬停时的内框细线，偏暖。来源：styles.css 的 .plaque-button:hover --plaque-line。 */
          line: "#cb9d7b",
        },
        disabled: {
          /** 墨蓝匾额禁用时的板面，掉饱和度。来源：styles.css 的 .plaque-button:disabled。 */
          fill: "#676965",
          /** 墨蓝匾额禁用时的外框。来源：styles.css 的 .plaque-button:disabled。 */
          edge: "#9b988d",
          /** 墨蓝匾额禁用时的内框细线。来源：styles.css 的 .plaque-button:disabled --plaque-line。 */
          line: "#e0dccf",
        },
      },
      paper: {
        default: {
          /** 纸白匾额变体的板面，对局里那几块悬浮 UI（结束出牌、触屏的打出键）用它。来源：styles.css 的 .battle__end-turn .plaque-button 与 .hand-fan .hand-fan__play。 */
          fill: "#e2dbc8",
          /** 纸白匾额的外框描边。来源同上。 */
          edge: "#777465",
          /** 纸白匾额的内框细线（暖褐），实际使用带透明度。来源：styles.css 的 --plaque-line: rgb(120 100 66 / 55%)。 */
          line: "#786442",
        },
        hover: {
          /** 纸白匾额悬停时的板面：纸面上要更亮才读得出是活的。来源：styles.css 的 .battle__end-turn .plaque-button:hover。 */
          fill: "#f2ead7",
          /** 纸白匾额悬停时外框不变，沿用默认态那一档。 */
          edge: "#777465",
          /** 纸白匾额悬停时内框色不变，只把透明度提到 78%（见 opacity.plaqueLine.paper.hover）。 */
          line: "#786442",
        },
        disabled: {
          /** 纸白匾额禁用时的板面：留在纸白系但褪到发灰。来源：styles.css 的 .battle__end-turn .plaque-button:disabled。 */
          fill: "#ded9cd",
          /** 纸白匾额禁用时的外框。来源同上。 */
          edge: "#a09c90",
          /** 纸白匾额禁用时的内框细线。来源：styles.css 的 --plaque-line: rgb(150 145 132 / 50%)。 */
          line: "#969184",
        },
      },
      terracotta: {
        default: {
          /** 陶橙匾额变体的板面，用在「催一催」这类轻量互动上——它不该比主操作更抢眼。来源：styles.css 的 .battle__urge .plaque-button。 */
          fill: "#b77f5f",
          /** 陶橙匾额的外框描边。来源同上。 */
          edge: "#6f4f3e",
          /** 陶橙匾额的内框细线。来源：styles.css 的 --plaque-line: rgb(244 213 181 / 62%)。 */
          line: "#f4d5b5",
        },
        hover: {
          /** 陶橙匾额悬停时的板面。来源：styles.css 的 .battle__urge .plaque-button:hover。 */
          fill: "#c28a68",
          /** 陶橙匾额悬停时外框不变，沿用默认态那一档。 */
          edge: "#6f4f3e",
          /** 陶橙匾额悬停时的内框细线。来源：styles.css 的 --plaque-line: rgb(255 227 194 / 82%)。 */
          line: "#ffe3c2",
        },
        disabled: {
          /** 陶橙匾额禁用时的板面。来源：styles.css 的 .battle__urge .plaque-button:disabled。 */
          fill: "#9b887c",
          /** 陶橙匾额禁用时的外框。来源同上。 */
          edge: "#756961",
          /** 陶橙匾额禁用时的内框细线。来源：styles.css 的 --plaque-line: rgb(225 214 199 / 32%)。 */
          line: "#e1d6c7",
        },
      },
      ivory: {
        default: {
          /** 米白匾额变体的板面，英雄页那颗「确认英雄」用它：那一页背景暗，主按钮得是画面上最亮的一块。来源：legacy-client/src/screens/hero.css 的 .hero__confirm / .hero__return。 */
          fill: "#e7ddc6",
          /** 米白匾额的外框描边。来源同上。 */
          edge: "#8f7c56",
          /** 米白匾额的内框细线，和纸白那档同色，只是透明度不同。来源：hero.css 的 --plaque-line: rgb(120 100 66 / 55%)。 */
          line: "#786442",
        },
        hover: {
          /** 米白匾额悬停时的板面。来源：hero.css 的 .hero__confirm:hover。 */
          fill: "#f2e9d5",
          /** 米白匾额悬停时外框不变，沿用默认态那一档。 */
          edge: "#8f7c56",
          /** 米白匾额悬停时内框色不变，只把透明度提到 75%（见 opacity.plaqueLine.ivory.hover）。 */
          line: "#786442",
        },
      },
    },
  },
  duration: {
    hand: {
      /** 手牌重排（加牌、减牌、改窗口大小）的时长。两侧手牌共用同一个值，加减牌时上下两排的节奏才是一套的。来源：legacy-client/src/ui/fanMath.ts 的 LAYOUT_DUR，HandFan 和 OpponentFan 都读它。 */
      layout: 0.4,
    },
    card: {
      /** 卡牌放大查看的进场时长。来源：legacy-client/src/ui/CardZoomOverlay.tsx 的 ZOOM_IN_DUR，CardZoomOverlay、HeroScreen、DeckScreen 三处共用。 */
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
    },
  },
  font: {
    family: {
      /** 全站唯一的字体栈。EB Garamond 管拉丁字母和数字，Noto Serif SC 管中文，两者都从 Google Fonts 拿；后面三个本地宋体是兜底，断网或字体没加载成功时至少还是衬线体，不会掉回黑体把古典调子毁掉。来源：legacy-client/src/styles.css 的 :root font-family。 */
      serif: "'EB Garamond', 'Noto Serif SC', 'Songti SC', STSong, SimSun, serif",
    },
    weight: {
      /** 允许的最轻字重。Noto Serif SC 只引了 300~700 这几档，写出这个范围浏览器会自己拉伸出很难看的伪细体。来源：styles.css 的 :root 字体栈注释。 */
      min: 300,
      /** 允许的最重字重，超出会得到伪粗体。来源同 font.weight.min。 */
      max: 700,
    },
    size: {
      /** 小字号阶梯最小的一档。来源：styles.css 的 :root --fs-xs（原式是 calc(10px * --fs-scale)，这里只收基准数，放大系数见 font.scale）。 */
      xs: 10,
      /** 小字号阶梯。来源：styles.css 的 --fs-sm。 */
      sm: 11,
      /** 小字号阶梯的半档，旧样式里确实用到了。来源：styles.css 的 --fs-sm-plus。 */
      smPlus: 11.5,
      /** 小字号阶梯。来源：styles.css 的 --fs-md。 */
      md: 12,
      /** 小字号阶梯的半档。来源：styles.css 的 --fs-md-plus。 */
      mdPlus: 12.5,
      /** 小字号阶梯的基准档。来源：styles.css 的 --fs-base。 */
      base: 13,
      /** 小字号阶梯的半档。来源：styles.css 的 --fs-base-plus。 */
      basePlus: 13.5,
      /** 小字号阶梯。来源：styles.css 的 --fs-lg。 */
      lg: 14,
      /** 小字号阶梯最大的一档。再往上是「中号字」，那一段不列阶梯、就地写 calc(设计稿的数 * 中号系数)。来源：styles.css 的 --fs-xl。 */
      xl: 15,
    },
    sizeCqi: {
      /** 按容器宽排版那几页（首页、英雄页、房间页）的正文字号阶梯，单位是 cqi（容器宽的百分之一）。来源：styles.css 的 --fs-cqi-xs。 */
      xs: 0.95,
      /** cqi 正文阶梯。来源：styles.css 的 --fs-cqi-sm。 */
      sm: 1,
      /** cqi 正文阶梯。来源：styles.css 的 --fs-cqi-md。 */
      md: 1.05,
      /** cqi 正文阶梯的半档。来源：styles.css 的 --fs-cqi-md-plus。 */
      mdPlus: 1.1,
      /** cqi 正文阶梯最大的一档。标题那些大号 cqi 不进阶梯。来源：styles.css 的 --fs-cqi-lg。 */
      lg: 1.15,
    },
    scale: {
      /** 小字号阶梯的整体放大系数，桌面档。来源：styles.css 的 :root --fs-scale。 */
      base: 1,
      /** 小字号阶梯在触屏上的放大系数。全站是 1672x941 死版式再整体等比缩放，手机横屏下缩放系数只有 0.36~0.41，桌面上刚好的 12px 落到屏幕上只剩 5 个像素。1.6 是逐页确认没撑破容器的上限。来源：styles.css 末尾 @media (pointer: coarse) 的 --fs-scale。 */
      baseTouch: 1.6,
      /** 中号字（16~25px / 1.2~2cqi）的放大系数，桌面档。这一段的字多半钉在死高度的匾额、药丸、圆牌里，所以另设一档、不跟小字走。来源：styles.css 的 :root --fs-mid-scale。 */
      mid: 1,
      /** 中号字在触屏上的放大系数。照小字那 1.6 倍放会先撑破容器、再把头上的标题比下去；1.35 让这一档字在手机上落到约 10~12px，读得出也装得下。来源：styles.css 末尾 @media (pointer: coarse) 的 --fs-mid-scale。 */
      midTouch: 1.35,
    },
  },
  opacity: {
    plaqueLine: {
      navy: {
        /** 墨蓝匾额内框细线的不透明度。旧样式把颜色和透明度写在一起（rgb(174 168 151 / 62%)），这里拆成 color.plaque.navy.default.line 加这一份，因为颜色令牌一律是不带透明度的 #rrggbb（Pixi 的 tint 和 alpha 本来也是分开的两件事）。来源：legacy-client/src/styles.css 的 .plaque-button --plaque-line。 */
        default: 0.62,
        /** 墨蓝匾额悬停时内框细线的不透明度。来源：styles.css 的 .plaque-button:hover --plaque-line。 */
        hover: 0.85,
        /** 墨蓝匾额禁用时内框细线的不透明度。来源：styles.css 的 .plaque-button:disabled --plaque-line。 */
        disabled: 0.3,
      },
      paper: {
        /** 纸白匾额内框细线的不透明度。来源：styles.css 的 .battle__end-turn .plaque-button --plaque-line。 */
        default: 0.55,
        /** 纸白匾额悬停时内框细线的不透明度（颜色不变，只是更实）。来源：styles.css 的 .battle__end-turn .plaque-button:hover。 */
        hover: 0.78,
        /** 纸白匾额禁用时内框细线的不透明度。来源：styles.css 的 .battle__end-turn .plaque-button:disabled。 */
        disabled: 0.5,
      },
      terracotta: {
        /** 陶橙匾额内框细线的不透明度。来源：styles.css 的 .battle__urge .plaque-button。 */
        default: 0.62,
        /** 陶橙匾额悬停时内框细线的不透明度。来源：styles.css 的 .battle__urge .plaque-button:hover。 */
        hover: 0.82,
        /** 陶橙匾额禁用时内框细线的不透明度。来源：styles.css 的 .battle__urge .plaque-button:disabled。 */
        disabled: 0.32,
      },
      ivory: {
        /** 米白匾额内框细线的不透明度。来源：legacy-client/src/screens/hero.css 的 .hero__confirm。 */
        default: 0.55,
        /** 米白匾额悬停时内框细线的不透明度（颜色不变，只是更实）。来源：hero.css 的 .hero__confirm:hover。 */
        hover: 0.75,
      },
    },
    home: {
      /** 首页花饰里那颗四角星的不透明度。来源：styles.css 的 .home__cast-panel-rule --home-flourish-star-color: rgb(232 198 159 / 80%)。 */
      flourishStar: 0.8,
      /** 首页花饰细线最实那一端的不透明度，线本身是往外侧淡到 0 的渐变。来源：styles.css 的 .home__flourish-line 的渐变终点 rgb(232 198 159 / 70%)。 */
      flourishLine: 0.7,
    },
  },
  radius: {
    /** 圆角阶梯。旧样式没有做过圆角令牌化，这一档是统计 legacy-client/src/styles.css 里 border-radius 的 px 取值定出来的，3px 出现 6 次。 */
    xs: 3,
    /** 圆角阶梯。同一份统计里 4px 出现 7 次。 */
    sm: 4,
    /** 圆角阶梯。同一份统计里 6px 出现 10 次，和「胶囊」那一档并列第 2。 */
    md: 6,
    /** 圆角阶梯，也是旧样式里用得最多的一档：同一份统计里 8px 出现 13 次，排第 1。 */
    lg: 8,
    /** 圆角阶梯最大的一档。同一份统计里 12px 出现 6 次。 */
    xl: 12,
    /** 胶囊形：一个大到必定被裁到半高的值，用来把矩形两端做成半圆。同一份统计里出现 10 次。 */
    pill: 999,
  },
  size: {
    card: {
      /** 卡面基准宽。全站卡牌的几何都从这个数派生，扇形手牌的间距和 hover 放大的下限也按它算。来源：legacy-client/src/styles.css 的 :root --card-w（和 ui/fanMath.ts 的 CARD_WIDTH 是同一个数）。 */
      width: 150,
      /** 卡面基准高，和宽保持 2:3。来源：styles.css 的 :root --card-h（和 fanMath.ts 的 CARD_HEIGHT 同值）。 */
      height: 225,
      /** 卡面圆角，按卡宽 150 配。不放进 radius 阶梯里：那一组是全站通用的圆角档位（按 styles.css 的取值统计出来的），而这一个是卡牌自己的几何，和 width / height 一样要按比例缩放——图集里 512 宽的原画烤的是 512 × 10 / 150 ≈ 34 的圆角。来源：legacy-client/src/ui/paper/paper.css 的 .paper-card 和 .paper-back。用它的有两处：assets/build-atlas.mjs（把圆角烤进原画和牌背的 alpha）和 canvas 的 fx/bakedTextures.ts（代码画的边框铭牌）。 */
      radius: 10,
      /** 战场上小卡的宽。来源：styles.css 的 :root --tile-w。 */
      tileWidth: 110,
      /** 战场小卡的高。必须和卡面同比例，否则打出时的飞行会把卡面拉变形。来源：styles.css 的 :root --tile-h。 */
      tileHeight: 165,
      /** 战场小卡相对卡面的缩放倍数（110 / 150）。来源：styles.css 的 :root --tile-scale。 */
      tileScale: 0.733333,
      /** 侧栏英雄牌相对卡面的缩放倍数，实际值由 JS 按面板宽度重新量（MatchStage 的 useHeroCardScale），这里是兜底。来源：styles.css 的 .battle__player-panel --hero-card-scale。 */
      heroScale: 0.5,
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
      /** 对局左侧栏宽度，触屏档。来源：styles.css 末尾 @media (pointer: coarse) 的 .battle。 */
      sidebarWidthTouch: 250,
      /** 顶栏右端那簇控件（静音 + 离开）连右边距一共占掉的宽度：26 右边距 + 两颗 51 图标 + 中间 14 间隙。回合结算层要用它让位，否则轮次和比分会被压住。来源：styles.css 的 .battle --battle-actions-w。 */
      actionsWidth: 142,
      /** 战场底部留给自己手牌的高度。来源：styles.css 的 .battle__battlefield --battle-hand-zone-h。 */
      handZoneHeight: 250,
      /** 战场顶部留给对方手牌的高度。正式对局里对方手牌是不占文档流的倒扇形，在顶栏下方露出约 72px，84 正好给它让开。来源：styles.css 的 .battle__battlefield --battle-foe-hand-h。 */
      foeHandHeight: 84,
      /** 测试房里对方手牌那一条的高度：那里是真占位置的摊开手牌条，要摆下真实卡面所以更高。来源：styles.css 的 .battle__battlefield--test。 */
      foeHandHeightTest: 122,
    },
    settle: {
      /** 回合结算层里每张结算卡的最小宽度，也是「一行最多摆几列」的推导依据（超宽就改成横向滚动）。来源：styles.css 的 .settle__cards --settle-card-min-w。 */
      cardMinWidth: 300,
    },
    control: {
      /** 静音钮的尺寸。位置由每个页面在自己的版式里安排，抽成变量是因为它在好几页里出现、各页摆放时要按这个尺寸留位。来源：styles.css 的 :root --mute-size。 */
      muteSize: 38,
    },
  },
  space: {
    /** 间距阶梯。旧样式没有做过间距令牌化，这一档是统计 legacy-client/src/styles.css 里 padding / gap / margin 的 px 取值定出来的，6px 出现 13 次，排第 6。 */
    xs: 6,
    /** 间距阶梯。同一份统计里 8px 出现 18 次，排第 3。 */
    sm: 8,
    /** 间距阶梯。同一份统计里 10px 出现 15 次，排第 5。 */
    md: 10,
    /** 间距阶梯，也是旧样式里用得最多的一个间距：同一份统计里 12px 出现 28 次，排第 1。 */
    lg: 12,
    /** 间距阶梯。同一份统计里 14px 出现 23 次，排第 2。 */
    xl: 14,
    /** 间距阶梯最大的一档。同一份统计里 16px 出现 18 次，和 8px 并列第 3。再大的 20 / 24 / 28 / 30px 也常见于整页级内边距，但阶梯只留六档，那几个数留给版式自己写。 */
    xxl: 16,
  },
} as const

/** 全部设计令牌的类型，值精确到字面量。 */
export type Tokens = typeof tokens
