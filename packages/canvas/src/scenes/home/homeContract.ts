/**
 * 首页场景对外的契约：入参、菜单、能发出的操作、句柄。
 *
 * 单独成文件的理由同 `duelContract.ts` / `roomContract.ts`——它是**跨包的约定**：
 * 装配层（`packages/client/src/screens/HomeScreen.tsx`）按这组类型调用，
 * 组件目录页的条目、端到端用例算按钮落点也都按它。
 *
 * ## 谁管什么
 *
 * 场景管**画面和文案**：菜单上印哪几个字、人物介绍卡怎么排、按钮长什么样。
 * 装配层管**去哪**：按了「开始游戏」是进教程还是进联机（看存档里的 `tutorialDone`）、
 * 按了「牌组」跳哪条路由。所以下面这些操作只说「玩家点了哪一颗」，不带任何路由信息。
 * 这条分工和房间页是一样的：canvas 里有中文文案不奇怪，那是界面的一部分；
 * 但**没有任何路由和存档**，那是装配层的事。
 *
 * ## 图片和卡牌数据都由装配层给
 *
 * 场景不管资源从哪来（架构第 2 节第 5 条），也不许 import `content`
 *（依赖方向见 7.2 第 1 条）。所以七个人物是谁、四张展示卡是哪四张，
 * 全部由装配层查好、连纹理一起传进来。
 */

import type { Platform } from '@ai-duel/platform'
import type { Texture } from 'pixi.js'
import type { CardVisual } from '../../components/CardSprite'
import type { EffectTier } from '../../fx/effectTier'

/** 菜单上那几项。「开始游戏」不在里面——它是主入口，单独一颗匾额。 */
export type HomeMenuId = 'deck' | 'hero' | 'online' | 'test' | 'account' | 'about' | 'settings'

export interface HomeMenuItem {
  id: HomeMenuId
  label: string
}

/**
 * 菜单的**唯一**定义：顺序和文案都在这里。
 *
 * 写在 canvas 而不是让装配层传，是为了让「第 n 项在屏幕上的哪儿」这件事只由
 * `pickHomeLayout(width, height, labels)` 一个函数决定——端到端用例要按坐标点这几颗钮
 *（首页整页在画布上，DOM 里没有按钮），清单要是外面传的，用例就得再抄一份。
 *
 * `dev` 为真时多一项「测试对局」。它排在「联机」之后、「账号」之前，
 * 也就是主流程那几项的末尾，不插在中间打乱顺序。
 *
 * 后三项（账号 / 关于 / 设置）是第 31 条那三个文字页的入口，排在主流程后面：
 * 玩家进首页是来打牌的，这几项是想起来才去的。
 */
export function homeMenu(dev: boolean): HomeMenuItem[] {
  return [
    { id: 'deck', label: '牌组' },
    { id: 'hero', label: '英雄' },
    { id: 'online', label: '联机' },
    ...(dev ? ([{ id: 'test', label: '测试对局' }] as HomeMenuItem[]) : []),
    { id: 'account', label: '账号' },
    { id: 'about', label: '关于' },
    { id: 'settings', label: '设置' },
  ]
}

/** 玩家在首页上能做的事。装配层收到之后自己决定怎么办。 */
export type HomeAction =
  /** 主入口。去教程还是去联机由装配层现读存档决定（旧版也是点下去那一刻才读）。 */
  { kind: 'start' } | { kind: 'menu'; item: HomeMenuId } | { kind: 'toggle-mute' }

/** 一个人物：抠图，加上 hover 时那张介绍卡上的文案。 */
export interface HomeCastMember {
  /** 只用来当键，场景不解释它的含义。 */
  id: string
  name: string
  /** 人物经历的简介。 */
  intro: string
  skillName: string
  /** 技能在对局里的效果。 */
  skillText: string
  /** 技能的使用定位。没有就不摆那一段。 */
  roleText?: string
  /**
   * 和舞台等比的整幅透明抠图。
   *
   * 人已经画在各自该在的位置上，所以这里不需要任何坐标——整张铺满舞台叠上去就是对的位置，
   * 和夜空底、桌面弧、前景道具是同一种用法。
   * 数组顺序就是**叠放顺序**（后面的盖住前面的），也是命中的优先级：
   * 两个人重叠的地方判给排在后面的那个。
   */
  art: Texture
}

/** 那幅画的其余几层。都是和舞台等比的整幅图。 */
export interface HomeTextures {
  /** 夜空底。 */
  background: Texture
  /** 桌面弧。压在人物之上，也当命中的遮挡层。 */
  table: Texture
  /** 前景道具（地球仪、望远镜）。同样既是画面也是遮挡层。 */
  props: Texture
  /** 「开始游戏」那颗匾额的底图。 */
  plaque: Texture
  /**
   * 静音钮的两枚剪影（有声 / 静音）。真图标是美术资源（需求单图标 B），还没有；
   * 不给就用场景现画的占位（见 fx/controlIcons.ts，同对局顶栏那两颗钮的做法）。
   */
  mute?: { on: Texture; off: Texture }
}

export interface HomeSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3）。 */
  resolution: number
  textures: HomeTextures
  /** 七个人物，顺序就是叠放顺序（后排在前）。 */
  cast: HomeCastMember[]
  /** 四张展示卡。取的是卡池里的真卡，查好了传进来。 */
  cards: CardVisual[]
  /** 效果档位，决定展示卡要不要跟指针倾斜和反光。不给就是中档。 */
  tier?: EffectTier
  /** 开发构建才摆「测试对局」那一项。 */
  dev?: boolean
  /** 一开始是不是静音的。 */
  muted?: boolean
  /**
   * 触感和音效。只要这两样——首页不碰网络、存储、全屏。
   * 不给就静音、不震动（目录页就是这么跑的）。
   */
  platform?: Pick<Platform, 'audio' | 'haptics'>
  /** true 时不注册任何真实时间源，只靠 step() 推进。目录页拍图那一档用它。 */
  manualClock?: boolean
  /** 指针是不是粗的。它和视口短边一起决定走哪一档版式（同对局场景）。 */
  coarsePointer?: boolean
}

export interface HomeScene {
  /** 玩家按了某颗钮。全局只有一个回调，后设的顶掉前一个。 */
  onAction(callback: (action: HomeAction) => void): void
  /** 静音钮换一枚剪影。 */
  setMuted(muted: boolean): void
  /**
   * 把指针停在第 index 个人身上（null 是谁都不停）。
   *
   * 只给目录页用：那边没有真指针，而「hover 某个人」正是这一页最要紧的一张图。
   * 真实交互走的是画布上的 pointermove 加 alpha 命中，不经过这里。
   */
  hoverCast(index: number | null): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /**
   * 没有动画在跑。
   *
   * 首页**几乎永远是 false**：主入口那颗匾额常驻上下浮动（见 PlateButton 的变体 E）。
   * 这是设计如此，不是 3.6 的漏网——「没有动画时停掉帧循环」的前提是真的没有动画。
   */
  isIdle(): boolean
  /** 视口变了，两档版式各按各的重排。 */
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的。 */
  destroy(): void
}
