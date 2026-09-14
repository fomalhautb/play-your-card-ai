/**
 * 首页画面上那些**文字类**的东西：标题、副标题、主入口匾额、菜单。
 *
 * 和画那几层分开，是因为两者变化的理由不同：那几层整幅贴在画上、按画的矩形铺满，
 * 这边跟着**版式**走——两档版式在这里是真的分岔，
 * 桌面档菜单横排、手机档竖排（见 homeLayout.ts）。
 *
 * 换版式一律整层重建：这一页一辈子只在窗口尺寸变化时重建几次，不在动画期间，
 * 3.10 管的是稳态每帧。重建走 `killAndDestroy`（先掐补间再拆）——
 * 主入口那颗匾额挂着一条永不结束的浮动补间，不掐就会在已经销毁的对象上继续写属性。
 */

import { tokens } from '@ai-duel/design'
import { Container, Sprite, type Texture } from 'pixi.js'
import { Flourish } from '../../components/Flourish'
import { Label } from '../../components/Label'
import { PLATE_HOME_START, PlateButton, type PlateButtonDeps } from '../../components/PlateButton'
import { TEXT_BUTTON_NAV, TextButton, type TextButtonDeps } from '../../components/TextButton'
import { killAndDestroy } from '../../runtime/dispose'
import type { HomeAction, HomeMenuItem } from './homeContract'
import type { HomeLayout } from './homeLayout'

export type HomeUiDeps = PlateButtonDeps & TextButtonDeps

/** 这一层要用到的纹理：主入口那张匾额的底图。 */
export interface HomeUiArt {
  plaque: Texture
}

/** 标题那句话。感叹号用半角，理由抄旧版：全角标点独占一整格，整行看上去会偏左。 */
const TITLE = '出牌吧，AI!'
const SUBTITLE = '这题你ai会吗？'

/** 副标题两侧那两支花饰各占多宽（按副标题字号的倍数），以及它们离字多远。 */
const FLOURISH_WIDTH_EM = 5.2
const FLOURISH_GAP_EM = 1.2

export class HomeUi extends Container {
  private readonly deps: HomeUiDeps
  private readonly art: HomeUiArt
  private readonly menu: readonly HomeMenuItem[]
  private onAction: ((action: HomeAction) => void) | null = null

  constructor(art: HomeUiArt, menu: readonly HomeMenuItem[], deps: HomeUiDeps) {
    super()
    this.deps = deps
    this.art = art
    this.menu = menu
    this.label = 'home-ui'
  }

  setOnAction(callback: (action: HomeAction) => void): void {
    this.onAction = callback
  }

  /** 按一档版式重建整层。 */
  place(layout: HomeLayout): void {
    for (const child of this.removeChildren()) killAndDestroy(this.deps.animator, child)
    this.addTitle(layout)
    this.addStart(layout)
    this.addMenu(layout)
  }

  private addTitle(layout: HomeLayout): void {
    const title = new Label(
      TITLE,
      {
        fontSize: layout.title.fontSize,
        weight: '600',
        letterSpacing: layout.title.fontSize * 0.2,
        maxWidth: layout.stage.width * 0.9,
      },
      this.deps,
      tokens.color.home.inkLit,
    )
    title.position.set(layout.title.x, layout.title.y)
    this.addChild(title)

    const size = layout.subtitle.fontSize
    const subtitle = new Label(
      SUBTITLE,
      { fontSize: size, letterSpacing: size * 0.16, maxWidth: layout.stage.width * 0.5 },
      this.deps,
      tokens.color.home.ink,
    )
    subtitle.position.set(layout.subtitle.x, layout.subtitle.y)
    this.addChild(subtitle)

    /*
     * 副标题两侧各挂一支花饰，星朝内。宽度按字号取比例而不是按副标题实际多宽：
     * 那句话是写死的，长度不会变，而按实际宽度算的话两支花饰会随字体的兜底档来回挪。
     */
    const wing = size * FLOURISH_WIDTH_EM
    const gap = subtitle.textWidth / 2 + size * FLOURISH_GAP_EM
    for (const side of [-1, 1] as const) {
      const flourish = new Flourish(
        { width: wing, starSize: size * 1.15, sides: side < 0 ? 'right' : 'left' },
        this.deps,
      )
      const x = side < 0 ? layout.subtitle.x - gap - wing : layout.subtitle.x + gap
      flourish.position.set(x, layout.subtitle.y - flourish.boxHeight / 2)
      this.addChild(flourish)
    }
  }

  private addStart(layout: HomeLayout): void {
    const start = new PlateButton(
      {
        variant: PLATE_HOME_START,
        plate: this.art.plaque,
        caption: '开始游戏',
        width: layout.start.width,
        fontSize: layout.start.height * 0.4,
        onActivate: () => this.onAction?.({ kind: 'start' }),
      },
      this.deps,
    )
    start.position.set(layout.start.x, layout.start.y)
    this.addChild(start)
  }

  private addMenu(layout: HomeLayout): void {
    this.menu.forEach((item, index) => {
      const rect = layout.menu[index]
      if (rect === undefined) return
      const button = new TextButton(
        {
          variant: TEXT_BUTTON_NAV,
          caption: item.label,
          fontSize: rect.height / 2.2,
          padY: rect.height / 4,
          onActivate: () => this.onAction?.({ kind: 'menu', item: item.id }),
        },
        this.deps,
      )
      // 版式给的是一块盒子，按钮自己量出来的宽多半差几个像素，居中摆进去。
      button.position.set(rect.x + (rect.width - button.boxWidth) / 2, rect.y)
      this.addChild(button)
      if (layout.menuDotSize <= 0 || index === this.menu.length - 1) return
      const next = layout.menu[index + 1]
      if (next === undefined) return
      const dot = new Sprite(this.deps.ui.sparkle)
      dot.anchor.set(0.5)
      dot.setSize(layout.menuDotSize, layout.menuDotSize)
      dot.tint = tokens.color.home.ink
      dot.alpha = tokens.opacity.home.flourishStar
      dot.position.set((rect.x + rect.width + next.x) / 2, rect.y + rect.height / 2)
      this.addChild(dot)
    })
  }
}
