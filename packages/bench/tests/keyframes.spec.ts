/**
 * 剧本关键帧的截图回归（《正式版架构》6.6、迁移第 20 条）。
 *
 * 目录页那条回归拍的是「组件和整局的**版式**」，停在几个静止的时刻；这一条补的是
 * **演出途中**：牌飞到一半、展示层刚立起来、结算层正在逐行盖章。那几拍上出岔子
 * （落点算错、层没开、字没出来）在静止帧上一个都看不出来。
 *
 * 每段剧本取一帧，两档视口各一套，和 `packages/bench/baselines/{平台}/` 比。
 * 差异比例的口径和目录页一致（`maxDiffPixelRatio` 0.001，见 client 的 dev/storybook 那份配置）。
 * 基线按平台分目录，理由也一样：字体光栅化在 macOS 和 Linux 上对不齐，一份基线两边比不过。
 * darwin 那份本机 `--update-snapshots` 生成后提交，linux 那份由 `.github/workflows/bench-baselines.yml`
 * 跑出来传成 artifact（怎么刷新见 README）。
 *
 * 画面从 Pixi 的 `extract` 抓，不走 `page.screenshot()`，理由见 src/page/grabFrame.ts。
 *
 * 进 CI **快档**的 `keyframes` job，单独占一台跑机：它是快档里最重的一步，
 * 和交互回归挤在一起装不进 10 分钟（见 .github/workflows/ci.yml）。
 */

import { PROFILES } from '../src/node/profiles'
// 每条用例各开一个新浏览器，不共用 worker 那一个——为什么见 freshBrowser.ts。
import { expect, test } from './freshBrowser'
import { captureKeyframes, initOptions, initScene, openBench } from './harness'

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
const PLANS: readonly { segment: string; stops: readonly number[] }[] = [
  // 抛硬币过场收尾。
  { segment: 'deal', stops: [120] },
  // 我方第一张落场的特效。
  { segment: 'play10', stops: [90] },
  // 卡飞向屏幕中央翻正。
  { segment: 'flip', stops: [40] },
  // 题面揭晓、答案框正在擦出来。
  { segment: 'settle', stops: [120] },
]

for (const profile of PROFILES) {
  for (const plan of PLANS) {
    test(`${profile.name}/${plan.segment}：关键帧和基线一致`, async ({ page }) => {
      await openBench(page)
      await initScene(page, initOptions(profile, true))

      const { shots, frames } = await captureKeyframes(page, plan.segment, plan.stops)
      // 帧号排到剧本长度之外时抓到的图会少几张。那不是「截图丢了」，是帧号该改了。
      expect(shots.length, `这一段只跑了 ${frames} 帧，${plan.stops.join('、')} 排远了`).toBe(
        plan.stops.length,
      )

      plan.stops.forEach((stop, index) => {
        // soft：一帧对不上不打断后面的，一轮跑完能看到全部差异（同目录页那条的理由）。
        expect.soft(shots[index]).toMatchSnapshot(`${profile.name}-${plan.segment}-f${stop}.png`, {
          maxDiffPixelRatio: 0.001,
        })
      })
    })
  }
}
