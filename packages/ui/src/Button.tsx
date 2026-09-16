/**
 * 方块按钮：React 这半边**唯一**一种按钮。
 *
 * 长相对齐画布上的素方块（`canvas` 的 components/Box.ts）：1px 描边、浅底、直角、
 * 无阴影、没有悬停和按下的视觉态。两半边各画各的，但同一个玩家先后看到画布上的钮和
 * 文字页上的钮，看着必须是一回事，所以数值照抄 Box 的常量（见 button.css）。
 *
 * 在这之前这里是没有样式的原生 `<button>`（正式版简化第 3 步剥掉了匾额框线和编号变体），
 * 于是文字页上留着的是浏览器默认外观，和画布对不上。
 *
 * `pressed` 是从原来的 `SealButton` 并过来的：那个组件和这里的差别只有这一个 prop，
 * 剥成素方块之后连长相都一样了，没有理由再分成两个。
 */

import type { ReactNode } from 'react'
import './button.css'

export interface ButtonProps {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  /** 默认 `button`：不写的话它在 `<form>` 里会变成提交键。 */
  type?: 'button' | 'submit'
  /**
   * 开关类的（静音、档位选择）传它，读屏软件会读成「已按下 / 未按下」，钮面也跟着反色。
   * 不是开关的（一次性动作）不传——不传时这个属性整个不出现，读屏软件才会读成普通按钮。
   */
  pressed?: boolean
}

export function Button({
  children,
  disabled = false,
  onClick,
  type = 'button',
  pressed,
}: ButtonProps) {
  return (
    <button
      className="ui-button"
      type={type === 'submit' ? 'submit' : 'button'}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
