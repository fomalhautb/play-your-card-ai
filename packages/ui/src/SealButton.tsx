/**
 * 一颗带开关语义的按钮（关于页页眉上那颗静音）。
 *
 * 从前这是「按钮 J（夜色圆章图标钮）」：半透明圆底加一枚剪影，剪影由已经删掉的
 * `Icon` 画。正式版简化第 3 步剥成原生 `<button>`，圆底和剪影都没了，
 * 钮面上直接写 `label` 那几个字。
 *
 * 和 `Button` 分开留着的理由只有 `pressed` 这一条：它决定读屏软件把这颗钮读成
 * 「已按下的切换钮」还是「普通按钮」，而静音和「进全屏」这两种用法看着一样、意思不同。
 */

export interface SealButtonProps {
  /** 钮面上的字，同时也是无障碍名字。 */
  label: string
  disabled?: boolean
  /** 开关类的（静音）传它，读屏软件会读成「已按下 / 未按下」。不是开关的（全屏入口）不传。 */
  pressed?: boolean
  onClick?: () => void
}

export function SealButton({ label, disabled = false, pressed, onClick }: SealButtonProps) {
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  )
}
