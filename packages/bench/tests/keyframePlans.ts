/**
 * 关键帧拍哪几拍、图叫什么名字。两条用例共用：
 * `keyframes.spec.ts`（chromium 拍的图和基线逐像素比）和 `crossBrowser.spec.ts`
 * （webkit / firefox 拍的图和 chromium 的**同一帧**比，迁移第 34 条）。
 *
 * 单独一个文件而不是让后者直接 import 前者：spec 文件一旦被 import，里面的 `test(...)`
 * 会在 import 的那一刻就注册到当前文件上，两边的用例就混在一起了。
 */

import type { ProfileName } from '../src/thresholds'

/**
 * 每段剧本停在哪一帧。帧号从**被测动作**的第一帧算起（热身那一遍不计），60fps 定步长。
 *
 * 挑的都是「正在演」的时刻，不是演完之后的静止帧——静止帧目录页已经拍过了。
 * 帧号排在前一两百帧里还有个实际好处：抓齐就收工（见 benchApi 的 keyframes），
 * `play10` 一整遍是一千五百多帧，跑完剩下的一千多帧对这条检查毫无意义。
 * 改了 `director/timings.ts` 里的时长，这些帧号可能就落到别的一拍上了，基线要跟着重拍。
 *
 * **一段为什么只停一帧**：第一版每段停两帧，晚的那一帧排在 f200～f420。
 * 一条用例的开销由**最后那个停帧**决定（抓齐就收工），所以晚的那一帧是贵的那一帧——
 * 它把每条用例的渲染量翻了三到五倍。这在本机（8 核）看着还行，
 * 到两核跑机上整组连 10 分钟都跑不完：第 34477014105 次运行里六分四十四秒过去，
 * 八条一条都没跑完。桌面档尤其贵，1920×1080 按 1.5 倍渲染就是 2880×1620，
 * SwiftShader 是纯 CPU 光栅，画多少像素就花多少时间。
 * 砍掉晚的那一帧之后每段只跑到第一个停帧，渲染量降到约四分之一。
 * 留下的这四帧仍然都是「正在演」的时刻，这条检查要拦的那类岔子（落点算错、层没开、
 * 字没出来）在它们身上照样看得见；演出后半程那几拍暂时没人看着，
 * 要补回来得先让这一组变快（降渲染倍率或者缩剧本，那是改口径）。
 */
export const PLANS: readonly { segment: string; stops: readonly number[] }[] = [
  // 抛硬币过场收尾。
  { segment: 'deal', stops: [120] },
  // 我方第一张落场的特效。
  { segment: 'play10', stops: [90] },
  // 卡飞向屏幕中央翻正。
  { segment: 'flip', stops: [40] },
  // 题面揭晓、答案框正在擦出来。
  { segment: 'settle', stops: [120] },
]

/**
 * 基线图的文件名。跨浏览器那条要按这个名字去 `baselines/{平台}/` 里翻 chromium 那张，
 * 所以它和 keyframes 那条存基线时用的名字**必须**是同一个——
 * 这个函数就是那个约定本身，两边都从这里取，改了名字也不会走岔。
 */
export function shotName(profile: ProfileName, segment: string, stop: number): string {
  return `${profile}-${segment}-f${stop}.png`
}
