/**
 * 输入框 A（纸面数字框）：填四位房间码的那一个。
 *
 * 这是画布**做不了**的那一小块。房间页整页画在 Pixi 上（见 canvas 的 scenes/room），
 * 唯独文字输入必须是真的 `<input>`——输入法候选框、选区、剪贴板、屏幕阅读器、
 * 手机上那块数字键盘，全是浏览器给 DOM 的东西，画布上重做一遍只会做出一个残废版本。
 * 所以装配层把这一个框盖在画布上面（见 client 的 RoomScreen）。
 *
 * 受控组件，过滤在 `onChange` 里做：只留数字、截到 `length` 位。
 * 不用 `type="number"`——那一档会带上加减箭头，还允许 `e`、`+`、`.` 这些字符，
 * 而房间码不是一个「数」，是一串四个数字（`0421` 前面那个 0 不能被吃掉）。
 */

import { useId } from 'react'
import './codeInput.css'

/** 默认几位。房间码是四位数字（见 protocol 的 `roomCodeSchema`）。 */
const DEFAULT_LENGTH = 4

export interface CodeInputProps {
  /** 框里现在是什么。受控组件，一律由调用方持有。 */
  value: string
  /** 已经过滤好的新值（只含数字、不超过 `length` 位）。 */
  onChange(value: string): void
  /** 框上面那行说明，同时也是无障碍的标签，必填。 */
  label: string
  /** 按回车时叫它。不给就回车什么都不做。 */
  onSubmit?: () => void
  /** 几位，默认四位。 */
  length?: number
  /** 框下面那行红字。null 或不给就不占位置。 */
  error?: string | null
  /** 一出现就抢焦点。弹窗里的输入框该传 true，组件目录页别传（焦点框会进基线图）。 */
  autoFocus?: boolean
}

export function CodeInput({
  value,
  onChange,
  label,
  onSubmit,
  length = DEFAULT_LENGTH,
  error = null,
  autoFocus = false,
}: CodeInputProps) {
  // 标签和输入框靠 id 关联。useId 保证同一页上出现两个也不会撞。
  const id = useId()
  return (
    <div className="ui-code-input">
      <label className="ui-code-input__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="ui-code-input__field"
        // 手机上弹数字键盘，但值仍然是字符串（见文件头为什么不用 type="number"）。
        type="text"
        inputMode="numeric"
        // 关掉自动填充：浏览器会拿它当验证码框，冒出一堆和房间码无关的建议。
        autoComplete="off"
        maxLength={length}
        value={value}
        // biome-ignore lint/a11y/noAutofocus: 弹窗里的唯一输入框，不抢焦点等于逼玩家再点一下
        autoFocus={autoFocus}
        aria-invalid={error === null ? undefined : true}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, length))}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          // 拦掉默认行为：这个框可能在 <form> 里，回车会变成提交刷新整页。
          event.preventDefault()
          onSubmit?.()
        }}
      />
      {error === null ? null : <p className="ui-code-input__error">{error}</p>}
    </div>
  )
}
