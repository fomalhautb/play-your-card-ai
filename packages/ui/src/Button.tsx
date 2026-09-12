/**
 * 按钮 A（墨蓝匾额）的 React 版（需求单「一、按钮」第一条）。
 *
 * 和 `canvas` 的 `PlaqueButton` 是**同一颗按钮的两套实现**，不是两个组件：
 * 画布上的那颗给对局用（那里连一个 DOM 节点都不该有），这一颗给纯文字界面用
 *（离开确认弹窗、设置、账号）。两边读同一批 `color.plaque.navy.*` 令牌，所以配色只有一处出处。
 *
 * ## 为什么状态要能用 prop 摆出来
 *
 * 组件目录页没有装模拟 CSS 伪类的插件（见 client/dev/storybook/README.md），
 * 光靠 `:hover` / `:active` 的话「悬停」「按下」两条条目拍出来和普通态一模一样。
 * 所以每一档状态都同时认伪类和 `data-state`，目录页把它摆成哪一档就拍到哪一档。
 *
 * ## 和旧样式的三处出入
 *
 * 1. 不挂 `#ai-duel-rough-button` 那道手绘位移滤镜：整套正式版界面都不再用 SVG 滤镜
 *    （画布那边改成把形状烤进纹理），只剩这一颗挂着的话，为它单独留一份全局 filter defs
 *    不划算。观感差别是边线少了一点抖动。
 * 2. 底纹（`--battle-grain`）没接：那是一张 base64 噪声图，属于素材，等第 31 条真界面落地时
 *    再决定放哪儿。现在只有纯色加一层高光渐变。
 * 3. 框线用一张内联 SVG 画（三道细线 + 四角折线），和旧版结构一致，但省掉了左右那两颗星芒——
 *    星芒在 224×68 上只有几个像素，没有滤镜抖动衬托时看不出来。
 */

import type { ReactNode } from 'react'
import './button.css'

/** 编号变体。现在只有 A（墨蓝匾额），B~D 按需求单在用到时再补。 */
export type ButtonVariant = 'A'

/**
 * 目录页要拍的那两档瞬态。
 *
 * 只有这两个能被 prop 摆出来：禁用走 `disabled`（它是真的 DOM 属性，不该由另一个口子模拟），
 * 「加载」这一档需求单里标的是「—」（按钮 A 没有加载态）。
 */
export type ButtonState = 'hover' | 'pressed'

export interface ButtonProps {
  children: ReactNode
  variant?: ButtonVariant
  disabled?: boolean
  /**
   * 强行摆成某一档瞬态，只给组件目录页用。真界面别传——传了之后指针再怎么动都改不回来。
   */
  state?: ButtonState
  onClick?: () => void
  /** 默认 `button`：不写的话它在 `<form>` 里会变成提交键。 */
  type?: 'button' | 'submit'
}

/**
 * 匾额的框线。三道细线（外框、内框、内框上下各一条横线）加四角折线。
 *
 * 用 SVG 而不是 border + ::before：八角外形是 `clip-path` 切出来的，
 * 边框会被一起切掉两个角。SVG 画的是同一个八边形路径，切不掉。
 * `preserveAspectRatio="none"` 让它跟着按钮拉伸——描边会因此在长短边上粗细不同，
 * 旧版就是这个样子（那边也是非等比拉伸的内联 SVG）。
 */
function PlaqueFrame() {
  return (
    <svg
      className="ui-button__frame"
      viewBox="0 0 224 68"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <title>匾额框线</title>
      <polygon
        className="ui-button__edge"
        points="12.3,1 211.7,1 223,13.2 223,54.8 211.7,67 12.3,67 1,54.8 1,13.2"
      />
      <polygon
        className="ui-button__line"
        points="16,6 208,6 218,16 218,52 208,62 16,62 6,52 6,16"
      />
      {/* 四角折线：每个角画一段横一段竖，短短两笔就够让人认出这是块匾。 */}
      <path className="ui-button__corner" d="M14 12h14M14 12v10M210 12h-14M210 12v10" />
      <path className="ui-button__corner" d="M14 56h14M14 56v-10M210 56h-14M210 56v-10" />
    </svg>
  )
}

export function Button({
  children,
  variant = 'A',
  disabled = false,
  state,
  onClick,
  type = 'button',
}: ButtonProps) {
  return (
    <button
      className="ui-button"
      data-variant={variant}
      // 属性整个不出现才不会被 CSS 的 `[data-state]` 选中，所以是 undefined 不是空串。
      data-state={state}
      type={type === 'submit' ? 'submit' : 'button'}
      disabled={disabled}
      onClick={onClick}
    >
      <PlaqueFrame />
      <span className="ui-button__caption">{children}</span>
    </button>
  )
}
