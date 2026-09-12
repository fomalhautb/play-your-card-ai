/**
 * 设置页那一排开关（静音、减少动效、全屏）。
 *
 * **需求单里没有这一档**：旧版根本没有设置页，全站唯一的开关是首页角上那颗静音圆章
 *（按钮 J），而它是「一颗图标钮」不是「一行带说明的开关」。这里按纸面那套先做一档 A
 * 出来；等设计稿补上再回头把它编进需求单的「表单」一类（同 TextField 的处境）。
 *
 * ## 为什么是 `role="switch"` 的按钮，不是 `<input type="checkbox">`
 *
 * 复选框的方框是浏览器画的，要盖掉它得先 `appearance: none` 再自己画一遍，
 * 到头来和这里一样是「自己画一个」；而按钮天生就有按下语义。
 * `role="switch"` + `aria-checked` 是「开关」这件事的标准说法，读屏软件会读成
 * 「开 / 关」而不是「选中 / 未选中」——这两句话对玩家的意思不一样。
 *
 * ## 一行里三样东西
 *
 * 左边标题、标题下面一行小字说明（可选）、右边滑块。整行都可以点——
 * 手机上只有滑块那一小块能点的话太难按中（旧版那颗静音圆章 38px 已经偏小了）。
 *
 * 悬停和按下两档同时认伪类和 `data-state`，理由同 Button.tsx 的文件头：
 * 组件目录页没有模拟伪类的插件。
 */

import './toggle.css'

/** 目录页要拍的那两档瞬态。禁用走 `disabled`（真的 DOM 属性，不该由另一个口子模拟）。 */
export type ToggleState = 'hover' | 'pressed'

export interface ToggleProps {
  label: string
  /** 标题下面那行小字。不给就只有标题一行。 */
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** 强行摆成某一档瞬态，只给组件目录页用。真界面别传。 */
  state?: ToggleState
}

export function Toggle({ label, hint, checked, onChange, disabled = false, state }: ToggleProps) {
  return (
    <button
      type="button"
      className="ui-toggle"
      role="switch"
      aria-checked={checked}
      // 属性整个不出现才不会被 CSS 的 `[data-state]` 选中，所以是 undefined 不是空串。
      data-state={state}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-toggle__text">
        <span className="ui-toggle__label">{label}</span>
        {hint === undefined ? null : <span className="ui-toggle__hint">{hint}</span>}
      </span>
      {/* 滑块纯装饰：开关状态由上面那颗按钮的 aria-checked 报出去，这里不再读一遍。 */}
      <span className="ui-toggle__track" aria-hidden="true">
        <span className="ui-toggle__knob" />
      </span>
    </button>
  )
}
