/**
 * 设置页那一排开关（静音、减少动效、全屏）。
 *
 * 从前是一颗自己画滑块、挂 `role="switch"` 的按钮；正式版简化第 3 步换成原生
 * `<input type="checkbox">`——滑块是纯装饰，装饰去掉之后自己画一个复选框就没有理由了。
 * 读屏软件因此从「开 / 关」改念「选中 / 未选中」，两句话意思相近，够用。
 *
 * 说明那行小字摆在整行下面，不进 `<label>`：进去的话它会被读成开关名字的一部分，
 * 每次念开关都要把两三句解释一起念完。
 */

export interface ToggleProps {
  label: string
  /** 开关下面那行小字。不给就只有一行。 */
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

export function Toggle({ label, hint, checked, onChange, disabled = false }: ToggleProps) {
  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        {label}
      </label>
      {hint === undefined ? null : <p>{hint}</p>}
    </div>
  )
}
