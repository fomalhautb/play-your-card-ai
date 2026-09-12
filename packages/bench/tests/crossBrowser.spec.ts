/**
 * 三浏览器一致性（《正式版架构》6.10、迁移第 34 条）。进 CI **慢档**。
 *
 * 同一段剧本、同一个帧号，在 webkit 和 firefox 各拍一遍，和 **chromium 拍的那一张**比。
 * chromium 那张就是 `baselines/{平台}/` 里的关键帧基线——它在快档里每个 PR 都被重拍一遍
 * 并逐像素比过（`keyframes.spec.ts`，容差 0.001），所以它和「此刻 chromium 画出来的样子」
 * 是同一张图，拿它当参照物不用再跑一遍 chromium。省下的正是最贵的那一遍软件光栅。
 *
 * **它不是「webkit / firefox 各自的基线」**：三家各存一套基线的话，浏览器一升级整套就红，
 * 刷一遍谁也没看，那条检查就废了。这里要回答的是另一个问题——
 * 「有没有哪一家把这一帧画错了」：整块没画出来、颜色错、层级压反。
 * 所以容差比同浏览器回归宽得多，见下面 CROSS_BROWSER_DIFF_RATIO 的说明。
 *
 * 抗锯齿和字形光栅化的差别**不计入**（pixelmatch 的抗锯齿检测，见 src/node/imageDiff.ts）：
 * 三家的字形和边缘本来就各画各的，算进去的话比例几乎全是它们贡献的。
 *
 * 每条用例挂了一个 `@剧本段` 的标签，**那是工作流的接口**（同 keyframes.spec.ts 的约定）：
 * 慢档按「浏览器 × 剧本段」分格，靠 `--project` 加 `--grep "@剧本段"` 筛出这一格那两条用例。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import type { TestInfo } from '@playwright/test'
import { diffPng, formatRatio } from '../src/node/imageDiff'
import { PROFILES } from '../src/node/profiles'
import type { ProfileName } from '../src/thresholds'
// 每条用例各开一个新浏览器，不共用 worker 那一个——为什么见 freshBrowser.ts。
import { expect, test } from './freshBrowser'
import { captureKeyframes, initOptions, initScene, openBench, webglRenderer } from './harness'
// 拍哪几帧、图叫什么名字和快档那条共用一份，见 keyframePlans.ts 的文件头。
import { PLANS, shotName } from './keyframePlans'

/**
 * 跨浏览器允许差到什么比例。**这是新的一档，不是把已有阈值放宽**：
 * 同浏览器的关键帧回归还是 0.001（`keyframes.spec.ts`），目录页也还是 0.001，
 * 这个数只管「chromium 画的和另外两家画的差多少」。
 *
 * 为什么必须宽这么多：三家走的根本不是同一条渲染路径。本机（macOS，2026-09-11 实测）
 * chromium 走 ANGLE 的 SwiftShader 软件光栅，mediump 真的只有 10 位；
 * webkit 和 firefox 走真 GPU，mediump 被提到 23 位。着色器精度、混合时的取整、
 * 渐变和发光的每一步都因此差一点点，整片区域一起偏，不是几个像素的事。
 *
 * 数是实测定的，口径同这个仓库别处的阈值——**实测最大值留约 1.5 倍余量再取整**。
 * 2026-09-11 在 Apple M2 上十六次比对（两档视口 × 四段剧本 × 两个浏览器）的结果：
 *
 * | 剧本 | webkit 桌面 / 手机 | firefox 桌面 / 手机 |
 * |---|---|---|
 * | `deal` | 0.015% / 0.077% | 0.002% / 0.005% |
 * | `play10` | 0.003% / 0.016% | 0.054% / 0.140% |
 * | `flip` | 0.006% / 0.023% | 0.008% / 0.094% |
 * | `settle` | 0.101% / 0.023% | **0.342%** / 0.165% |
 *
 * 最大的是 firefox 的桌面档 `settle`（0.342%，518400 个像素里 1772 个），×1.5 取整是 0.006，
 * 那是这个阈值最早的值，两档视口共用一个数。
 * 那一张的差异图看过：红点**全落在文字笔画上**，没有整块缺失、没有偏色的区域、
 * 没有层级压反——结算层字最多，所以它最大，这正是这个阈值该吃下的那部分。
 *
 * **Linux 跑机上的数比本机大得多，而且两档视口差一档**，所以这里按视口分两个数
 * （2026-09-12 的运行 34674939419，webkit 那八格；chromium 基线是同一批跑机拍的）：
 *
 * | 剧本 | webkit 桌面 | webkit 手机 |
 * |---|---|---|
 * | `deal` | 0.028%（144/518400） | 0.160%（132/82290） |
 * | `play10` | 0.152%（789/518400） | 0.429%（353/82290） |
 * | `flip` | 0.095%（495/518400） | **0.961%（791/82290）** |
 * | `settle` | **0.496%（2573/518400）** | 0.469%（386/82290） |
 *
 * 按同样的口径（实测最大值 ×1.5 取整）：桌面 0.496% → 0.008，手机 0.961% → 0.015。
 *
 * **手机档为什么要单独宽一档：分母小，不是画得更差。** 基线图按逻辑像素的一半存
 *（`src/page/grabFrame.ts` 的 `SHOT_SCALE`），桌面档一张 960×540（518400 像素），
 * 手机档一张只有 195×422（82290 像素），差 6.3 倍。而上表右边那一列的**绝对**像素数
 *（132 / 353 / 791 / 386）和左边那一列（144 / 789 / 495 / 2573）是同一个量级——
 * 也就是说两档差的是同样多的像素，只是手机档拿一个小六倍的分母去除。
 * 一刀切成一个数的话，要么手机档永远红，要么桌面档松到什么都拦不住。
 *
 * 手机档 `flip` 那张（超了旧阈值的那一张）的差异图看过：红点**全落在文字笔画上**
 *（卡名「claude-fable-5」、卡面中段那行小字、顶栏的比分数字），
 * 卡面原画、边框、层级一个红点都没有——和本机那张的构成一样，正是这个阈值该吃下的部分。
 * Linux 上比本机大是因为那边 chromium 和 webkit 都走软件光栅、字体走 fontconfig 而不是
 * CoreText，两家的字形光栅化对不齐的程度比 macOS 上大。
 *
 * **firefox 在 Linux 上的八个数还没量到**：头两次慢档它一格都没跑起来
 *（无头 Firefox 不给 WebGL，见 playwright.config.ts），修好之后那次又因为跑机账单停了
 * 没能跑完。它在本机上的比例是 webkit 的三倍多，所以上面这两个数不一定吃得下它。
 * 每次比对不管过没过都把实测比例打进日志（见下面），红了照日志里的数按同样口径重定，
 * 不用靠猜——**但别顺手往上调到刚好能过**，那等于把这条检查关掉。
 * 要先看差异图确认红的仍然只是文字。
 */
