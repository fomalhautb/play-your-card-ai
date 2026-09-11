/**
 * 按钮 J（夜色圆章图标钮）的 React 版（需求单「一、按钮」）。
 *
 * 需求单里这一条标的是「**两边都要**：信息页归 `ui`，其余归 `canvas`」——
 * 这一份就是信息页那一边。画布上那颗在 `canvas/src/components/SealButton.ts`，
 * 两边读同一批 `color.seal.*` 令牌，所以配色只有一处出处（同 Button ↔ PlaqueButton）。
 *
 * 长相：一枚半透明的夜色圆底、一圈细外框，中间一枚米色剪影（剪影由 `Icon` 画）。
 *
 * ## 为什么状态要能用 prop 摆出来
 *
 * 组件目录页没有装模拟 CSS 伪类的插件（见 client/dev/storybook/README.md），
 * 所以每一档状态都同时认伪类和 `data-state`（同 Button.tsx 的文件头）。
 *
 * 旧版那圈手绘位移滤镜不接，理由同 Button.tsx 第 1 条。
 */

import { Icon, type IconName } from './Icon'
import './sealButton.css'

/** 目录页要拍的那两档瞬态。禁用走 `disabled`。 */
export type SealButtonState = 'hover' | 'pressed'

export interface SealButtonProps {
  icon: IconName
  /** 无障碍名字，也是鼠标悬停时的 title。图标本身对读屏软件是藏起来的。 */
  label: string
  /**
   * 直径（px）。需求单给的三档：首页 52、信息 / 匹配房 / 英雄 34、组牌加减 45。
   * 默认 34——`ui` 这一份只出现在文字页的页眉上，就是那一档。
   */
  size?: number
  disabled?: boolean
  /** 强行摆成某一档瞬态，只给组件目录页用。真界面别传。 */
  state?: SealButtonState
  /**
   * 开关类的圆章（静音）传它，读屏软件会读成「已按下 / 未按下」而不是普通按钮。
   * 不是开关的（全屏入口）不传。
   */
  pressed?: boolean
  onClick?: () => void
}

export function SealButton({
  icon,
  label,
  size = 34,
  disabled = false,
  state,
  pressed,
  onClick,
}: SealButtonProps) {
  return (
    <button
      type="button"
      className="ui-seal"
      // 属性整个不出现才不会被 CSS 的 `[data-state]` 选中，所以是 undefined 不是空串。
      data-state={state}
      // 直径是逐次实例给的，只能走内联样式；颜色和线宽仍然在 css 里读令牌。
      style={{ width: size, height: size }}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {/* 剪影占直径的一半：太满会顶到外圈上（同 canvas 那颗的 iconRatio 默认值）。 */}
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  )
}
