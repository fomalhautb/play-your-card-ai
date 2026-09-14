/**
 * 单行文字输入框（构筑页的牌组改名）。
 *
 * 文字输入**只能在 React 这半边**做：画布上不做文字输入（《正式版架构》第 2 节第 3 条），
 * 输入法、选区、剪贴板这些东西自己实现一遍是没有尽头的。
 *
 * 受控组件，值和长度上限都由调用方给。截断按码点算而不是 `slice`——
 * 中文名和 emoji 都该算一个字，也免得把代理对切成半个乱码（同存档那边的 `clampName`）。
 *
 * 正式版简化第 3 步剥掉了纸面配色和框线。标签从「只给读屏软件的 `aria-label`」
 * 改成包住 `<input>` 的 `<label>`：没有样式可以把它藏起来了，写在界面上反而更清楚。
 */

import { useEffect, useRef } from 'react'

export interface TextFieldProps {
  value: string
  onChange: (value: string) => void
  /** 框前面那行字，同时也是无障碍的标签。 */
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
    <label>
      {label}
      <input
        ref={ref}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(clamp(event.target.value, maxLength))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSubmit?.()
          if (event.key === 'Escape') onCancel?.()
        }}
      />
    </label>
  )
}

/** 按**码点**截断：中文名和 emoji 各算一个字，代理对也不会被切成半个乱码。 */
function clamp(value: string, maxLength: number | undefined): string {
  if (maxLength === undefined) return value
  return [...value].slice(0, maxLength).join('')
}
