/**
 * 一颗按钮。
 *
 * 正式版简化第 3 步把原来的「按钮 A（墨蓝匾额）」剥成了原生 `<button>`：
 * 匾额框线、编号变体、悬停 / 按下的摆态全去掉了，视觉后面整套重做。
 * 剩下的只有「点得动 / 点不动」这一件事。
 *
 * 没有样式文件：浏览器给 `<button>` 的默认外观就是现在要的样子。
 */

import type { ReactNode } from 'react'

export interface ButtonProps {
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
  /** 默认 `button`：不写的话它在 `<form>` 里会变成提交键。 */
  type?: 'button' | 'submit'
}

export function Button({ children, disabled = false, onClick, type = 'button' }: ButtonProps) {
  return (
    <button type={type === 'submit' ? 'submit' : 'button'} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}
