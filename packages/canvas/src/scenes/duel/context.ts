/**
 * cue 播放器和 applyView 共用的那份场景内脏：零件、依赖、版式、几件跨组件的活。
 *
 * 拆成一个 interface 而不是把方法挂在场景类上，是为了让每条 cue 的播法能单独测：
 * 测试拿一份**假的**上下文（每个方法都是记账的假函数）跑一遍全部 cue 种类，
 * 断言每一种都真的动了组件（6.6 的对偶：director 加一条 cue，这边编译不过）。
 * 真上下文由 DuelScene 组装，见 DuelScene.ts。
 *
 * 这里的字段分两类，别混：
 * - **零件和版式**是「画面现在长什么样」，cue 播放器直接改它们；
 * - `leaving` / `pendingHand` / `doomedTiles` 三个是「视图已经变了、但演出还没演到」的中转站，
 *   由 applyView 填、由 cue 播放器取走，取不走的那些在对账时兜底处理（见 duelContract 的文件头）。
 */

import type { CardId, Catalog, HeroId, InstanceId, PlayerId, PlayerView } from '@ai-duel/core'
import type { Container } from 'pixi.js'
import type { BoardTile } from '../../components/BoardTile'
import type { CardSprite } from '../../components/CardSprite'
import type { RevealPoint } from '../../components/RevealOverlay'
import type { UserAction } from '../../director/director'
import type { DuelCommand } from '../duelContract'
import type { CardVisuals } from './cardVisuals'
import type { DuelDeps } from './deps'
import type { DuelLayout } from './layout/types'
import type { DuelParts } from './parts'

/**
 * 一张等着被认领的手牌：卡本身，加上它是哪张牌面。
 *
 * 这里**不记起飞姿态**。卡自己身上那对 x/y 就是它此刻在舞台上的位置，而它在等 cue 的
 * 这一段里是会动的（拖出去打的那张松手就开始朝落点飞，见 input.ts 的 glideAfterPlay）。
 * 另记一份的话，cue 到点时读到的是松手那一瞬的旧坐标，画面会当场往回跳一格。
 */
export interface LeavingCard {
  card: CardSprite
  /** 卡牌 id。技能牌那条 cue 只带 cardId，得靠它把人找出来（见 cuePlayers/hand.ts）。 */
  cardId: CardId
}

export interface DuelContext {
  readonly seat: PlayerId
  readonly catalog: Catalog
  readonly visuals: CardVisuals
  readonly deps: DuelDeps
  /** 场景根节点。指针状态机挂在它身上（它才是那块有 hitArea 的舞台）。 */
  readonly stage: Container
  readonly parts: DuelParts
  /** 当前版式。改视口时整份换掉，所以不是 readonly。 */
  layout: DuelLayout
  /** 最近一份视图；第一份到达之前是 null。 */
  view: PlayerView | null

  /**
   * 刚从视图里消失、还挂在场上等某条 cue 来接手的手牌。
   *
   * 出牌那一批事件和新视图是同一拍到的：视图里牌已经没了，而 `play-flip` / `skill-showcase`
   * 还得拿它从手上飞出去。所以 applyView 把它从扇形里摘出来先存这儿，
   * cue 播放器取走并负责销毁；没人取走的在对账时统一销毁（中途接手、指令被拒都会走到）。
   */
  readonly leaving: Map<InstanceId, LeavingCard>
  /** 视图里已经在手上、但还等 `deal` cue 才飞出来的牌。发牌闸门开着时它是空的。 */
  readonly pendingHand: { instanceId: InstanceId; cardId: CardId }[]
  /** 对手手上还欠几张没飞出来。和 pendingHand 同理，只是对手那排不需要知道是哪几张。 */
  pendingFoeDeal: number
  /**
   * 视图里已经不在场上、但还等 `removal-fx` 演完的格子。
   * 演完（或对账）之后才真的从战场上摘掉——当场摘的话同排剩下的卡会在特效还演着的时候
   * 就开始合拢，看着像那张卡是被挤走的而不是化掉的。
   */
  readonly doomedTiles: Set<InstanceId>
  /** 还没被任何 cue 揭开的格子（applyView 建出来时是藏着的）。 */
  readonly hiddenTiles: Set<InstanceId>
  /**
   * 手牌实例 id → 卡牌 id。
   *
   * 单独记一份是因为扇形里那张 `CardSprite` 上只有实例 id（`CardSprite.instanceId`，
   * 扇形按它认牌），而牌离开手牌之后还要知道它是哪张牌面（技能牌亮相要按牌面找人）。
   */
  readonly handCardIds: Map<InstanceId, CardId>
  /**
   * 每个格子上一次挂的是哪几枚角标，拼成一个字符串比对。
   * 没变就不重建——每次重建都要新建几个徽章对象，而 applyView 每条指令都会跑一次。
   */
  readonly markKeys: Map<InstanceId, string>
  /** 现在拿着演出锁的那些编号。非空就是手牌整个冻住。 */
  readonly locks: Set<number>
  /**
   * 展示层里那张临时卡（强制展示、我方技能亮相、放大查看共用一张位置）。
   *
   * 类型是 `Container` 不是 `CardSprite`：侧栏那张英雄牌放大时摆进来的是一张原画精灵
   *（名字都印在图里，不套铭牌和费用章，见 duelContract 的 `CardTextures.heroes`）。
   */
  showcased: Container | null
  /** 正在放大查看的那一格；关掉时要把格子重新露出来。 */
  inspectingTile: InstanceId | null

