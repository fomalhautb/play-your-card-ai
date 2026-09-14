/**
 * Pixi 组件库、各个画布场景，以及演出编排。
 *
 * 卡牌绝不进 DOM，带大动画的界面（对局、牌组编辑、开包、主页人物）整个在这里画。
 * 允许依赖：`design`（令牌）、`platform`（平台能力，现在还没用上）。
 * 不依赖 `ui`——画布和 React 是并列的两套组件库，互相不引用（见《正式版架构》7.2 第 1 条）。
 *
 * 现在装着的是迁移第 1 条那批：手牌扇形、拖出出牌、翻面、命中特效，
 * 以及它们共用的帧循环、补间记账、文字纹理缓存和定种子随机数；
 * 迁移第 16 条的对局演出编排层；
 * 迁移第 18 条的对局渲染器（scenes/duel）：它消费编排层的 cue，是**唯一**认得
 * 「哪条 cue 该让哪个组件演什么」的地方；
 * 迁移第 28 条的牌组编辑器（scenes/deck）：分页的卡池、20 个卡位的牌组栏、拖拽增删，
 * 那一页的分页 / 落点 / 让位 / 合法性全在 scenes/deck/logic 里，是不碰 Pixi 的纯函数；
 * 以及迁移第 17 条那批对局用的组件，分两层：
 * 基础件（匾额按钮、雕花框、分隔线、面板、徽章、气泡、文字）和拿它们拼出来的复合件
 *（顶栏、侧栏、玩家面板、Token 细条、战场、对手手牌、横幅、抛硬币、抵消层、展示层、
 * 选目标层、结算层）。复合件都是**哑的**：只提供「摆好、播一段、改状态」的方法，
 * 不认识引擎事件，也不认识 director——把哪条 cue 映射到哪个方法是场景的活。
 * 复合件拆出来的内部件（结算层的顶栏 / 一侧 / 一行、战场的一格）**不导出**：
 * 它们只对自己的父组件负责，拆文件是被 400 行那条上限逼的，不是多了四个可以单独用的组件。
 * 别的场景要用的组件按需要往 components/ 里加，不先建完整再用（迁移第 17 条）：
 * 现在多了首页和选英雄页要的那批（图片底板按钮、文字钮、星芒花饰、夜色圆章、人物说明栏）。
 * 迁移第 29、30 条的三个场景：首页 scenes/home（含人物的 alpha 命中）、
 * 选英雄页 scenes/hero、开包 scenes/pack。
 *
 * 目录：
 *   components/    Pixi 组件（卡牌、手牌扇形、匾额按钮、雕花框、分隔线、面板、徽章、气泡、文字，
 *                  对局那批复合件，以及卡面倾斜、卡面的透视投影和网格几何）
 *   director/      对局演出编排（事件批 → 演出指令，纯 TS，不碰 Pixi / GSAP / DOM）
 *   fx/            特效和预烤纹理（命中特效、卡面反光、卡牌那批纹理、界面零件那批纹理、
 *                  各零件的模具画法、效果分档）
 *   interaction/   交互（拖拽判定的纯函数、手牌的指针状态机）
 *   layout/        布局数学（扇形几何、hover 让位）
 *   runtime/       运行期底座（帧循环、补间记账、文字纹理缓存、随机数）
 *   scenes/        场景装配（对局渲染器 scenes/duel，含两档版式、cue 播放器、输入；
 *                  牌组编辑 scenes/deck；房间页 scenes/room；首页 scenes/home；
 *                  选英雄页 scenes/hero；开包 scenes/pack。
 *                  每个场景都是「两档版式 + 一份哑状态 + 一组操作回调」，不认识路由和存档）
 *   storyStage.ts  组件目录页那边的约定（本包的 *.stories.ts 和装配层的舞台按它对接）
 *
 * director/ 是唯一依赖 `@ai-duel/core` 的目录：它要读引擎的事件和视图类型。
 * 它只依赖类型和纯函数，不碰 Pixi、GSAP、DOM、platform（依赖方向由 .dependency-cruiser.cjs 卡着）。
 */

