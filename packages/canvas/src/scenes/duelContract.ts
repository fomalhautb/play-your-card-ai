/**
 * 对局场景对外的契约：入参、句柄、计数器。
 *
 * 单独成文件是因为它是**跨包的约定**——`packages/bench` 的剧本和 `packages/client` 的
 * 开发页都按这组类型调用，改这里等于改两个包的调用方。放在实现文件里的话，
 * 每次动实现都要在一堆内部细节中间翻出这几个 interface 来确认没动到约定。
 *
 * ## 场景认得的三样东西
 *
 * `PlayerView`（局面）、`Cue`（演出指令）、`DirectorLocks`（哪些输入现在不许），仅此而已。
 * **场景不认识引擎事件，也不认识 driver**：谁把事件翻译成 cue 是编排层的事（director/），
 * 谁去发指令、指令怎么上网是装配层的事（第 21、27 条的两个 driver）。
 * 这条边界是整个对局代码可测的前提——旧版把三件事糅在一个 3950 行的组件里，一条都测不动。
 *
 * ## 两条输入的分工
 *
 * - `applyView` 管**结构**：手里有哪几张牌、场上站着谁、比分和 Token 是多少、第几轮。
 * - `play` 管**时机**：那些变化各自什么时候演、演多久。
 *
 * 两者会在同一拍到达（driver 一次 execute 同时产出事件和新视图），所以场景不能一收到
 * 新视图就把画面改到位——那样牌会在抛硬币的遮罩后面凭空出现。做法是：
 * `applyView` 只记下「该长成什么样」，真正的进场和退场由 cue 触发；
 * 等**队列播空、动画也停了**的那一刻再兜底对账一次，把没被任何 cue 认领的差异补上
 *（中途接手一局、以及「明确不演」的那几种事件走的就是这条）。
 * 换句话说：**演出播完之后，画面必须和最后一份 view 一致**。
 */

import type { Catalog, Command, PlayerId, PlayerView } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import type { Texture } from 'pixi.js'
import type { Cue } from '../director/cues'
import type { DirectorLocks, UserAction } from '../director/director'
import type { EffectTier } from '../fx/effectTier'

/**
 * 卡面上那点**展示配置**：费用圆章摆在哪、盘底什么色、插画主色是什么。
 *
 * 它是内容数据，唯一出处在 `@ai-duel/content` 的 `CARD_FACES`（形状和这里逐字段对应）。
 * canvas 不许依赖 content（依赖方向见《正式版架构》7.2），所以类型在这儿另写一份，
 * 由装配层把那张表原样传进来。字段都可选：查不到配置的牌走兜底，不会画不出来。
 */
export interface CardFaceStyle {
  /** 插画主色（'#rrggbb'）。具名 AI 牌用它调费用章盘底和铭牌字色。 */
  accent?: string
  /** 费用章盘底色（'#rrggbb'）。技能牌从原画那枚章上采的色，盖上去才接得住原画的金环。 */
  costFill?: string
  /** 费用章圆心，x 按卡宽、y 按卡高的百分比。不给就用兜底位置。 */
  costBadge?: { x: number; y: number }
}

/** 纹理由调用方加载好传进来：canvas 不管资源从哪来。 */
export interface CardTextures {
  /** 卡面，键是贴图名。贴图名就是卡牌 id（见 scenes/duel/cardVisuals.ts）。 */
  faces: Record<string, Texture>
  /** AI 牌的美术卡背，也是缺原画时顶上去的那张。 */
  back: Texture
  /**
   * 技能牌的背面：星象边框那张底图，卡名和说明压在中间留白里。
   *
   * 和 `back` 分开，是因为手牌里**只有技能牌翻得过去**（问号章只长在它们身上），
   * 而两种牌翻过去看到的本来就不是同一张图。不给就退回 `back`，少一张贴图不该让牌翻不了面。
   */
  skillBack?: Texture
  /**
   * 英雄原画，键是英雄 id。不给（或缺某一位）就是侧栏那个英雄位空着。
   *
   * 和卡面分开一份是因为它们**不进图集**：英雄一局只出现一张、尺寸又比卡面大，
   * 打进图集只会白占图集页（见 client 的 preload/manifests.ts）。
   * 摆出来的也不是 `CardSprite`——原画本身就是画好的整张卡面，名字都印在图里，
   * 再给它套一层铭牌和费用圆章是错的（英雄没有费用）。
   */
  heroes?: Record<string, Texture>
}

