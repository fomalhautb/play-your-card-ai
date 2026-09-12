/**
 * 选目标层：打出一张带目标的技能牌之后，全场压暗、顶边挂一条提示、
 * 正在施放的那张牌抬起来亮着。
 *
 * 正式版简化第 4 步之二把提示条剥成素方块（见 components/Box.ts）：夜色药丸换成一圈描边。
 * 压暗那一层留着——它不是界面件，是这一步能不能读懂的前提（候选亮、其余暗）。
 *
 * 分工：**压暗和提示条在这里，橙圈在格子上**（`BoardTile.setTargetable`）。
 * 拆开是因为两件事的生命周期不一样——拖拽那条路不铺压暗层（拖着的牌本身在扇形里，
 * 压上去会连它一起压黑），但候选格的橙圈照亮。所以调用方在拖拽路只调 `BoardGrid`，
 * 点击路才连这一层一起立起来。
 *
 * 「被选中的牌抬起半透明」那两个数（`CASTING_DIM 0.3` / `CASTING_LIFT 26`）作用在**手牌**上，
 * 而手牌归 `HandFan` 管，这一层碰不到它。所以这里把两个数导出去，由场景写到扇形上——
 * 组件是哑的，不该反过来去找别人的子节点。
 *
 * 整层**不吃**指针事件（`eventMode: 'none'`），纯粹是画上去的一层。
 *
 * 这一条容易想反：它铺满全屏又压在最上面，直觉上该由它来接「点空白处取消」那一下。
 * 但它盖住的正是这一步要玩家点的东西——候选格和候选手牌。它一吃事件，那些就全点不动了，
 * 选目标于是只剩「取消」一个出口。所以取消挂在舞台上兜底，见场景的 scenes/duel/input.ts。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import { Box, type BoxDeps } from './Box'

/**
 * 选目标态下手牌那一排怎么变：没在施放的牌压到这个透明度，正在施放的那张抬起这么多。
 * 抄黑客松版的 `ui/HandFan.tsx`（`CASTING_DIM` / `CASTING_LIFT`）。
 * 导出给场景用——它们作用在扇形上，不在这一层，理由见文件头。
 */
export const CASTING_DIM = 0.3
export const CASTING_LIFT = 26

/**
 * 提示条那一格多大、离视口顶边多远。组件私有，理由见 design 的 README。
 * 宽按最长的一句「选择一个目标（黑白颠倒）」留，位置抄旧样式的 `top: 16px`。
 */
const HINT = { width: 360, height: 36, top: 16 } as const
/** 压暗淡入淡出多久（秒），进出同一个数。旧版这一层是 CSS 直接切的，这里给一小段过渡。 */
const FADE = tokens.duration.targeting.in

export type TargetingLayerDeps = BoxDeps & {
  animator: Animator
}

export class TargetingLayer extends Container {
  private readonly deps: TargetingLayerDeps
  private readonly dim = new Graphics()
  private readonly hintSlot = new Container()
  private boxWidth = 0

  constructor(deps: TargetingLayerDeps) {
    super()
    this.deps = deps
    this.label = 'targeting-layer'
    // 不接事件，指针一路穿过去打到底下的候选格 / 候选手牌上（理由见文件头）。
    this.eventMode = 'none'
    this.addChild(this.dim, this.hintSlot)
    this.visible = false
    this.alpha = 0
  }

  /** 压暗要铺满整个视口，所以尺寸由调用方给。 */
  resize(width: number, height: number): void {
    this.boxWidth = width
    this.dim
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: tokens.color.overlay.targeting, alpha: tokens.opacity.overlay.targeting })
    this.layoutHint()
  }

  /**
   * 立起来。
   *
   * @param cardName 正在施放的那张牌叫什么，进提示条的括注里。
   * @param hint 提示条上那句话。默认是「选择一个目标」。
   *
   * 候选格的橙圈**不在这里**开：调用方拿到候选 id 之后自己调 `BoardGrid.highlightTargets`。
   * 两件事分开，拖拽那条路才能只要橙圈不要压暗（见文件头）。
   */
  begin(cardName: string, hint = '选择一个目标'): void {
    for (const child of this.hintSlot.removeChildren()) child.destroy({ children: true })
    this.hintSlot.addChild(
      new Box(
        { width: HINT.width, height: HINT.height, label: `${hint}（${cardName}）` },
        this.deps,
      ),
    )
    this.layoutHint()
    this.visible = true
    this.deps.animator.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration: FADE, ease: 'power2.out', overwrite: 'auto' },
    )
  }

  /** 收起来。 */
  end(): void {
    if (!this.visible) return
    this.deps.animator.tween(this, {
      alpha: 0,
      duration: FADE,
      ease: 'power2.in',
      overwrite: 'auto',
      onComplete: () => {
        this.visible = false
      },
    })
  }

  /** 提示条吊在视口顶边正中。旧版原来摆在战场正中，实测会被两排小卡挤没。 */
  private layoutHint(): void {
    const hint = this.hintSlot.children[0]
    if (hint === undefined) return
    hint.position.set((this.boxWidth - HINT.width) / 2, HINT.top)
  }
}
