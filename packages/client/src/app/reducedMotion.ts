/**
 * 「减少动效」这一位从存档走到画面上的两条路。
 *
 * 存档里那一位在 `save/saveStore.ts`（`SaveData.reducedMotion`），它只负责记住；
 * 真正让它生效的是这里的两件事：
 *
 * 1. **DOM 那半边**：往 `<html>` 上打一个 `data-reduced-motion="true"`。
 *    约定是 `ui` 的样式表认这个属性，和系统的 `prefers-reduced-motion: reduce` 并列——
 *    两条谁成立都算。为什么不反过来、由组件去读存档：组件库不许知道存档长什么样
 *   （它只依赖 design 和 platform），而 CSS 本来就有「按祖先属性换一套规则」这条现成的路。
 *    **现在没有任何一份 `ui` 样式表在认它**：唯一认过的两处（`cardLoader.css`、
 *    `progressBar.css`）随简化第 2 步删掉加载页那两个组件一起走了。属性照旧打上去，
 *    等剥样式那几步重画 React 组件时直接接上。
 * 2. **画布那半边**：`DuelStage` 把这一位透给场景（`DuelSceneOptions.reducedMotion`），
 *    场景据此关掉震屏和跟指针跑的倾斜 / 反光。那条路不经过 DOM，所以要单独走一趟。
 *
 * ## 为什么不订阅系统设置
 *
 * 系统那一档（`prefers-reduced-motion`）由 CSS 自己认，改了当场生效，不用 JS 插手。
 * 这里管的只是**玩家在设置页自己点的**那一档。画布那半边确实读不到系统设置——
 * 那是一个已知的缺口，等第 32 条之后再看要不要补一条 `matchMedia` 订阅
 *（补的话应该补进 platform，而不是让场景自己去问浏览器）。
 */

/** `<html>` 上那个属性的名字。CSS 那边写的是 `:root[data-reduced-motion="true"]`。 */
const ATTRIBUTE = 'data-reduced-motion'

/**
 * 把这一位打到（或从）`<html>` 上。
 *
 * 关掉时把属性整个删掉而不是写 `"false"`：CSS 选的是 `[data-reduced-motion="true"]`，
 * 留一个 `"false"` 在那儿只会让人以为它还起着作用。
 */
export function applyReducedMotion(on: boolean): void {
  // 没有 document 的环境（测试、将来的 SSR）直接跳过：这一层纯粹是给浏览器看的。
  if (typeof document === 'undefined') return
  if (on) document.documentElement.setAttribute(ATTRIBUTE, 'true')
  else document.documentElement.removeAttribute(ATTRIBUTE)
}