/**
 * 场景能发出的指令。
 *
 * 是 core 的 `Command` 的一个子集：只有玩家在对局界面上能做的那四件事。
 * 不用 `protocol` 的 `PlayerCommand`（形状一样）是因为 canvas 不许依赖 protocol
 *（依赖方向见《正式版架构》7.2 第 1 条）；装配层把它原样交给 driver 即可，两边结构相同。
 * 答题结果（`SUBMIT_ANSWERS`）不在里面——那是服务端的事（5.3），客户端发得出来就是作弊。
 */
export type DuelCommand = Extract<
  Command,
  { type: 'PLAY_CARD' | 'END_PLAY' | 'USE_HERO_SKILL' | 'CONFIRM_ROUND' }
>

export interface DuelSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3：最高按 1.5，低端档可以降到 0.75）。 */
  resolution: number
  /** 档位决定特效开关、粒子数量；任何一档都不挂 Filter（3.1）。 */
  tier: EffectTier
  /** 这一端坐哪个座位。视图里的「我方 / 对方」按它分。 */
  seat: PlayerId
  textures: CardTextures
  /**
   * 卡面展示配置，键是卡牌 id（`@ai-duel/content` 的 `CARD_FACES`）。
   * 不给就整副牌走兜底：费用章摆在默认位置、盘底按卡种取色。
   */
  cardFaces?: Record<string, CardFaceStyle>
  /** 本局卡池。卡名、费用、是 AI 还是技能都从它查。 */
  catalog: Catalog
  /**
   * 触感和音效。只要这两样能力——场景不碰网络、存储、全屏。
   * 不给就静音、不震动（目录页和 bench 就是这么跑的）。
   */
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /** true 时不注册任何真实时间源，只靠 step() 推进。 */
  manualClock?: boolean
  /**
   * 指针是不是粗的（CSS 的 `pointer: coarse`）。它和视口短边一起决定走哪一档版式，
   * 判据见 scenes/duel/layout/pickLayout.ts。
   */
  coarsePointer?: boolean
  /** 所有随机（烟尘方向、大小）用它定种子，同 seed 同结果（6.9 的确定性前提）。 */
  seed?: number
  /** 顶栏那颗「离开」按下时叫谁。不给就是它点了没反应。 */
  onLeave?: () => void
  /**
   * 顶栏那一格「静音」按下时叫谁。
   *
   * 和 `onLeave` 有一处不一样：**不给就整格不建**，不是「点了没反应」。
   * 目录页和 bench 都不传它，顶栏因此和从前一模一样，那两套截图基线一张都不用重拍
   *（见 components/TopBar.ts）。装配层把它接到 client 的 `toggleMuted` 上。
   */
  onToggleMute?: () => void
  /**
   * 关掉会动的那些东西：落地震屏、卡面跟指针跑的倾斜和反光。
   *
   * 玩家在设置页点的那一档（存档里的 `reducedMotion`）由装配层透进来。
   * 系统那一档（CSS 的 `prefers-reduced-motion`）**不经过这里**——画布读不到 CSS，
   * 而 platform 现在也没有这个口子，那是一个已知的缺口（见 client 的 app/reducedMotion.ts）。
   */
  reducedMotion?: boolean
}

