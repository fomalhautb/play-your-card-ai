/**
 * 自绘滚动条：一条轨加一个滑块，两个素方块。
 *
 * 画布上没有系统滚动条可用，而这一页有两块滚动区（卡池、牌组卡位），
 * 不画一条的话「这一列还有多长、我在哪儿」完全没有提示。
 * 8px 宽抄黑客松 `.deck-slots::-webkit-scrollbar`。
 *
 * 只显示，不接指针：拖滑块是第三套手势（滚轮、拖内容已经各一套），
 * 而滑块只有 8px 宽、在触屏上根本捏不住。滚到哪儿一律靠滚轮和拖内容。
 *
 * 内容比窗口矮时整条藏起来（`setSpan` 收到满格就把自己收掉）：
 * 一条永远满着的滚动条只是白占一层绘制（3.9）。
 */

import { Container } from 'pixi.js'
import { Box, type BoxDeps } from '../../components/Box'
import type { Rect } from './layout/types'

export class ScrollBar extends Container {
  private readonly track: Box
  private readonly thumb: Box
  private readonly barHeight: number

  constructor(bar: Rect, deps: BoxDeps) {
    super()
    this.barHeight = bar.height
    this.track = new Box({ width: bar.width, height: bar.height }, deps)
    // 滑块只画一圈线，压在轨上。轨已经是有底的，滑块再铺一层同色的底，
    // 「滑块现在停在哪一段」就只剩上下两条横线看得出来了。
    this.thumb = new Box({ width: bar.width, height: bar.height, transparent: true }, deps)
    // 纯显示，吃了指针事件底下的卡就点不着了。
    this.eventMode = 'none'
    this.addChild(this.track, this.thumb)
    this.position.set(bar.x, bar.y)
  }

  /** 滑块画在轨的哪一段（轨自己的坐标）。满格就是「内容没超出窗口」，整条收起来。 */
  setSpan(y: number, height: number): void {
    const full = height >= this.barHeight
    this.visible = !full
    if (full) return
    this.thumb.position.set(0, y)
    this.thumb.setSize(this.thumb.boxWidth, height)
  }
}
