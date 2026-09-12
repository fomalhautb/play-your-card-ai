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
 * 进 CI **快档**，而且按剧本段拆成四个并行 job（见 .github/workflows/ci.yml）：
 * 它是快档里最重的一步，八条挤在一台两核跑机上要十三四分钟，一格一台才装得进 10 分钟。
 * 每条用例挂了一个 `@剧本段` 的标签，**那是工作流的接口**：改了名字那一格会变成
 * 「一条用例都没匹配到」而不是失败，静悄悄地少跑一格（和 deterministic.spec.ts 同一个约定）。
 */

import { PROFILES } from '../src/node/profiles'
// 每条用例各开一个新浏览器，不共用 worker 那一个——为什么见 freshBrowser.ts。
import { expect, test } from './freshBrowser'
import { captureKeyframes, initOptions, initScene, openBench } from './harness'
// 拍哪几帧、图叫什么名字和跨浏览器那条共用一份，见 keyframePlans.ts 的文件头。
import { PLANS, shotName } from './keyframePlans'

for (const profile of PROFILES) {
  for (const plan of PLANS) {
    test(`${profile.name}/${plan.segment}：关键帧和基线一致`, {
      tag: `@${plan.segment}`,
    }, async ({ page }) => {
      await openBench(page)
      await initScene(page, initOptions(profile, true))

      const { shots, frames } = await captureKeyframes(page, plan.segment, plan.stops)
      // 帧号排到剧本长度之外时抓到的图会少几张。那不是「截图丢了」，是帧号该改了。
      expect(shots.length, `这一段只跑了 ${frames} 帧，${plan.stops.join('、')} 排远了`).toBe(
        plan.stops.length,
      )

      plan.stops.forEach((stop, index) => {
        // soft：一帧对不上不打断后面的，一轮跑完能看到全部差异（同目录页那条的理由）。
        expect.soft(shots[index]).toMatchSnapshot(shotName(profile.name, plan.segment, stop), {
          maxDiffPixelRatio: 0.001,
        })
      })
    })
  }
}
