/**
 * 牌组编辑场景对外的契约：入参、句柄、回调。
 *
 * 和 `duelContract.ts` 一样是**跨包的约定**——`packages/client` 的构筑页和
 * `packages/bench` 的剧本都按这组类型调用，改这里等于改两个包的调用方。
 *
 * ## 场景认得的东西
 *
 * 一份**已经算好的卡池**（哪些卡、各属哪一家、哪些选不了）、几套牌组、当前是哪一套，
 * 外加一份 `Catalog` 用来查卡名和费用。仅此而已：
 * **它不认识 content，也不认识存档**——卡池怎么来的、阵营怎么分的是内容的事
 *（content 的 deckPool.ts），存档怎么写是客户端的事（client 的 save/deckStore.ts）。
 *
 * ## 没有保存按钮
 *
 * 加一张、删一张、换一套牌组，场景**立刻**回调 `onChange`，调用方当场落盘。
 * 旧版就是这么做的（`DeckScreen.tsx` 的 `commitDeck`），界面上因此没有「未保存」这个状态。
 * 改名、新建、删除三件事不走这条路：它们要弹一个输入框或者确认框，
 * 而那属于 React 那半边（画布上不做文字输入，见《正式版架构》第 2 节第 3 条），
 * 所以场景只发一条 `onManage` 请求，做完由调用方 `applyDecks` 把结果摆回来。
 */

import type { CardId, Catalog } from '@ai-duel/core'
import type { Platform } from '@ai-duel/platform'
import type { EffectTier } from '../fx/effectTier'
import type { DeckRules, PoolCard } from './deck/logic/types'
import type { CardFaceStyle, CardTextures } from './duelContract'

export type { DeckRules, PoolCard, PoolKind } from './deck/logic/types'

/** 一套牌组。和 client 存档里的 `SavedDeck` 形状一致，但 canvas 不许依赖它。 */
export interface DeckView {
  id: string
  name: string
  /** 卡 id，逐份存：同一张卡带三份就在数组里出现三次。顺序即选牌顺序。 */
  cards: readonly CardId[]
}

/** 要弹框才做得了的那三件事。场景只发请求，做完由调用方 `applyDecks` 摆回来。 */
export type DeckManageAction =
  | { kind: 'rename'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'create' }

export interface DeckSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3）。 */
  resolution: number
  /** 档位决定特效开关；任何一档都不挂 Filter（3.1）。 */
  tier: EffectTier
  /** 卡面。构筑页要**整个卡池**的贴图，不像对局只要当前两副牌那些。 */
  textures: CardTextures
  /** 卡面展示配置，键是卡牌 id（含义同 `DuelSceneOptions.cardFaces`）。 */
  cardFaces?: Record<string, CardFaceStyle>
  /** 查卡名和费用用。 */
  catalog: Catalog
  /** 卡池里摆哪些卡，顺序即摆放顺序。由调用方算好（见 content 的 deckPool.ts）。 */
  pool: readonly PoolCard[]
  /** 阵营药丸。canvas 只拿 id 做相等比较，不认识具体有哪几家。 */
  factions: readonly { id: string; label: string }[]
  decks: readonly DeckView[]
  currentId: string
  /** 构筑规则。不给用 canvas 自己那份默认值，理由见 logic/types.ts 的 `DeckRules`。 */
  rules?: DeckRules
  /** 触感和音效。不给就静音、不震动（目录页和 bench 就是这么跑的）。 */
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /** true 时不注册任何真实时间源，只靠 step() 推进。 */
  manualClock?: boolean
  /** 指针是不是粗的。它和视口短边一起决定走哪一档版式（判据同对局场景）。 */
  coarsePointer?: boolean
  /** 所有随机用它定种子。构筑页现在没有随机，留着是为了和对局场景一个形状。 */
  seed?: number
  /** 顶栏那颗返回钮按下时叫谁。不给就是这颗钮点了没反应。 */
  onBack?: () => void
  /** 「确认牌组」按下时把当前这副牌交出去。不给就不摆这颗钮。 */
  onConfirm?: (cards: readonly CardId[]) => void
}

export interface DeckSceneCounters {
  /** 文字对象创建次数（3.5：动画期间应为 0）。 */
  textCreated: number
  renders: number
  frameRequests: number
  /** 帧循环真正在跑的累计毫秒数，含义同对局场景的同名计数器。 */
  activeMs: number
}

export interface DeckScene {
  /**
   * 摆一份新的存档（改名、新建、删除做完之后，调用方把结果摆回来）。
   *
   * 场景自己改动牌表时**不用**调它——那条路已经在场景内部改过一次内部状态了，
   * 再摆一遍只会把卡白重排一次。
   */
  applyDecks(decks: readonly DeckView[], currentId: string): void
  /** 牌表或当前牌组变了（加牌、删牌、换一套）。调用方当场落盘。 */
  onChange(callback: (decks: readonly DeckView[], currentId: string) => void): void
  /** 玩家点开了一张卡看大图。场景自己会把它放大，这条只是让调用方知道（放个音效之类）。 */
  onInspect(callback: (cardId: CardId) => void): void
  /** 玩家要改名 / 新建 / 删除。调用方弹框、改存档，再 `applyDecks`。 */
  onManage(callback: (action: DeckManageAction) => void): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /** 没有在播的动画、也没有在跟手的拖拽；此时帧循环必须停（3.6）。 */
  isIdle(): boolean
  counters(): DeckSceneCounters
  /** 视口变了。两档版式各按各的比例重排，不是整体缩放（需求第 3 条）。 */
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的（第二次什么都不做）。 */
  destroy(): void

  /** 合成一次按下 / 移动 / 松手。交互测试和 bench 剧本按它喂坐标，入口同对局场景。 */
  pressAt(x: number, y: number): void
  moveTo(x: number, y: number): void
  releaseAt(x: number, y: number): void
  /**
   * 翻一屏卡池。bench 的「牌组编辑滚动」剧本按它翻。
   *
   * 两档不是一回事：桌面档滚一个窗口高，手机档翻一页（见 scenes/deck/commands.ts）。
   * 合成一个入口是因为调用方要的是「整屏换掉」这件事，不是「页码变了」。
   */
  turnPage(delta: number): void
  /**
   * 手机档：开关底部那个装着牌组栏的抽屉。桌面档什么都不做（那一档牌组栏一直摊着）。
   *
   * 真界面上玩家点把手就是它；透出来是给目录页那两条手机档条目和 bench 剧本用的——
   * 它们要把画面摆到「抽屉开着」那一帧，而那不是靠一次点击摆得准的。
   */
  toggleDrawer(): void
}

/** 建场景的函数签名。bench 的剧本和客户端的构筑页都按它调。 */
export type CreateDeckScene = (options: DeckSceneOptions) => Promise<DeckScene>