const CROSS_BROWSER_DIFF_RATIO: Readonly<Record<ProfileName, number>> = {
  desktop: 0.008,
  mobile: 0.015,
}

/**
 * 把一张 PNG 落到 `test-results/` 下再挂成附件。
 *
 * 直接挂 `body` 是不行的：那份数据只活在报告对象里，而这个包只开了 list 和自己那个
 * reporter，两个都不落盘，挂上去等于没挂。慢档失败时传的是 `test-results` 整个目录
 *（见 .github/workflows/slow.yml），所以必须先成为文件。
 */
async function attachPng(testInfo: TestInfo, name: string, body: Buffer): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`)
  writeFileSync(path, body)
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

for (const profile of PROFILES) {
  for (const plan of PLANS) {
    test(
      `${profile.name}/${plan.segment}：和 chromium 画得一致`,
      {
        tag: `@${plan.segment}`,
      },
      async ({ page, browserName }, testInfo) => {
        // 阈值按视口取：手机档那张图小六倍，同样多的字形像素算出来的比例大得多（见上面）。
        const limit = CROSS_BROWSER_DIFF_RATIO[profile.name]
        await openBench(page)
        /*
         * 把这个浏览器的 WebGL 后端打进日志。差异比例是大是小全靠它解释：
         * 同样一个数，在「两边都是软件光栅」和「一边软件一边真 GPU」之下含义完全不同。
         * 跑机换了驱动、Playwright 换了浏览器版本，这一行也是唯一能看出来的地方。
         */
        console.log(`[${browserName}] WebGL 后端：${await webglRenderer(page)}`)

        await initScene(page, initOptions(profile, true))
        const { shots, frames } = await captureKeyframes(page, plan.segment, plan.stops)
        // 帧号排到剧本长度之外时抓到的图会少几张。那不是「截图丢了」，是帧号该改了。
        expect(shots.length, `这一段只跑了 ${frames} 帧，${plan.stops.join('、')} 排远了`).toBe(
          plan.stops.length,
        )

        for (const [index, stop] of plan.stops.entries()) {
          const name = shotName(profile.name, plan.segment, stop)
          /*
           * chromium 那张的位置由 Playwright 按配置里的 snapshotPathTemplate 算：
           * 模板里没有 {projectName}，所以每个 project 算出来的都是同一个
           * `baselines/{平台}/`，正好是快档存基线的那个目录。
           * 这里只读它，从不写它——写坏了快档那条回归就没有参照物了。
           */
          const reference = testInfo.snapshotPath(name)
          const shot = shots[index]
          if (!shot) throw new Error(`第 ${stop} 帧没抓到`)

          let expected: Buffer
          try {
            expected = readFileSync(reference)
          } catch {
            throw new Error(
              `缺 chromium 基线 ${reference}。先让快档的关键帧那条把这个平台的基线生成出来（见 packages/bench/README.md 的「基线怎么刷新」），这条才有参照物。`,
            )
          }

          const result = diffPng(expected, shot)
          // 不管过没过都打一行：阈值就是靠这些数定的，Linux 上的数只有真跑完才知道。
          console.log(`[${browserName}] ${name} 和 chromium 差 ${formatRatio(result)}`)

          if (result.ratio > limit) {
            // 只在超了的时候留图：光看一个比例说不出是「整块没画」还是「颜色偏了一点」。
            // 名字里去掉 `.png`，`attachPng` 会自己加回去。
            const stem = `${browserName}-${name.replace(/\.png$/, '')}`
            await attachPng(testInfo, stem, shot)
            await attachPng(testInfo, `${stem}-diff`, result.diff)
          }
          // soft：一帧超了不打断后面的，一轮跑完能看到全部差异（同关键帧那条的理由）。
          expect
            .soft(result.ratio, `${browserName} 的 ${name} 和 chromium 差 ${formatRatio(result)}`)
            .toBeLessThanOrEqual(limit)
        }
      },
    )
  }
}
