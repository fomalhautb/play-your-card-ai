/**
 * scripts/inventory-screenshots.mjs 的取景表：拍哪些界面、每个界面裁哪些元件。
 * 单独一个文件是因为主脚本加上这张表会超过 400 行那条上限（《正式版架构》7.2 第 3 条）。
 * 补拍一个元件就往对应那一幕的 shots 里加一行，不用动主脚本。
 */

import { enterTestMatch } from './inventory-flows.mjs'

/**
 * 一幕（scene）= 一个界面状态。shots 里每条是一个元件裁图：
 *   [名字, 选择器, 状态串, 边距, 先动一下哪里]
 * 状态串：h = 悬停，p = 按下，d = 强制加 disabled 属性再拍。边距默认 10px。
 * full 说整页图拍哪档：'d' 桌面、'm' 手机、'dm' 两档；scroll 为真时拍完整滚动高度。
 */
export const SCENES = [
  {
    name: 'home',
    path: '/',
    waitFor: '.home__stage',
    settleMs: 2600,
    full: 'dm',
    shots: [
      ['start', '.home__start', 'h', 16],
      ['nav', '.home__nav', '', 4],
      ['nav-item', '.home__nav-item', 'h', 14],
      ['title', '.home__title', '', 12],
      ['flourish', '.home__flourish', '', 8],
      ['mute-seal', '.home__mute', 'hp', 12],
      ['dev-links', '.home__dev', 'h', 8],
      ['card', '.home__card', '', 10],
    ],
  },
  {
    name: 'info',
    path: '/info',
    waitFor: '.info__stage',
    settleMs: 1400,
    full: 'dm',
    shots: [
      ['back', '.info__back', 'hp', 12],
      ['title', '.info__title', '', 12],
      ['line', '.info__line', '', 8],
      ['mute-seal', '.info__mute', 'h', 10],
    ],
  },
  {
    name: 'hero',
    path: '/hero',
    waitFor: '.hero__stage',
    settleMs: 2200,
    full: 'dm',
    shots: [
      ['back', '.hero__back', 'h', 12],
      ['flourish', '.hero__flourish', '', 8],
      ['card', '.hero__card-tilt', 'h', 18],
      ['soon-badge', '.hero__card-soon', '', 10],
      ['hint', '.hero__card-hint', '', 10],
      ['mute-seal', '.hero__mute', '', 10],
    ],
  },
  {
    name: 'hero-detail',
    path: '/hero',
    waitFor: '.hero__stage',
    settleMs: 1800,
    prepare: async (page) => {
      await page.locator('.hero__card-tilt').first().click()
      await page.waitForSelector('.hero__detail-name')
      await page.waitForTimeout(1400)
    },
    full: 'd',
    shots: [
      ['panel', '.hero__detail-info', '', 16],
      ['skill', '.hero__detail-skill', '', 10],
      ['rule', '.hero__detail-rule', '', 8],
      ['confirm-ivory', '.hero__confirm', 'hd', 16],
      ['back', '.hero__detail-back', 'h', 12],
    ],
  },
  {
    name: 'room',
    path: '/room',
    needsRelay: true,
    waitFor: '.room__code-value',
    settleMs: 1600,
    full: 'dm',
    shots: [
      ['back', '.room__back', 'h', 12],
      ['panel', '.room__panel', '', 8],
      ['code-plate', '.room__code', '', 12],
      ['copy', '.room__copy', 'hd', 12],
      ['input', '.room__field', '', 12],
      ['join', '.room__join', 'hd', 14],
      ['banner-deck', '.room__banner--deck', 'h', 10],
      ['banner-hero', '.room__banner--hero', '', 10],
      ['tutorial', '.room__tutorial', 'h', 12],
      ['status', '.room__status', '', 10],
      ['hint', '.room__hint', '', 8],
      ['flourish', '.room__flourish', '', 8],
      ['divider', '.room__divider', '', 6],
      ['foot', '.room__foot', '', 6],
      ['mute-seal', '.room__mute', '', 10],
    ],
  },
  {
    name: 'deck',
    path: '/deck',
    waitFor: '.deck-scaler',
    settleMs: 2600,
    full: 'dm',
    shots: [
      ['back', '.deck-back', 'h', 12],
      ['top', '.deck-top', '', 10],
      ['tabs', '.deck-tabs', '', 10],
      ['tab', '.deck-tab', 'h', 10],
      ['tab-new', '.deck-tabs__new', 'h', 10],
      ['kinds', '.deck-kinds', '', 10],
      ['kind', '.deck-kind', 'h', 10],
      ['factions', '.deck-factions', '', 10],
      ['faction', '.deck-faction', 'h', 10],
      ['pool-head', '.deck-pool__head', '', 6],
      ['pool-hint', '.deck-pool__hint', '', 6],
      ['pool-card', '.deck-pool-card', 'h', 16],
      ['circle-add', '.deck-circle--add', 'h', 12],
      ['circle-remove', '.deck-circle--remove', 'h', 12],
      ['help-mark', '.deck-pool-card .card-help-mark', '', 10],
      ['progress', '.deck-progress', '', 10],
      ['tally', '.deck-tally', '', 8],
      ['side-panel', '.deck-side', '', 6],
      ['ornate-frame', '.ornate-frame', '', 6],
      ['side-title', '.deck-side__title', '', 10],
      ['mini-card', '.deck-mini', '', 10],
      ['confirm-navy', '.deck-confirm', 'hd', 14],
      ['manage-btn', '.deck-manage__btn', 'h', 10],
      ['mute-plain', '.deck-mute', 'h', 10],
    ],
  },
  {
    name: 'deck-zoom',
    path: '/deck',
    waitFor: '.deck-scaler',
    settleMs: 2200,
    prepare: async (page) => {
      await page.locator('.deck-pool-card').first().click()
      await page.waitForSelector('.deck-zoom-side')
      await page.waitForTimeout(1400)
    },
    full: 'd',
    shots: [
      ['reveal-card', '.reveal-card', '', 16],
      ['actions', '.deck-zoom-side__actions', '', 12],
      ['do', '.deck-zoom-side__do', 'h', 14],
      ['back', '.deck-zoom-side__back', 'h', 12],
      ['why', '.deck-zoom-side__why', '', 10],
    ],
  },
  {
    name: 'deck-skill',
    path: '/deck',
    waitFor: '.deck-scaler',
    settleMs: 2200,
    prepare: async (page) => {
      // 「技能牌」筛选之后卡池里第一张就是技能牌，放大后翻到背面才有那块说明卡。
      await page.getByRole('tab', { name: '技能牌' }).click()
      await page.waitForTimeout(900)
      await page.locator('.deck-pool-card').first().click()
      await page.waitForSelector('.deck-zoom-side')
      await page.waitForTimeout(1200)
      await page.locator('.reveal-card').first().click()
      await page.waitForTimeout(1200)
    },
    full: 'd',
    shots: [['back-panel', '.deck-skill-back', '', 14]],
  },
  {
    name: 'battle',
    path: '/',
    waitFor: '.home__stage',
    settleMs: 1200,
    prepare: enterTestMatch,
    full: 'dm',
    shots: [
      ['topbar', '.battle-topbar', '', 4],
      ['topbar-status', '.battle-topbar__status', '', 8],
      ['leave', '.leave-match', 'h', 10],
      ['mute-plain', '.mute-toggle', 'h', 10],
      ['sidebar', '.battle__sidebar', '', 4],
      ['hero-card', '.battle__hero', '', 10],
      ['player-divider', '.battle__player-divider', '', 8],
      ['midline', '.battle__midline', '', 8],
      ['midline-badge', '.battle__midline-badge', '', 10],
      ['token-rail', '.battle__token-rail', '', 8],
      ['token-count', '.battle__token-count', '', 10],
      ['next-plaque', '.battle__next-plaque', '', 10],
      ['deck-pile', '.battle__deck-stack', '', 12],
      ['hand-fan', '.hand-fan', '', 8],
      ['hand-card', '.hand-fan__slot', 'h', 16],
      ['cost-badge', '.card-overlay__cost', '', 8],
      ['help-mark', '.hand-fan__help-mark', '', 8],
      ['foe-hand', '.battle__foe-hand', '', 8],
      ['dev-panel', '.battle-dev', '', 8],
      // 排最后：按下去这一手就交了，手牌会锁上，后面几张就拍不到常态。
      ['end-turn-paper', '.battle__end-turn', 'hpd', 14],
    ],
  },
  {
    name: 'battle-leave',
    path: '/',
    waitFor: '.home__stage',
    settleMs: 1200,
    prepare: async (page) => {
      await enterTestMatch(page)
      await page.locator('.leave-match').click()
      await page.waitForSelector('.leave-ask__panel')
      await page.waitForTimeout(800)
    },
    full: 'd',
    shots: [
      ['dialog', '.leave-ask__panel', '', 16],
      ['btn-navy', '.leave-ask__btn', 'hp', 14],
    ],
  },
  {
    name: 'settle',
    path: '/test',
    waitFor: '.settle-test__btn',
    settleMs: 600,
    prepare: async (page) => {
      await page.locator('.settle-test__btn').first().click()
      await page.waitForSelector('.settle__question-panel')
      // 结算层自己有一段读题 + 逐张揭晓的主线，等它演完才拍得到判定块和确认键。
      await page.waitForTimeout(14000)
    },
    full: 'dm',
    shots: [
      ['topbar', '.settle__topbar', '', 6],
      ['round-pill', '.settle__round-pill', '', 10],
      ['topscore', '.settle__topscore', '', 10],
      ['question-panel', '.settle__question-panel', '', 10],
      ['answer-panel', '.settle__answer-panel', '', 12],
      ['divider', '.settle__divider', '', 8],
      ['result-card', '.settle-card', '', 12],
      ['verdict', '.settle-card__verdict', '', 10],
      ['squad-tab', '.settle__squad-tab', '', 10],
      ['steps', '.settle__steps', '', 10],
      ['confirm-navy', '.settle__confirm', 'h', 14],
      ['lead-badge', '.settle__lead-badge', '', 10],
    ],
  },
  {
    name: 'result',
    path: '/result',
    waitFor: '.battle__result-panel',
    settleMs: 1400,
    full: 'dm',
    shots: [
      ['panel', '.battle__result-panel', '', 10],
      ['title', '.battle__result-title', '', 10],
      ['score', '.battle__result-score', '', 10],
      ['actions', '.battle__result-actions', '', 12],
    ],
  },
  {
    name: 'design',
    path: '/design',
    waitFor: '.design-page',
    settleMs: 1600,
    full: 'd',
    scroll: true,
    shots: [
      ['plaque-navy', '.design-btn-row .plaque-button >> nth=0', 'hp', 14],
      ['plaque-navy-disabled', '.design-btn-row .plaque-button >> nth=1', '', 14],
      ['paper-card', '.paper-card', '', 12],
      ['paper-back', '.paper-back', '', 12],
      ['paper-slot', '.paper-back--slot', '', 12],
      ['tabs', '.paper-tabs', 'h', 12],
      ['portrait', '.paper-portrait-wrap', '', 12],
      ['nameplate', '.paper-nameplate', '', 10],
      ['mana-meter', '.paper-mana-meter', '', 10],
      ['turn-badge', '.paper-turn-line', '', 10],
      ['orn-title', '.paper-orn-title', '', 10],
      ['cost-badge', '.card-overlay__cost', '', 10],
      ['swatch', '.design-swatch', '', 10],
    ],
  },
  {
    name: 'generation',
    path: '/generation',
    waitFor: '.generation__table',
    settleMs: 1400,
    full: 'dm',
    shots: [
      ['back', '.generation__back', 'h', 10],
      ['picker', '.generation__picker', '', 10],
      ['table-head', '.generation__corner', '', 6],
      ['cell', '.generation__cell', '', 6],
      ['badge', '.generation__badge', '', 10],
      ['score', '.generation__score', '', 10],
    ],
  },
  {
    name: 'loader',
    path: '/loader',
    waitFor: '.card-loader',
    settleMs: 1600,
    full: 'd',
    shots: [['card-loader', '.card-loader', '', 14]],
  },
  {
    name: 'loading-bar',
    path: '/loading-bar',
    waitFor: '.page-loader__bar',
    settleMs: 1600,
    full: 'd',
    shots: [
      ['bar', '.page-loader__bar', '', 12],
      ['text', '.page-loader__text', '', 10],
    ],
  },
  {
    name: 'tutorial-intro',
    path: '/tutorial',
    waitFor: '.tutorial-panel',
    settleMs: 1600,
    full: 'dm',
    shots: [
      ['panel', '.tutorial-panel', '', 14],
      ['cta-navy', '.tutorial-panel__cta', 'h', 14],
      ['mute-plain', '.tutorial-page__mute', '', 12],
    ],
  },
  {
    name: 'tutorial-guide',
    path: '/tutorial',
    waitFor: '.tutorial-panel',
    settleMs: 1200,
    prepare: async (page) => {
      await page.getByRole('button', { name: '开始教学' }).click()
      await page.waitForSelector('.tutorial-overlay__tip', { timeout: 60000 })
      await page.waitForTimeout(2500)
    },
    full: 'd',
    shots: [
      ['tip', '.tutorial-overlay__tip', '', 14],
      ['next', '.tutorial-overlay__next', 'h', 12],
      ['skip-navy', '.tutorial-skip', 'h', 12],
    ],
  },
  {
    // 进对局时劝一句全屏的那层浮层，只有触屏档会弹。
    name: 'fullscreen-prompt',
    path: '/dev',
    waitFor: '.dev-index',
    settleMs: 600,
    prepare: async (page) => {
      await page.getByRole('button', { name: '测试对局' }).click()
      await page.waitForSelector('.fs-prompt__panel')
      await page.waitForTimeout(1000)
    },
    touch: true,
    viewport: { width: 844, height: 390 },
    full: 'm',
    shots: [
      ['panel', '.fs-prompt__panel', '', 14],
      ['go', '.fs-prompt__go', 'h', 12],
      ['skip', '.fs-prompt__skip', 'h', 12],
    ],
  },
  {
    // 手机横屏对局。单独一幕是因为「打出」只有触屏才有：鼠标点一张手牌是直接出牌，
    // 手指点才是先选中再按按钮（见 legacy 的 HandFan.handleTap）。
    name: 'battle-touch',
    // 走 /dev 而不是首页：首页那几个开发入口在 844×390 上只有几像素高，点不中。
    path: '/dev',
    waitFor: '.dev-index',
    settleMs: 600,
    prepare: enterTestMatch,
    touch: true,
    viewport: { width: 844, height: 390 },
    full: 'm',
    shots: [
      ['hand-play', '.hand-fan__play', '', 12, { tap: '.hand-fan__slot:not([data-unaffordable])' }],
    ],
  },
  {
    name: 'rotate-notice',
    path: '/',
    waitFor: '.rotate-notice__panel',
    settleMs: 1200,
    touch: true,
    full: 'm',
    shots: [['panel', '.rotate-notice__panel', '', 14]],
  },
]
