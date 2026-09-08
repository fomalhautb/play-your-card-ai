/**
 * Pixi 组件库、各个画布场景，以及演出编排。
 *
 * 卡牌绝不进 DOM，带大动画的界面（对局、牌组编辑、开包、主页人物）整个在这里画。
 * 允许依赖：`design`（令牌）、`platform`（平台能力，现在还没用上）。
 * 不依赖 `ui`——画布和 React 是并列的两套组件库，互相不引用（见《正式版架构》7.2 第 1 条）。
 *
 * 现在装着的是迁移第 1 条那批：手牌扇形、拖出出牌、翻面、命中特效，
 * 以及它们共用的帧循环、补间记账、文字纹理缓存和定种子随机数。
 * 别的场景要用的组件按需要往 components/ 里加，不先建完整再用（迁移第 17 条）。
 *
 * 目录：
 *   components/    Pixi 组件（卡牌、手牌扇形、卡面倾斜、卡面的透视投影和网格几何）
 *   fx/            特效（命中特效、卡面反光、预烤纹理、效果分档）
 *   interaction/   交互（拖拽判定的纯函数、手牌的指针状态机）
 *   layout/        布局数学（扇形几何、hover 让位）
 *   runtime/       运行期底座（帧循环、补间记账、文字纹理缓存、随机数）
 *   scenes/        场景装配（对局原型、版式）
 *   storyStage.ts  组件目录页那边的约定（本包的 *.stories.ts 和装配层的舞台按它对接）
 */

export { CardSprite, type CardSpriteDeps, type CardVisual } from './components/CardSprite'
export { CardTilt } from './components/cardTilt'
export { applyPose, HandFan, type HandFanOptions, type LayoutMode } from './components/HandFan'

export { type EffectTier, TIER_CONFIG, type TierConfig } from './fx/effectTier'

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
export type {
  CardTextures,
  DuelPrototype,
  DuelPrototypeCounters,
  DuelPrototypeOptions,
} from './scenes/duelContract'
export { computeLayout, type DuelLayout } from './scenes/duelLayout'
export { createDuelPrototype } from './scenes/duelPrototype'
export type { StoryStage, StoryTeardown } from './storyStage'
