/**
 * 条 D（卡牌加载动画）（需求单「八、条和计量」）：一张线框卡立在地上左右晃。
 *
 * 从旧版 `ui/CardLoader.tsx` 搬过来，API 照旧（`size` / `speed` 两个旋钮）。
 * 颜色那个旋钮去掉了：旧版是给 `index.html` 那份首屏拷贝留的调色口子，
 * 而正式版的线框色已经收进令牌（`color.card.loaderLine`），组件里读同一个变量就够——
 * 留一个能把它改成任意颜色的 prop，只会让「设计令牌只定义一次」名存实亡（7.1 第 4 条）。
 *
 * ## 为什么全靠 CSS 动画，不走 Animator
 *
 * 两条：
 * 1. 这是 React 这半边的组件，`ui` 不许 import pixi，也就没有 `Animator` 可用；
 * 2. 它出现的时刻是「画布还没起来」甚至「JS 还没下完」——同一套视觉将来还要在
 *    `index.html` 里当首屏 loader 用（旧版就是这么干的），那一刻只有纯 CSS 动得起来。
 *
 * 组件本身只做一件事：把两个 prop 翻译成内联 CSS 自定义属性。
 * 真正的尺寸推导和 keyframes 全在 cardLoader.css。
 */

import type { CSSProperties } from 'react'
import './cardLoader.css'

export interface CardLoaderProps {
  /**
   * 卡片高度（px）。宽度按 2:3 自动算出来，和游戏卡面 150:225 同比例。
   * 默认 72：这张卡上面有内框和菱形，再小就糊成一团了。
   */
  size?: number
  /** 一次完整弹跳的周期（秒）。不给就读令牌里的 `duration.card.loaderCycle`。 */
  speed?: number
}

export function CardLoader({ size = 72, speed }: CardLoaderProps) {
  return (
    <div
      className="ui-card-loader"
      /*
       * `role="status"` 让读屏软件知道这里是一处「状态播报」，文字全在 aria-label 上，
       * 所以里面两个 span 纯装饰、不该被读出来。
       * 整屏加载页上那行「加载中…」因此要对读屏软件藏起来，否则会被念两遍。
       */
      role="status"
      aria-label="加载中"
      style={
        {
          '--cl-size': `${size}px`,
          // 不给就整个不写这一条，让 CSS 里的默认值（读令牌）生效。
          ...(speed === undefined ? {} : { '--cl-speed': `${speed}s` }),
        } as CSSProperties
      }
    >
      <span className="ui-card-loader__card" aria-hidden="true" />
      <span className="ui-card-loader__shadow" aria-hidden="true" />
    </div>
  )
}
