/**
 * 纸面单行输入框。
 *
 * **需求单里没有这一档**：旧版全站只有牌组改名那一处输入框，而它是就地写在
 * `DeckScreen.tsx` 里的一个裸 `<input>`（`.deck-manage__input`），盘点时没被记成变体。
 * 这里按纸面那套（纸底、细框、墨字）先做一档 A 出来；等第 31 条把真界面搬完，
 * 回头把它补进需求单的「表单」一类。
 *
 * 文字输入**只能在 React 这半边**做：画布上不做文字输入（《正式版架构》第 2 节第 3 条），
 * 输入法、选区、剪贴板这些东西自己实现一遍是没有尽头的。所以构筑页那个「改名」
 * 弹的是这个组件，不是画布上的什么东西。
 *
 * 组件是**受控**的：值和长度上限都由调用方给。截断按码点算而不是 `slice`——
 * 中文名和 emoji 都该算一个字，也免得把代理对切成半个乱码（同存档那边的 `clampName`）。
 */

import { useEffect, useRef } from 'react'
import './textField.css'

export interface TextFieldProps {
  value: string
  onChange: (value: string) => void
  /** 无障碍用的标签。界面上不显示——它一般紧跟在一句说明后面。 */
  label: string
  /** 最多几个字（按码点算）。不给就不限。 */
  maxLength?: number
  placeholder?: string
  /**
   * 挂上去就抢焦点。
   *
   * 弹窗里的输入框要它：玩家点「改名」的意图就是马上打字，
   * 再让他去点一下输入框是白让他多点一次。用 effect 抢而不是 `autoFocus` 属性，
   * 是因为后者在 React 里只在首次挂载时生效，而弹窗是开一次挂一次、关一次卸一次，
   * 中间那次重挂就抢不到了。
   */
  autoFocus?: boolean
  /** 按下回车。弹窗里等于点了确认。 */
  onSubmit?: () => void
  /** 按下 Esc。弹窗里等于点了取消。 */
  onCancel?: () => void
}

export function TextField({
  value,
  onChange,
  label,
  maxLength,
  placeholder,
  autoFocus = false,
  onSubmit,
  onCancel,
}: TextFieldProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    const input = ref.current
    if (input === null) return
    input.focus()
    // 光标停在末尾而不是选中全部：改名多半是在原名上小改，全选一打字就没了。
    input.setSelectionRange(input.value.length, input.value.length)
  }, [autoFocus])

  return (
    <input
      ref={ref}
      type="text"
      className="ui-text-field"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(clamp(event.target.value, maxLength))}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onSubmit?.()
        if (event.key === 'Escape') onCancel?.()
      }}
    />
  )
}

/** 按**码点**截断：中文名和 emoji 各算一个字，代理对也不会被切成半个乱码。 */
function clamp(value: string, maxLength: number | undefined): string {
  if (maxLength === undefined) return value
  return [...value].slice(0, maxLength).join('')
}
