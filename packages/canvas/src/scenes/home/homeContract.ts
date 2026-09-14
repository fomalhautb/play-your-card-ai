/**
 * 首页场景对外的契约：入参、菜单、能发出的操作、句柄。
 *
 * 单独成文件的理由同 `duelContract.ts` / `roomContract.ts`——它是**跨包的约定**：
 * 装配层（`packages/client/src/screens/HomeScreen.tsx`）按这组类型调用，
 * 组件目录页的条目、端到端用例算按钮落点也都按它。
 *
 * ## 谁管什么
 *
 * 场景管**画面和文案**：菜单上印哪几个字、按钮摆在哪。
 * 装配层管**去哪**：按了「开始游戏」进联机房、按了「牌组」跳哪条路由。
 * 所以下面这些操作只说「玩家点了哪一颗」，不带任何路由信息。
 * 这条分工和房间页是一样的：canvas 里有中文文案不奇怪，那是界面的一部分；
 * 但**没有任何路由和存档**，那是装配层的事。
 *
 * ## 卡牌数据由装配层给
 *
 * 场景不管资源从哪来（架构第 2 节第 5 条），也不许 import `content`
 *（依赖方向见 7.2 第 1 条）。所以四张展示卡是哪四张，由装配层查好、连纹理一起传进来。
 * 原先这里还有一份 `HomeTextures`（夜空底、桌面弧、前景道具、匾额底图），
 * 正式版简化第 4 步把这一页剥成素方块，那四张图连同底下的素材一起删了。
 */

import type { CardVisual } from '../../components/CardSprite'
import type { EffectTier } from '../../fx/effectTier'

/** 菜单上那几项。「开始游戏」不在里面——它是主入口，单独一块。 */
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
  /** 主入口。去哪一页由装配层决定（现在是联机房）。 */
  { kind: 'start' } | { kind: 'menu'; item: HomeMenuId }

export interface HomeSceneOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 渲染倍率，调用方负责封顶（纪律 3.3）。 */
  resolution: number
  /** 四张展示卡。取的是卡池里的真卡，查好了传进来。 */
  cards: CardVisual[]
  /** 效果档位，决定展示卡要不要跟指针倾斜和反光。不给就是中档。 */
  tier?: EffectTier
  /** 开发构建才摆「测试对局」那一项。 */
  dev?: boolean
  /** true 时不注册任何真实时间源，只靠 step() 推进。目录页拍图那一档用它。 */
  manualClock?: boolean
  /** 指针是不是粗的。它和视口短边一起决定展示卡放多大（同对局场景的分档判据）。 */
  coarsePointer?: boolean
}

export interface HomeScene {
  /** 玩家按了某颗钮。全局只有一个回调，后设的顶掉前一个。 */
  onAction(callback: (action: HomeAction) => void): void
  /** 手动推进一帧。 */
  step(deltaMs: number): void
  /**
   * 没有动画在跑；此时帧循环必须停（3.6）。
   *
   * 这一页现在**真的会空闲**：主入口从前那颗常驻上下浮动的匾额在正式版简化第 4 步
   * 换成了素方块，页面静止时只剩展示卡的 hover 还会动。
   */
  isIdle(): boolean
  /** 视口变了，整页重排。 */
  resize(width: number, height: number): void
  /** 拆场景。重复调用是安全的。 */
  destroy(): void
}
