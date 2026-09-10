/**
 * 桩场景的 gsap 手动时钟开关。
 *
 * 单独成文件只有一个原因：那个「摘没摘掉」的开关必须是**模块级**的（gsap 本身是单例），
 * 而模块级的可变状态藏在几百行的场景实现中间很难被看见——同一个进程里建两次场景会互相影响。
 * 真实场景那边的同一件事在 canvas 的 `runtime/frameLoop.ts` 里，两边互不相干。
 */

import { gsap } from 'gsap'

/** gsap 的根时间轴当前是不是由我们手动推。 */
let detached = false

/**
 * 手动时钟下必须把 gsap 自己的 rAF 循环摘掉，否则它会在 step() 之外偷偷推进补间，
 * 剧本就不再是确定性的了。这是 gsap 官方给的手动驱动写法。
 */
export function configureGsap(manual: boolean) {
  gsap.ticker.lagSmoothing(0)
  if (manual && !detached) {
    gsap.ticker.remove(gsap.updateRoot)
    gsap.ticker.sleep()
    detached = true
  } else if (!manual && detached) {
    gsap.ticker.add(gsap.updateRoot)
    gsap.ticker.wake()
    detached = false
  }
}