  /**
   * 建一张卡。`instanceId` 同时是扇形和战场认牌用的标识。
   *
   * @param hiddenBack 真值时背面换成对手那张**隐藏牌背**（纸白底 + 藏青纹章）。
   *   强制展示那张卡要用：它是从对手手里飞出来的，起飞那一瞬间和那排牌背必须长得一样，
   *   否则会跳变（两处用同一张纹理，见 fx/cardShapes.ts 的 drawFoeBack）。
   */
  makeCard(cardId: CardId, instanceId: string, hiddenBack?: boolean): CardSprite
  /**
   * 建一张英雄牌（就一张按卡面基准尺寸摆好的原画，不是 `CardSprite`，理由见 duelContract
   * 的 `CardTextures.heroes`）。调用方没给这位的原画就返回 null，那时英雄位空着。
   */
  makeHero(heroId: HeroId): Container | null
  /** 某个战场格子在**视口坐标**里的中心、尺寸和该有的缩放。查不到就是那一格不在场上。 */
  tilePoint(instanceId: InstanceId): (RevealPoint & { width: number; height: number }) | null
  /** 我方侧栏那张英雄牌在**视口坐标**里的中心和缩放。放大查看拿它当起飞点和落点。 */
  heroPoint(): RevealPoint
  /**
   * 场上某个单位现在是哪张牌。查的是视图，不是格子上那张 `CardSprite`——
   * 后者身上只有实例 id（扇形和战场按它认牌），压根不记自己是哪张牌面。
   */
  cardIdOf(instanceId: InstanceId): CardId | null
  /** 排一件将来要做的事，走场景自己的虚拟时钟（和 cue 同一条时间轴）。 */
  after(delayMs: number, run: () => void): void
  /** 牌库那摞牌此刻的姿态，换算到**手牌容器**的坐标系里——发牌就是从这个姿态起飞的。 */
  deckPose(): { x: number; y: number; rotation: number; scale: number }
  /** 给一张新发的手牌挂上指针监听。牌打出去之后由销毁它的人负责，监听跟着一起没。 */
  bindHandCard(card: CardSprite): void
  /** 给一个新建的战场格子挂上点击监听（点它就是放大查看，或者在选目标时选中它）。 */
  bindTile(tile: BoardTile): void
  /**
   * 叫醒帧循环。只改了画面、没建补间时要自己叫（3.6）。
   *
   * **只有从帧循环外面进来的那几条路才该调它**：`applyView`、玩家的指针操作、`play`。
   * cue 播放器和对账都跑在帧回调**里面**，它们改的东西这一帧就会被画出来；
   * 在里面叫醒等于给下一帧留了一次多余的渲染，而「没有动画时停掉帧循环」（3.6）
   * 那条计数器数的正是这种多出来的一帧。
   */
  wake(): void
  /** 往外发一次玩家操作。演出和锁归编排层管，场景只是转告。 */
  userAction(action: UserAction): void
  /** 往外发一条指令。 */
  command(command: DuelCommand): void
  /**
   * 开始给英雄的主动技能选目标（侧栏那颗「发动」钮按下时走这条）。
   * 返回 false 表示这一下没被受理——现在锁着，或者一个合法目标都没有。
   *
   * 走上下文绕一圈而不是让面板直接拿到输入层：那颗钮是 applyView 按视图挂上去的，
   * 而输入层会随着换档位整个重建（见 DuelScene 的 rebuild），
   * 面板手里存一份旧的输入层引用迟早指向一个已经销毁的东西。
   */
  beginHeroSkill(): boolean
  /**
   * 把一张打出去、却没有任何演出来接手的牌放回扇形（`play-return` cue 走这条）。
   *
   * 指令被拒时视图压根没变，那张牌既不会进 `leaving`、也等不到 `play-flip`，
   * 于是就停在拖拽层上——那一层在最顶上还吃指针事件，忘在那儿的牌会把底下的战场和手牌
   * 一起挡死。和 `beginHeroSkill` 一样绕上下文走，理由见那一条。
   */
  returnPlayedCard(instanceId: InstanceId): void
  /** 手牌和按钮现在许不许动。锁变了要重算一次。 */
  refreshLocks(): void
}
