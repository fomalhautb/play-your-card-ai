/**
 * 把 `preload/` 那两个函数接进 React：首屏闸门一个 hook，后台队列一个 hook。
 *
 * 在这一条之前 `preloadAll` 只有首页一个调用方（还是就地写的），
 * `preloadInBackground` 一个调用方都没有（迁移第 33 条留的口子）。
 * 现在首页和关于页都要等图，加载页也要显示进度，所以把这段接线收成一处。
 *
 * 为什么不做成 Context 或者全局 store：等图这件事是**每个界面各等各的一批**
 *（首页等 `HOME_IMAGES`、关于页等 `INFO_IMAGES`），状态天然属于那个组件。
 * 真正要全局只做一次的只有后台队列，那一条由下面的模块级开关兜住。
 */

import type { Platform } from '@ai-duel/platform'
import { useEffect, useState } from 'react'
import { PRELOAD_GROUPS } from './manifests'
import { type PreloadState, preloadAll, preloadInBackground, preloadState } from './preload'

/**
 * 等一批图，中途报进度。返回的状态直接喂给加载页。
 *
 * `urls` 必须是**模块级常量**：它是下面那个 effect 的依赖，每次渲染现拼一个新数组
 * 会让 effect 反复重排队（旧版 `useAssetsProgress` 也是这条约束）。
 */
export function useAssets(platform: Platform, urls: readonly string[]): PreloadState {
  /*
   * 首帧先同步问一句「这批图有结果了吗」：从别的页面回到首页时它们早就在缓存里，
   * 先问一次就不用闪一下加载页（见 preload/preload.ts 的 preloadState）。
   */
  const [state, setState] = useState<PreloadState>(() => preloadState(platform, urls))

  /*
   * 不先判「是不是已经就绪」再决定要不要排队：图早就有结果时 `preloadAll` 会立刻
   * 报一次满格然后 resolve，多排这一趟一个请求都不会发。
   * 反过来，加一句 `if (state.ready) return` 就等于把 `state` 拖进依赖，
   * 于是每报一次进度都要重排一遍队。
   */
  useEffect(() => {
    let alive = true
    void preloadAll(platform, urls, (next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
    }
  }, [platform, urls])

  return state
}

/**
 * 后台队列已经开过没有。
 *
 * 模块级而不是组件状态：首页会被反复挂载（来回切页、开发构建下 StrictMode 还要挂两遍），
 * 而「把剩下的图下完」这件事一次会话只该排一趟。第二趟虽然会被 platform 那边的
 * 「已经有结果就跳过」挡掉大半，但它仍然会把整份清单重新走一遍，没有意义。
 */
let backgroundStarted = false

/**
 * 首页亮出来之后，在后台把剩下的图按 `PRELOAD_GROUPS` 的顺序全部拉完。
 *
 * `enabled` 传的是「首页的闸门放行了没有」：闸门还没放行时这一趟不能开——
 * 后台队列和首页那批图会抢同样的并发额度，玩家看着的那条进度条会变慢
 *（分组的意义就是「先用到的先下」，见 preload/manifests.ts 的 PRELOAD_GROUPS）。
 *
 * 不返回任何东西，也没有取消：这一趟的产出是 platform 的图片缓存，
 * 界面切走了它照样该下完——那正是「后台」的意思。
 */
export function useBackgroundPreload(platform: Platform, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || backgroundStarted) return
    backgroundStarted = true
    void preloadInBackground(platform, PRELOAD_GROUPS)
  }, [platform, enabled])
}
