/**
 * 把教程此刻的样子挂到 `window.__aiDuel.tutorial` 上，**只在开发构建里**。
 *
 * 端到端那条用例（e2e/tutorial.spec.ts）要它：判断「现在该做什么」得知道停在哪一步，
 * 而步骤 id 一个字都不在 DOM 里；要点的那几处也只有画布场景答得上来。
 * 点还是真的用指针点——这个口子只回答「在哪儿」，不代替任何一次点击。
 *
 * 动态 import 而不是文件顶部那种：`import.meta.env.DEV` 在生产构建里是字面量 false，
 * 整段连同 dev/debugHook 那个模块一起被当成死代码删掉（同 screens/MatchScreen.tsx）。
 */

import { useEffect, useRef } from 'react'
import type { TutorialProbe } from '../dev/debugHook'

export function useTutorialDebug(read: () => TutorialProbe): void {
  /*
   * 取值器存 ref：它每次渲染都是新函数，而这个口子只挂一次。
   * 不存 ref 的话要么每渲染一次就重挂，要么用例读到的永远是第一次渲染那一份。
   */
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let remove: (() => void) | null = null
    let disposed = false
    void import('../dev/debugHook').then(({ installTutorialDebug }) => {
      // 等这个 await 的工夫组件可能已经卸载了，那就别再挂上去。
      if (disposed) return
      remove = installTutorialDebug(() => readRef.current())
    })
    return () => {
      disposed = true
      remove?.()
    }
  }, [])
}
