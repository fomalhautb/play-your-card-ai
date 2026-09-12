/**
 * 整屏加载页：正中一行「加载中 37%」。
 *
 * 界面在等自己那批图的时候拿它顶着（首页、关于页、选英雄页）。
 * 原先这一屏有一个跳动的线框卡 loader 加一条进度条（`ui` 的 `CardLoader` / `ProgressBar`），
 * 正式版简化第 2 步换成了纯文字：视觉后面整套重做，这两件是和旧样式绑得最死的装饰。
 *
 * 这一层只负责画，不负责等：进度从外面传进来（`preload/useAssets.ts` 的 `useAssets`），
 * 因为「等哪一批图」是每个界面自己的事。
 *
 * 整行挂 `role="status"`：它是这一屏唯一的内容，读屏软件要念的就是它，
 * 不会像从前那样和 loader 的 `aria-label`、进度条的 `aria-valuenow` 念重。
 */

import './loadingScreen.css'

export interface LoadingScreenProps {
  /**
   * 0~1 的素材加载进度。
   *
   * 不传就只显示「加载中…」——给那些「在等的不是图」的地方用（比如联机时还在建 driver），
   * 那时数不出「下了几张」，报一个永远停在 0 的百分数比不报更像卡住了。
   */
  progress?: number
}

export function LoadingScreen({ progress }: LoadingScreenProps) {
  return (
    <main className="loading">
      <p role="status">{progress === undefined ? '加载中…' : `加载中 ${percentOf(progress)}%`}</p>
    </main>
  )
}

/**
 * 0~1 换成 0~100 的整数。
 *
 * 只取整不四舍五入：99.6% 进到 100% 而画面还没换，看着像卡住了（抄旧版 LoadingScreen 的理由）。
 * NaN 和越界一律夹回来——`useAssets` 在「一张都没有要等」时算出来的就是 0/0。
 */
function percentOf(progress: number): number {
  if (!Number.isFinite(progress)) return 0
  return Math.floor(Math.min(1, Math.max(0, progress)) * 100)
}
