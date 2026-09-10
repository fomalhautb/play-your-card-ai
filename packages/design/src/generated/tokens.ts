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
      /** 结算层里「对」的那一档深绿：标准答案框的描边、领先徽章的底、步骤条的勾、顶栏我方比分的方块都用它。来源：legacy-client/src/styles.css 的 .settle 一族。 */
      forest: "#2f6b46",
      /** 结算层里「错」的那一档砖红：判定块答错时的底色。比 theme.life（生命值那档红）更暗更闷，盖在纸上像一枚印章而不是一块警示牌。来源：styles.css 的 .settle-card__verdict。 */
      brick: "#9e3a2e",
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
      /** 压在战场和全屏过场上的暖白字：中央横幅、抵消层的技能名和说明、选目标的提示条都用它。比纸面那套墨色亮得多——它印在深色背景上，不是印在纸上。来源：styles.css 的 .battle__banner / .skill-cancel__title / .battle__targeting-text。 */
      cueInk: "#ffeec5",
    },
    home: {
      /** 首页画面上所有米色字的颜色，从设计稿里取的。来源：styles.css 的 .home --home-ink。 */
      ink: "#e8c69f",
      /** 首页米色字被点亮的那一档（高亮标题、悬停态）。来源：styles.css 的 .home --home-ink-lit。 */
      inkLit: "#fbe6c4",
      /** 首页花饰（细线两端淡出、中间嵌一颗四角星）的颜色，和首页墨色是同一个值，只是各处带不同透明度（见 opacity.home.flourishStar / flourishLine）。来源：styles.css 的 .home__flourish-line / .home__cast-panel-rule。 */
      flourish: "#e8c69f",
      /** 首页人物介绍卡的正文色。和首页墨色同一个值，实际带 opacity.home.castCopy 的透明度。来源：styles.css 的 .home__cast-panel-copy rgb(232 198 159 / 72%)。 */
      cast: "#e8c69f",
    },
    hero: {
      /** 选英雄页的主金色：技能名、卡片提示的描边。来源：legacy-client/src/screens/hero.css 的 .hero__detail-skill-name。 */
      gold: "#d2b47d",
      /** 选英雄页和匹配房的次级金：英文名、返回按钮。比 hero.gold 灰一档，用在不该抢视线的地方。来源：hero.css 的 .hero__detail-en、room.css 的 .room__back。 */
      goldDim: "#c9b48c",
      /** 英雄详情里那行名字的字色，比金色更白，是这一栏最亮的一档。来源：hero.css 的 .hero__detail-name。 */
      name: "#e9dcba",
      /** 英雄详情里技能正文的字色。来源：hero.css 的 .hero__detail-skill-text。 */
      body: "#bfae90",
      /** 还没实装的英雄卡压上去的灰。旧版用 CSS 的 grayscale 滤镜，Pixi 这边不挂 Filter（纪律 3.1），改成给卡面上一层灰色 tint——同样是"这张点不了"，但不用一次离屏渲染。 */
      soonTint: "#8a8a8a",
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
    soon: {
      /** 「敬请期待」角标的底。旧样式是 #f4ead3 到 #ddcaac 的竖向渐变，Pixi 这边取渐变起点这一档实色（一块 103×31 的小牌上，渐变肉眼看不出来）。来源：hero.css 的 .hero__card-soon。 */
      fill: "#f4ead3",
      /** 「敬请期待」角标的描边，实际带 opacity.soon.line 的透明度。来源：hero.css 的 .hero__card-soon border。 */
      line: "#3a2e20",
      /** 「敬请期待」角标上的字。来源：hero.css 的 .hero__card-soon color。 */
      ink: "#2b2119",
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
          /** 墨蓝匾额的字色。来源：styles.css 的 .plaque-button color。 */
          text: "#e7e1d4",
        },
        hover: {
          /** 墨蓝匾额悬停时的板面。来源：styles.css 的 .plaque-button:hover。 */
          fill: "#2c3953",
          /** 墨蓝匾额悬停时外框不变，沿用默认态那一档（旧样式的 :hover 没有覆盖 --plaque-edge）。 */
          edge: "#77766f",
          /** 墨蓝匾额悬停时的内框细线，偏暖。来源：styles.css 的 .plaque-button:hover --plaque-line。 */
          line: "#cb9d7b",
          /** 墨蓝匾额悬停时的字色，跟着内框一起转暖。来源：styles.css 的 .plaque-button:hover。 */
          text: "#ead0b9",
        },
        disabled: {
          /** 墨蓝匾额禁用时的板面，掉饱和度。来源：styles.css 的 .plaque-button:disabled。 */
          fill: "#676965",
          /** 墨蓝匾额禁用时的外框。来源：styles.css 的 .plaque-button:disabled。 */
          edge: "#9b988d",
          /** 墨蓝匾额禁用时的内框细线。来源：styles.css 的 .plaque-button:disabled --plaque-line。 */
          line: "#e0dccf",
          /** 墨蓝匾额禁用时的字色。来源：styles.css 的 .plaque-button:disabled。 */
          text: "#cfcabb",
        },
        /** 墨蓝匾额四角折线的线色，实际使用带透明度（见 opacity.plaqueCorner.navy）。来源：styles.css 的 .plaque-button__corner。 */
        corner: "#8f8b80",
        /** 墨蓝匾额左右两颗星芒的填色。来源：styles.css 的 .plaque-button__spark。 */
        spark: "#a59e8c",
      },
      paper: {
        default: {
          /** 纸白匾额变体的板面，对局里那几块悬浮 UI（结束出牌、触屏的打出键）用它。来源：styles.css 的 .battle__end-turn .plaque-button 与 .hand-fan .hand-fan__play。 */
          fill: "#e2dbc8",
          /** 纸白匾额的外框描边。来源同上。 */
          edge: "#777465",
          /** 纸白匾额的内框细线（暖褐），实际使用带透明度。来源：styles.css 的 --plaque-line: rgb(120 100 66 / 55%)。 */
          line: "#786442",
          /** 纸白匾额的字色，用对局那档墨蓝。来源：styles.css 的 .battle__end-turn .plaque-button color。 */
          text: "#253149",
        },
        hover: {
          /** 纸白匾额悬停时的板面：纸面上要更亮才读得出是活的。来源：styles.css 的 .battle__end-turn .plaque-button:hover。 */
          fill: "#f2ead7",
          /** 纸白匾额悬停时外框不变，沿用默认态那一档。 */
          edge: "#777465",
          /** 纸白匾额悬停时内框色不变，只把透明度提到 78%（见 opacity.plaqueLine.paper.hover）。 */
          line: "#786442",
          /** 纸白匾额悬停时字色再压深一档：纸面上「变亮」是靠底色，字要跟着更实。来源：styles.css 的 .battle__end-turn .plaque-button:hover。 */
          text: "#1b2434",
        },
        disabled: {
          /** 纸白匾额禁用时的板面：留在纸白系但褪到发灰。来源：styles.css 的 .battle__end-turn .plaque-button:disabled。 */
          fill: "#ded9cd",
          /** 纸白匾额禁用时的外框。来源同上。 */
          edge: "#a09c90",
          /** 纸白匾额禁用时的内框细线。来源：styles.css 的 --plaque-line: rgb(150 145 132 / 50%)。 */
          line: "#969184",
          /** 纸白匾额禁用时的字色。和底色的对比度从约 10:1 掉到 2.4:1，一眼看出点不动。来源：styles.css 的 .battle__end-turn .plaque-button:disabled。 */
          text: "#8b8a84",
        },
        /** 纸白匾额四角折线的线色：压在纸面上要比墨蓝那档深，否则几乎看不见。来源：styles.css 的 .battle__end-turn .plaque-button__corner。 */
        corner: "#786442",
        /** 纸白匾额星芒的填色。来源：styles.css 的 .battle__end-turn .plaque-button__spark。 */
        spark: "#a08c68",
      },
      terracotta: {
        default: {
          /** 陶橙匾额变体的板面，用在「催一催」这类轻量互动上——它不该比主操作更抢眼。来源：styles.css 的 .battle__urge .plaque-button。 */
          fill: "#b77f5f",
          /** 陶橙匾额的外框描边。来源同上。 */
          edge: "#6f4f3e",
          /** 陶橙匾额的内框细线。来源：styles.css 的 --plaque-line: rgb(244 213 181 / 62%)。 */
          line: "#f4d5b5",
          /** 陶橙匾额（催一催）的字色。来源：styles.css 的 .battle__urge .plaque-button。 */
          text: "#fff1dc",
        },
        hover: {
          /** 陶橙匾额悬停时的板面。来源：styles.css 的 .battle__urge .plaque-button:hover。 */
          fill: "#c28a68",
          /** 陶橙匾额悬停时外框不变，沿用默认态那一档。 */
          edge: "#6f4f3e",
          /** 陶橙匾额悬停时的内框细线。来源：styles.css 的 --plaque-line: rgb(255 227 194 / 82%)。 */
          line: "#ffe3c2",
          /** 陶橙匾额悬停时的字色。来源：styles.css 的 .battle__urge .plaque-button:hover。 */
          text: "#fff7e8",
        },
        disabled: {
          /** 陶橙匾额禁用时的板面。来源：styles.css 的 .battle__urge .plaque-button:disabled。 */
          fill: "#9b887c",
          /** 陶橙匾额禁用时的外框。来源同上。 */
          edge: "#756961",
          /** 陶橙匾额禁用时的内框细线。来源：styles.css 的 --plaque-line: rgb(225 214 199 / 32%)。 */
          line: "#e1d6c7",
          /** 陶橙匾额禁用时的字色。来源：styles.css 的 .battle__urge .plaque-button:disabled。 */
          text: "#d8cec2",
        },
        /** 陶橙匾额四角折线的线色。来源：styles.css 的 .battle__urge .plaque-button__corner。 */
        corner: "#ffe1bc",
        /** 陶橙匾额星芒的填色。来源：styles.css 的 .battle__urge .plaque-button__spark。 */
        spark: "#f0c696",
      },
      ivory: {
        default: {
          /** 米白匾额变体的板面，英雄页那颗「确认英雄」用它：那一页背景暗，主按钮得是画面上最亮的一块。来源：legacy-client/src/screens/hero.css 的 .hero__confirm / .hero__return。 */
          fill: "#e7ddc6",
          /** 米白匾额的外框描边。来源同上。 */
          edge: "#8f7c56",
          /** 米白匾额的内框细线，和纸白那档同色，只是透明度不同。来源：hero.css 的 --plaque-line: rgb(120 100 66 / 55%)。 */
          line: "#786442",
          /** 米白匾额的字色。来源：hero.css 的 .hero__confirm。 */
          text: "#2c3138",
        },
        hover: {
          /** 米白匾额悬停时的板面。来源：hero.css 的 .hero__confirm:hover。 */
          fill: "#f2e9d5",
          /** 米白匾额悬停时外框不变，沿用默认态那一档。 */
          edge: "#8f7c56",
          /** 米白匾额悬停时内框色不变，只把透明度提到 75%（见 opacity.plaqueLine.ivory.hover）。 */
          line: "#786442",
          /** 米白匾额悬停时的字色。来源：hero.css 的 .hero__confirm:hover。 */
          text: "#1f242a",
        },
        /** 米白匾额四角折线的线色，和纸白同一档。来源：hero.css 的 .plaque-button__corner。 */
        corner: "#786442",
        /** 米白匾额星芒的填色，和纸白同一档。来源：hero.css 的 .plaque-button__spark。 */
        spark: "#a08c68",
        disabled: {
          /** 米白匾额禁用时的板面。旧样式里米白只出现在英雄页那颗「确认英雄」上，那颗从来不禁用，所以 hero.css 里没有这一档；纸白和米白同属浅纸面那一族（内框细线、四角折线、星芒三处本来就同色），褪色方向一致，直接沿用纸白那档。哪天米白真有了自己的禁用样式再改成独立值。 */
          fill: "#ded9cd",
          /** 米白匾额禁用时的外框，沿用纸白那档，理由同上。 */
          edge: "#a09c90",
          /** 米白匾额禁用时的内框细线，沿用纸白那档，理由同上。 */
          line: "#969184",
          /** 米白匾额禁用时的字色，沿用纸白那档，理由同上。 */
          text: "#8b8a84",
        },
      },
    },
    seal: {
      /** 夜色圆章的底，实际使用带透明度（见 opacity.seal.base）。来源：styles.css 的 .card-help-mark 与 MuteButton 的 seal 档，底 rgb(20 17 12 / 78%)。 */
      base: "#141110",
      /** 夜色圆章上线条和符号的颜色。来源同上。 */
      mark: "#f3ead6",
    },
    mark: {
      /** 战场小卡角标的药丸底，实际使用带透明度（见 opacity.mark.base）。来源：styles.css 的 .battle__tile-mark，底 rgb(12 18 30 / 88%)。 */
      base: "#0c121e",
      amber: {
        /** 角标默认那档（被干扰）的描边，实际使用带透明度。来源：styles.css 的 .battle__tile-mark border-color。 */
        line: "#ffc460",
        /** 角标默认那档（被干扰）的字色。来源：styles.css 的 .battle__tile-mark color。 */
        ink: "#ffd98a",
      },
      up: {
        /** 角标「变强了」那档（已升级、已进化）的描边，实际使用带透明度。绿是整个战场上仅有的两种冷色之一，专留给升降级。来源：styles.css 的 .battle__tile-mark--up。 */
        line: "#a9dcb8",
        /** 角标「变强了」那档的字色，和描边同色。来源同上。 */
        ink: "#a9dcb8",
      },
      down: {
        /** 角标「变弱了」那档（已降级）的描边，实际使用带透明度。来源：styles.css 的 .battle__tile-mark--down。 */
        line: "#b7c3d8",
        /** 角标「变弱了」那档的字色，和描边同色。来源同上。 */
        ink: "#b7c3d8",
      },
      safe: {
        /** 角标「被保住了」那档（已净化、保送、金钟罩）的描边，实际使用带透明度。青色和干扰的琥珀是相反的两件事，摞在一起要分得开。来源：styles.css 的 .battle__tile-mark--safe。 */
        line: "#8cd6ff",
        /** 角标「被保住了」那档的字色。来源同上。 */
        ink: "#bfe6ff",
      },
    },
    bubble: {
      /** 浮起小气泡的底，实际使用带透明度（见 opacity.bubble.tipBase）。来源：styles.css 的 .hand-fan__lock-tip，底 rgb(14 21 36 / 90%)。 */
      tipBase: "#0e1524",
      /** 浮起小气泡的描边，实际使用带透明度。来源同上。 */
      tipLine: "#ffe5a4",
      /** 浮起小气泡的字色。来源同上。 */
      tipInk: "#ffeec5",
    },
    status: {
      /** 「连上了」这类正向状态的字色。来源：room.css 的 .room__status。 */
      ok: "#97b487",
      /** 纸面和夜色页上的错误红字。来源：room.css 的 .room__error。 */
      error: "#c9847a",
      /** 压在战场上的错误红字，比 status.error 亮一档才压得住底纹。来源：styles.css 的 .battle__reject。 */
      errorLit: "#ffb4a4",
    },
    midline: {
      /** 战场中线那条横杆，实际使用带透明度并两端渐隐（见 opacity.midline.rail）。来源：styles.css 的 .battle__midline::before/::after。 */
      rail: "#d6ccb2",
      /** 中线正中那枚回合徽章的底。来源：styles.css 的 .battle__midline-badge。 */
      badgeFill: "#232f48",
      /** 中线回合徽章的字色，实际使用带透明度（见 opacity.midline.badgeInk）。来源同上。 */
      badgeInk: "#e4dac0",
    },
    turnPlaque: {
      /** 「对方回合」吊匾的外框线，也是两根挂绳的颜色。来源：styles.css 的 .battle__turn-plaque-frame 与 -cords。 */
      line: "#8a92ad",
      /** 「对方回合」吊匾的字色和那三颗跳动的点。来源：styles.css 的 .battle__turn-plaque-label 与 -dots。 */
      ink: "#b8c2d9",
    },
    overlay: {
      /** 抛硬币和英雄技能抵消这两层全屏过场的遮罩底色。旧样式里带着透明度写在一起（rgb(0 0 0 / 68%)），这里按 design 的规矩拆成颜色加 opacity.overlay.veil。来源：styles.css 的 .coin-toss / .skill-cancel。 */
      veil: "#000000",
      /** 展示层（强制展示、放大查看）的遮罩底色。和 overlay.veil 同色不同透明度：那两层要把整块战场推远，这一层还得让人认出背景是战场。来源：styles.css 的 .reveal-overlay。 */
      reveal: "#000000",
      /** 选目标层的压暗。偏蓝的深色而不是纯黑：这一层压着的是战场，纯黑会把场上小卡的暖色压成灰。来源：styles.css 的 .battle__targeting。 */
      targeting: "#060b16",
      /** 纸面对话框（需求单弹窗 A）底下那层遮罩的底色。旧样式里三处对话框写的是同一个 rgb(12 16 26 / 82%)，这里按 design 的规矩拆成颜色加 opacity.overlay.dialog。和 overlay.veil 分开是因为这一层要把整个界面挡死（后面那层战场不该还看得清），而那两层是过场，背景还得认得出来。来源：styles.css 的 .leave-ask、.fs-prompt、.rotate-notice。 */
      dialog: "#0c101a",
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
        /** 米白匾额禁用时内框细线的不透明度，沿用纸白那档（见 color.plaque.ivory.disabled.fill 的说明）。 */
        disabled: 0.5,
      },
    },
    home: {
      /** 首页花饰里那颗四角星的不透明度。来源：styles.css 的 .home__cast-panel-rule --home-flourish-star-color: rgb(232 198 159 / 80%)。 */
      flourishStar: 0.8,
      /** 首页花饰细线最实那一端的不透明度，线本身是往外侧淡到 0 的渐变。来源：styles.css 的 .home__flourish-line 的渐变终点 rgb(232 198 159 / 70%)。 */
      flourishLine: 0.7,
      /** 首页人物介绍卡正文的不透明度。来源：styles.css 的 .home__cast-panel-copy rgb(232 198 159 / 72%)。 */
      castCopy: 0.72,
    },
    hero: {
      /** 英雄详情里那行英文名的不透明度。来源：legacy-client/src/screens/hero.css 的 .hero__detail-en。 */
      en: 0.65,
      /** 还没实装的英雄卡整张压暗到这一档。旧版是 grayscale 滤镜加 opacity，Pixi 这边只留 tint 加这份透明度（不挂 Filter，纪律 3.1）。来源：hero.css 的 .hero__card--soon。 */
      soonCard: 0.55,
    },
    plaqueCorner: {
      /** 墨蓝匾额四角折线的透明度。来源：styles.css 的 .plaque-button__corner stroke: rgb(143 139 128 / 50%)。 */
      navy: 0.5,
      /** 纸白匾额四角折线的透明度。来源：styles.css 的 .battle__end-turn .plaque-button__corner。 */
      paper: 0.45,
      /** 陶橙匾额四角折线的透明度。来源：styles.css 的 .battle__urge .plaque-button__corner。 */
      terracotta: 0.55,
      /** 米白匾额四角折线的透明度。来源：hero.css 的 .plaque-button__corner。 */
      ivory: 0.45,
    },
    /** 匾额左右两颗星芒的透明度。四个变体共用这一档，旧样式里没有一处覆盖它。来源：styles.css 的 .plaque-button__spark。 */
    plaqueSpark: 0.72,
    control: {
      /** 纸面无底图标钮的常态透明度。纸上贴一枚实心墨色剪影会重得像块补丁，压一档才压得住。来源：styles.css「顶栏那一行右端的控件」一节。 */
      idle: 0.72,
      /** 纸面无底图标钮悬停时回到全实。来源同上。 */
      hover: 1,
    },
    seal: {
      /** 夜色圆章底的透明度。来源：styles.css 的 rgb(20 17 12 / 78%)。 */
      base: 0.78,
    },
    soon: {
      /** 「敬请期待」角标描边的不透明度。来源：hero.css 的 .hero__card-soon border 里的 rgb(58 46 32 / 45%)。 */
      line: 0.45,
    },
    mark: {
      /** 战场小卡角标药丸底的透明度。来源：styles.css 的 .battle__tile-mark background。 */
      base: 0.88,
      /** 角标默认那档（被干扰）描边的透明度。来源：styles.css 的 .battle__tile-mark border-color。 */
      amberLine: 0.6,
      /** 角标「变强了」那档描边的透明度。来源：styles.css 的 .battle__tile-mark--up。 */
      upLine: 0.55,
      /** 角标「变弱了」那档描边的透明度。来源：styles.css 的 .battle__tile-mark--down。 */
      downLine: 0.45,
      /** 角标「被保住了」那档描边的透明度。来源：styles.css 的 .battle__tile-mark--safe。 */
      safeLine: 0.6,
    },
    bubble: {
      /** 浮起小气泡底的透明度。来源：styles.css 的 .hand-fan__lock-tip background。 */
      tipBase: 0.9,
      /** 浮起小气泡描边的透明度。来源同上。 */
      tipLine: 0.55,
    },
    midline: {
      /** 中线横杆最实的那一端的透明度（两端往中间渐隐到 0）。来源：styles.css 的 .battle__midline::before。 */
      rail: 0.35,
      /** 中线回合徽章描边的透明度。来源：styles.css 的 .battle__midline-badge border。 */
      badgeLine: 0.38,
      /** 中线回合徽章字色的透明度。来源同上。 */
      badgeInk: 0.88,
    },
    frame: {
      /** 雕花框内线贴着自己往里 1px 的那道白高光。来源：styles.css 的 .ornate-frame__edge--inner box-shadow。 */
      innerHighlight: 0.3,
      /** 纸匾上四角卷叶的透明度。来源：styles.css 的 .battle__next-plaque-scroll-leaf。 */
      scrollLeaf: 0.72,
      /** 纸匾上卷叶那道弧线的透明度。来源：styles.css 的 .battle__next-plaque-scroll-arc。 */
      scrollArc: 0.8,
    },
    turnPlaque: {
      /** 「对方回合」吊匾上那三颗点的静止透明度（跳动时在这个数上下浮动）。来源：styles.css 的 .battle__turn-plaque-dots i。 */
      dot: 0.5,
    },
    overlay: {
      /** 抛硬币和抵消层遮罩的不透明度。旧版原本还叠一层背景模糊，去掉模糊之后从 52% 补到这一档当补偿（模糊本来担着一半「把背景推远」的活）。来源：styles.css 的 .coin-toss。 */
      veil: 0.68,
      /** 展示层遮罩的不透明度。同样是去掉背景模糊之后从 50% 补上来的。来源：styles.css 的 .reveal-overlay。 */
      reveal: 0.66,
      /** 选目标层压暗的不透明度。来源：styles.css 的 .battle__targeting。 */
      targeting: 0.62,
      /** 纸面对话框遮罩的不透明度。比过场那两层重，理由见 color.overlay.dialog。来源：styles.css 的 .leave-ask。 */
      dialog: 0.82,
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
    /** 喊话气泡的圆角。旧样式里只有这一处用 14px，收进阶梯是为了气泡不必写死数值。来源：styles.css 的 .battle__urge-bubble。 */
    xxl: 14,
    /** 胶囊形：一个大到必定被裁到半高的值，用来把矩形两端做成半圆。同一份统计里出现 10 次。 */
    pill: 999,
  },
  size: {
    card: {
      /** 卡面基准宽。全站卡牌的几何都从这个数派生，扇形手牌的间距和 hover 放大的下限也按它算。来源：legacy-client/src/styles.css 的 :root --card-w（和 ui/fanMath.ts 的 CARD_WIDTH 是同一个数）。 */
      width: 150,
      /** 卡面基准高，和宽保持 2:3。来源：styles.css 的 :root --card-h（和 fanMath.ts 的 CARD_HEIGHT 同值）。 */
      height: 225,
      /** 卡面圆角，按卡宽 150 配。不放进 radius 阶梯里：那一组是全站通用的圆角档位（按 styles.css 的取值统计出来的），而这一个是卡牌自己的几何，和 width / height 一样要按比例缩放——图集里 512 宽的原画烤的是 512 × 10 / 150 ≈ 34 的圆角。来源：legacy-client/src/ui/paper/paper.css 的 .paper-card 和 .paper-back。凡是画到卡角的地方都必须用它，用它的那几处列在 canvas 的 layout/fanMath.ts 的 CARD_RADIUS 上（加一处就往那儿补一条，别在这里再抄一份）。 */
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
      /** 对局顶栏那两颗纸面无底图标钮（离开、静音）的边长。来源：styles.css「顶栏那一行右端的控件」一节，实测 43.9。 */
      iconBattle: 44,
    },
    plaque: {
      /** 匾额按钮默认档的宽。来源：styles.css 的 .plaque-button width: min(224px, 100%)。 */
      width: 224,
      /** 匾额按钮默认档的高。来源：styles.css 的 .plaque-button。 */
      height: 68,
      /** 匾额按钮默认档的左右内边距。来源：styles.css 的 .plaque-button padding: 0 30px。 */
      padX: 30,
      /** 对局右下角「结束出牌」的宽。按最长的那句「等待对方…」算出来的：五个字连字距约 120px，加两侧 14px 内边距还富余。来源：styles.css 的 .battle__end-turn .plaque-button。 */
      endTurnWidth: 184,
      /** 对局右下角「结束出牌」的高。来源同上。 */
      endTurnHeight: 60,
      /** 手牌上方那颗「打出」的宽（触屏才有）。来源：styles.css 的 .hand-fan__play。 */
      playWidth: 132,
      /** 手牌上方那颗「打出」的高。来源同上。 */
      playHeight: 46,
      /** 「催一催」的宽。来源：styles.css 的 .battle__urge .plaque-button。 */
      urgeWidth: 154,
      /** 「催一催」的高。来源同上。 */
      urgeHeight: 48,
      /** 小一档匾额（结束出牌、打出、催一催）的左右内边距。旧样式里这三处是 14~16px，取最小的那档，最长的文案也排得开。来源：styles.css 的 .battle__end-turn .plaque-button padding: 0 14px。 */
      padXSmall: 14,
      /** 象牙匾额（选英雄页的「确认英雄」「返回」）的宽。旧样式写成 cqi 跟着舞台缩放，令牌只收设计稿 1672 宽下的值。来源：hero.css 的 .hero__confirm。 */
      heroWidth: 288,
      /** 象牙匾额的高。来源同 size.plaque.heroWidth。 */
      heroHeight: 87,
    },
    dialog: {
      /** 纸面对话框（需求单弹窗 A）的宽。旧样式三处写的都是 min(420px, 100%)，那个 min 是响应式写法、留在组件的 CSS 里，令牌只收 420 这个设计值。来源：styles.css 的 .leave-ask__panel、.fs-prompt__panel、.rotate-notice__panel。 */
      width: 420,
    },
    frame: {
      /** 双线雕花框每条边的盒子厚度（线本身只有 1px）。旧版留这么厚是给手绘滤镜的位移让地方，Pixi 这边不挂滤镜，它就是外线到内线之间的间距。来源：styles.css 的 --of-band。 */
      band: 8,
      /** 雕花框四角那组装饰的边长。来源：styles.css 的 .ornate-frame__corner。 */
      corner: 38,
      /** 雕花框四角那颗菱形的边长（转 45° 之后看到的是一颗方钻）。来源：styles.css 的 .ornate-frame__corner::after。 */
      cornerGem: 6,
      /** 面板之间那条分隔线正中的菱形边长。来源：styles.css 的 .battle__player-divider-gem。 */
      gem: 7,
    },
    seal: {
      /** 卡牌右上角那枚「能翻面」问号章的直径。对局手牌、组牌页卡池卡和迷你卡三处同值。来源：ui/CardHelpMark.tsx。 */
      helpMark: 22,
      /** 夜色圆章在首页上的直径（需求单按钮 J）。首页整页按舞台缩放，这一档是设计稿 1672 宽下的值。来源：styles.css 的 .home__mute。 */
      home: 52,
      /** 夜色圆章在信息页、匹配房、选英雄页上的直径。这三页的圆章比首页那颗小一圈。来源：hero.css 的 .hero__mute。 */
      page: 34,
    },
    midline: {
      /** 战场中线那枚回合徽章的高（含 1px 描边）。来源：styles.css 的 .battle__midline-badge。 */
      badgeHeight: 20,
      /** 中线回合徽章的左右内边距。来源同上。 */
      badgePadX: 12,
      /** 中线横杆的线粗。旧版从 1px 加到 2px 是因为手绘滤镜会把边缘打散，1px 摊薄后整条发虚；Pixi 这边不挂滤镜，沿用 2px 是为了和旧版一样的分量。来源：styles.css 的 .battle__midline::before background-size。 */
      railThickness: 2,
    },
    rail: {
      /** 战场右缘 Token 细条的宽。来源：styles.css 的 .battle__token-rail。 */
      width: 44,
      /** Token 细条的高。来源同上。 */
      height: 470,
    },
    turnPlaque: {
      /** 「对方回合」吊匾的宽。来源：styles.css 的 .battle__turn-plaque。 */
      width: 252,
      /** 「对方回合」吊匾匾体的高。来源：styles.css 的 .battle__turn-plaque-body。 */
      height: 66,
      /** 「对方回合」吊匾两根挂绳的长度。来源：styles.css 的 .battle__turn-plaque-cords。 */
      cordLength: 21,
    },
    nextPlaque: {
      /** 战场右上角「下一题」纸匾的宽。来源：styles.css 的 .battle__next-plaque。 */
      width: 168,
      /** 「下一题」纸匾匾体的高（viewBox 0 0 168 118）。来源：styles.css 的 .battle__next-plaque-body。 */
      height: 118,
      /** 「下一题」纸匾两根挂绳的长度。绳子是从屏幕顶边垂下来的，太短看着像贴上去的。来源：styles.css 的 .battle__next-plaque-cords。 */
      cordLength: 26,
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
