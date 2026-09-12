/**
 * 条 B（素材加载进度条）（需求单「八、条和计量」）。
 *
 * 加载页上那条「图下了几张」。归 `ui` 是因为它出现的时候画布还没起来
 *（需求单条 B 的归属那一行）。
 *
 * ## 进度只往前走，不回退
 *
 * 这条规矩在 `client` 的 `preload/preload.ts` 里就落实了（`onProgress` 只报更大的数），
 * 这里跟着写一句 `clamp01` 只是兜住「调用方传了 NaN 或者负数」——
 * 那会让宽度变成 `NaN%`，CSS 直接忽略，进度条看着像卡在原地。
 *
 * ## 百分数只取整不四舍五入
 *
 * 99.6% 四舍五入成 100% 之后画面还没换，看着像卡住了（抄旧版 `LoadingScreen` 的注释）。
 *
 * 宽度写成内联样式而不是 CSS 变量：它每帧都在变，进变量表只是绕一圈
 *（同 client 那条临时进度条）。
 */

import './progressBar.css'

export interface ProgressBarProps {
  /** 0~1。超出范围会被夹回来。 */
  value: number
  /** 无障碍用的标签，界面上不显示。 */
  label?: string
  /** 条子右边显示百分数。加载页要，别处多半不要。 */
  showPercent?: boolean
}

export function ProgressBar({ value, label = '加载进度', showPercent = false }: ProgressBarProps) {
  const percent = Math.floor(clamp01(value) * 100)
  return (
    <div className="ui-progress">
      <div
        className="ui-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="ui-progress__fill" style={{ width: `${percent}%` }} />
      </div>
      {/* 百分数对读屏软件藏起来：上面那条 progressbar 已经把 aria-valuenow 报过了。 */}
      {showPercent ? (
        <span className="ui-progress__percent" aria-hidden="true">{`${percent}%`}</span>
      ) : null}
    </div>
  )
}

/** NaN 也一起兜住：`Math.min/max` 遇到 NaN 会一路传下去，所以单独判一次。 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