export interface DuelSceneCounters {
  /** 文字对象创建次数（3.5：动画期间应为 0）。 */
  textCreated: number
  /** render 调用次数。 */
  renders: number
  /** 帧循环回调次数（空闲时应为 0）。 */
  frameRequests: number
  /**
   * 帧循环真正在跑的累计毫秒数：相邻两次真实时钟帧回调之间的间隔之和，
   * 循环停下的那段空闲不算在内。开发页拿它当帧率的分母
   * （帧率 = renders 增量 ÷ activeMs 增量 × 1000），这样动画刚停下的那一瞬间
   * 显示的仍是渲染时的真实帧率，而不是被空闲摊薄后的数字。
   *
   * 手动时钟（manualClock）下恒为 0：那边一帧推多久由调用方决定，墙钟时间对它没有意义，
   * 而且它是墙钟量、每次跑都不一样，绝不能进 bench「两遍完全一致」那条断言。
   */
  activeMs: number
}

export interface DuelScene {
  /** 结构状态：手牌、战场、比分、Token、阶段。组件按它摆。 */
  applyView(view: PlayerView): void
  /** 编排层 `drain()` 的产出。按各自的 `at` 排到场景自己的虚拟时钟上，到点才播。 */
  play(cues: Cue[]): void
  /** 哪些输入现在不许。场景照它决定手牌接不接指针、按钮灰不灰。 */
  setLocks(locks: DirectorLocks): void
  /**
   * 顶栏正中那一行状态字（「正在重连…」「对方掉线…」）。传 null 恢复成比分。
   *
   * 它和 `applyView` 是两回事，所以单独一个入口：这行字说的是**连接**的事，
   * 而局面此刻并没有变——玩家该看的是「现在连不上」，不是第几轮几比几
   *（见 components/TopBar.ts 的 `setStatus`）。单机玩法永远传 null。
   */
  setStatus(text: string | null): void
  /**
   * 顶栏那一格「静音」现在该印哪几个字。
   *
   * 静音状态的真身在 `platform.audio` 上（client 的 audio/mute.ts 负责落盘），
   * 场景不自己记也不自己读——设置页、全站那颗钮都能改它，装配层订阅到变化再灌进来。
   * 没建那一格时（目录页、bench 不传 `onToggleMute`）调它什么都不会发生。
   */
  setMuted(muted: boolean): void
  /** 玩家在界面上做出的指令（拖出出牌、结束出牌、发英雄技能、确认结算）。 */
  onCommand(callback: (command: DuelCommand) => void): void
  /**
   * 玩家在界面上做的、**不产生指令**的操作（放大查看、选目标、催一催）。
   * 调用方原样喂给 `director.userAction`——演出和锁归它管。
   * 会产生指令的那几下也会先发一条对应的 UserAction，顺序是「先 UserAction 后 Command」：
   * 编排层要赶在事件回来之前把演出锁上上。
   */
  onUserAction(callback: (action: UserAction) => void): void
  /** 手动推进一帧。虚拟时钟按它累加，到点的 cue 在这里播。 */
  step(deltaMs: number): void
  /** 没有在播的动画、也没有排着队的 cue；此时帧循环必须停（3.6）。 */
  isIdle(): boolean
  counters(): DuelSceneCounters
  /** 视口变了。两档版式各按各的比例重排，不是整体缩放（需求第 3 条）。 */
  resize(width: number, height: number): void
  /**
   * 回到「一局都还没开始」的空场：手牌、战场、过场层、cue 队列、虚拟时钟全部清掉。
   *
   * 换一局（再来一局、重连换局）要用它。烤好的纹理和文字缓存**不清**——那是一份和局面无关的
   * 资产，重建一遍只会白白重传一次显存，而 bench 正是靠这一点先热身一遍再测稳态。
   */
  reset(): void
  /** 拆场景。重复调用是安全的（第二次什么都不做）。 */
  destroy(): void
}

/** 建场景的函数签名。bench 的剧本和开发页都按它调。 */
export type CreateDuelScene = (options: DuelSceneOptions) => Promise<DuelScene>
