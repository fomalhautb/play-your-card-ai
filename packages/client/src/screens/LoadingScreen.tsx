/**
 * 整屏加载页：正中一个卡牌 loader、一行「加载中…」和一条素材进度条。
 *
 * 界面在等自己那批图的时候拿它顶着（首页、关于页；将来教程和对局也是）。
 * 它替掉的是首页里那段临时进度条——那一段的注释就写着「正式的加载页归第 31 条」。
 *
 * 这一层只负责画，不负责等：进度从外面传进来（`preload/useAssets.ts` 的 `useAssets`），
 * 因为「等哪一批图」是每个界面自己的事。
 *
 * ## 为什么和 loader 的文字要错开
 *
 * `CardLoader` 自带 `role="status"` 和 `aria-label="加载中"`，进度条自带 `progressbar`
 * 和百分比。中间那行字对读屏软件**藏起来**，否则同一句话会被念两遍（抄旧版 LoadingScreen）。
 */

import { CardLoader, ProgressBar } from '@ai-duel/ui'
import './loadingScreen.css'

export interface LoadingScreenProps {
  /**
   * 0~1 的素材加载进度。
   *
   * 不传就不画进度条——给那些「在等的不是图」的地方用（比如联机时还在建 driver），
   * 那时数不出「下了几张」，画一条永远停在 0 的进度条比不画更像卡住了。
   */
  progress?: number
  /** 中间那行字。默认「加载中…」。 */
  text?: string
}

export function LoadingScreen({ progress, text = '加载中…' }: LoadingScreenProps) {
  return (
    <main className="loading">
      <CardLoader />
      <p className="loading__text" aria-hidden="true">
        {text}
      </p>
      {progress === undefined ? null : (
        <ProgressBar value={progress} label="素材加载进度" showPercent />
      )}
    </main>
  )
}