export {
  BADGE_COST,
  BADGE_HELP,
  BADGE_NAMEPLATE,
  BADGE_SOON,
  BADGE_TILE_MARK,
  BADGE_TURN,
  Badge,
  type BadgeDeps,
  type BadgeOptions,
  type BadgeTone,
  type BadgeVariant,
} from './components/Badge'
export { Banner, type BannerDeps } from './components/Banner'
export {
  BoardGrid,
  type BoardGridDeps,
  type BoardGridOptions,
  type BoardSide,
} from './components/BoardGrid'
export {
  BUBBLE_ERROR,
  BUBBLE_SHOUT,
  BUBBLE_TIP,
  Bubble,
  type BubbleDeps,
  type BubbleOptions,
  type BubbleVariant,
} from './components/Bubble'
export { CardSprite, type CardSpriteDeps, type CardVisual } from './components/CardSprite'
export { CoinToss, type CoinTossDeps } from './components/CoinToss'
export { CardTilt } from './components/cardTilt'
export { DeckSlots, type DeckSlotsDeps, type DeckSlotsOptions } from './components/DeckSlots'
export {
  DIVIDER_GEM,
  DIVIDER_MIDLINE,
  Divider,
  type DividerDeps,
  type DividerOptions,
  type DividerVariant,
} from './components/Divider'
export {
  Flourish,
  type FlourishDeps,
  type FlourishOptions,
  type FlourishSides,
} from './components/Flourish'
export { FoeHand, type FoeHandDeps, type FoeHandOptions } from './components/FoeHand'
export { applyPose, HandFan, type HandFanOptions, type LayoutMode } from './components/HandFan'
export { HintBar, type HintBarDeps, type HintBarOptions, type HintTone } from './components/HintBar'
export {
  INFO_CARD_CAST,
  INFO_CARD_HERO,
  InfoCard,
  type InfoCardDeps,
  type InfoCardOptions,
  type InfoCardVariant,
  type InfoSection,
} from './components/InfoCard'
export { Label, type LabelStyle } from './components/Label'
export { OrnateFrame, type OrnateFrameDeps } from './components/OrnateFrame'
export {
  PANEL_CARD_POOL,
  PANEL_NEXT_PLAQUE,
  PANEL_PAGE,
  PANEL_SIDEBAR,
  PANEL_SKILL_BACK,
  PANEL_TOKEN_RAIL,
  PANEL_TOPBAR,
  PANEL_TURN_PLAQUE,
  Panel,
  type PanelDeps,
  type PanelOptions,
  type PanelVariant,
} from './components/Panel'
export {
  PLAQUE_IVORY,
  PLAQUE_NAVY,
  PLAQUE_PAPER,
  PLAQUE_PLAIN,
  PLAQUE_SIZES,
  PLAQUE_TERRACOTTA,
  PlaqueButton,
  type PlaqueButtonDeps,
  type PlaqueButtonOptions,
  type PlaqueButtonState,
  type PlaqueSizeName,
  type PlaqueVariant,
} from './components/PlaqueButton'
export {
  PLATE_HOME_START,
  PLATE_PANEL,
  PlateButton,
  type PlateButtonDeps,
  type PlateButtonOptions,
  type PlateVariant,
} from './components/PlateButton'
export {
  PlayerPanel,
  type PlayerPanelDeps,
  type PlayerPanelOptions,
} from './components/PlayerPanel'
export { ProgressBar, type ProgressBarOptions } from './components/ProgressBar'
export {
  RevealOverlay,
  type RevealOverlayDeps,
  type RevealOverlayOptions,
  type RevealPoint,
} from './components/RevealOverlay'
export {
  SealButton,
  type SealButtonDeps,
  type SealButtonOptions,
} from './components/SealButton'
export { SettleLayer, type SettleLayerDeps, type SettleSide } from './components/SettleLayer'
export { SideBar, type SideBarDeps, type SideBarOptions } from './components/SideBar'
export { type SkillCancelDeps, SkillCancelLayer } from './components/SkillCancelLayer'
export {
  type SealGlyph,
  SMALL_BACK,
  SMALL_SEAL,
  SMALL_WIRE,
  SmallButton,
  type SmallButtonDeps,
  type SmallButtonOptions,
  type SmallButtonVariant,
} from './components/SmallButton'
export {
  TABS_CHIP,
  TABS_DECK_PILL,
  TABS_PAPER,
  type TabItem,
  type TabRect,
  Tabs,
  type TabsDeps,
  type TabsOptions,
  type TabsVariant,
} from './components/Tabs'
export {
  CASTING_DIM,
  CASTING_LIFT,
  TargetingLayer,
  type TargetingLayerDeps,
} from './components/TargetingLayer'
export {
  TEXT_BUTTON_BACK,
  TEXT_BUTTON_NAV,
  TextButton,
  type TextButtonDeps,
  type TextButtonOptions,
  type TextButtonVariant,
} from './components/TextButton'
export { TokenRail, type TokenRailDeps } from './components/TokenRail'
export { TopBar, type TopBarDeps, type TopBarOptions } from './components/TopBar'
export type { Cue, CueSides, CueSpec, LockReason } from './director/cues'
export {
  createDirector,
  type Director,
  type DirectorLocks,
  type HandLockReason,
  type UserAction,
} from './director/director'
export { EVENT_PLAN, type EventPlan } from './director/ignored'
export { bakeMuteIcons, type MuteIcons } from './fx/controlIcons'
export { type EffectTier, TIER_CONFIG, type TierConfig } from './fx/effectTier'
export { bakeUiTextures, type UiTextureKey, type UiTextures } from './fx/uiTextures'
export {
  DRAG_FOLLOW_DUR,
  DRAG_POSE_DUR,
  DRAG_SCALE,
  DRAG_THRESHOLD,
  type DragBeginInput,
  type DragGesture,
  type DropInput,
  type DropOutcome,
  type DropZoneRect,
  dragGestureOf,
  pointInZone,
  resolveDrop,
  TOUCH_AXIS_RATIO,
  TOUCH_DRAG_THRESHOLD,
  TOUCH_HOLD_DELAY,
  TOUCH_HOLD_TOLERANCE,
  TOUCH_SCROLL_SLOP,
} from './interaction/dragRules'
export {
  CARD_HEIGHT,
  CARD_WIDTH,
  EDGE_MARGIN,
  type FanGeometry,
  fanTransform,
  GAP_PER_CARD,
  LAYOUT_DUR,
  MAX_SPAN,
  OPPONENT_FAN,
  PLAYER_FAN,
  type SlotTransform,
  SPREAD_DEG,
  tiltHalfExtent,
} from './layout/fanMath'
export {
  type CellRect,
  cellCenter,
  cellCount,
  cellRect,
  type GridSpec,
  gridSize,
  insideGrid,
  type NearestCell,
  nearestCell,
} from './layout/gridMath'
export {
  DEAL_STAGGER,
  ENTER_SINK,
  HOVER_BOTTOM,
  HOVER_DUR,
  HOVER_SCALE,
  HOVER_TILT_DEG,
  handPoses,
  MIN_HOVER_SCALE,
  NEIGHBOR_CLEARANCE,
  neighborPushes,
  type SlotPose,
} from './layout/handLayout'
export { Animator } from './runtime/animator'
export { FrameLoop, type FrameLoopCounters, type FrameLoopOptions } from './runtime/frameLoop'
export { Rng } from './runtime/rng'
export { TextTextureCache } from './runtime/textCache'
export { createDeckScene } from './scenes/deck/DeckScene'
export { pickDeckLayout, pickDeckTier } from './scenes/deck/layout/pickLayout'
export type { DeckLayout, DeckLayoutTier } from './scenes/deck/layout/types'
export { DEFAULT_DECK_RULES } from './scenes/deck/logic/types'
export type {
  CreateDeckScene,
  DeckManageAction,
  DeckRules,
  DeckScene,
  DeckSceneCounters,
  DeckSceneOptions,
  DeckView,
  PoolCard,
  PoolKind,
} from './scenes/deckContract'
export { createDuelScene } from './scenes/duel/DuelScene'
export { pickLayout, pickTier, TOUCH_BREAKPOINT } from './scenes/duel/layout/pickLayout'
export type { DuelLayout, LayoutTier } from './scenes/duel/layout/types'
export type {
  CardTextures,
  CreateDuelScene,
  DuelCommand,
  DuelScene,
  DuelSceneCounters,
  DuelSceneOptions,
} from './scenes/duelContract'
export { createHeroScene } from './scenes/hero/HeroScene'
export type {
  HeroAction,
  HeroEntry,
  HeroScene,
  HeroSceneOptions,
  HeroView,
} from './scenes/hero/heroContract'
export type { HeroLayout, HeroRect } from './scenes/hero/heroLayout'
export { pickHeroLayout } from './scenes/hero/heroLayout'
export {
  type AlphaMask,
  alphaBBox,
  CAST_ALPHA_THRESHOLD,
  CAST_MASK_WIDTH,
  hitTestMasks,
  type NormalizedBox,
} from './scenes/home/castHit'
export { createHomeScene } from './scenes/home/HomeScene'
export {
  type HomeAction,
  type HomeCastMember,
  type HomeMenuId,
  type HomeMenuItem,
  type HomeScene,
  type HomeSceneOptions,
  type HomeTextures,
  homeMenu,
} from './scenes/home/homeContract'
export {
  HOME_STAGE,
  type HomeCardSpot,
  type HomeLayout,
  type HomeRect,
  pickHomeLayout,
} from './scenes/home/homeLayout'
export { createPackScene } from './scenes/pack/PackScene'
export type {
  PackAction,
  PackPhase,
  PackScene,
  PackSceneOptions,
  PackView,
} from './scenes/pack/packContract'
export { createRoomScene } from './scenes/room/RoomScene'
export type {
  RoomAction,
  RoomPhase,
  RoomReady,
  RoomScene,
  RoomSceneOptions,
  RoomView,
} from './scenes/room/roomContract'
export type { StoryStage, StoryTeardown } from './storyStage'
