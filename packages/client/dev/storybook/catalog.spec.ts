/**
 * 组件目录页的截图回归：把目录页上**每一个条目**各拍一张，和基线逐像素比。
 * 对应《正式版架构》6.6（Pixi 场景）和 6.8（React 界面）里那两条「拿目录页当输入」。
 *
 * 条目清单不写死，从 Storybook 自己的 `index.json` 读：7.1 第 3 条要求「每个组件必须有
 * 目录页条目，没有条目视同没写完」，清单要是手工维护的，加了组件忘了加条目就查不出来。
 *
 * ## 为什么是「几条用例各遍历一片」
 *
 * Playwright 建用例必须在加载测试文件时**同步**完成，而条目清单要等服务器起来之后才拿得到。
 * 所以没法「一个条目一条用例」，只能在用例里遍历。用 `expect.soft` 之后，
 * 一条条目对不上不会打断后面的，一轮跑完能看到全部差异——这正是每个条目一条用例的好处。
 *
 * 分片是被跑批时间逼出来的：整页一条用例在 CI 那台两核跑机上已经要 9 分多钟，
 * 而快档给每个 job 的口径是 10 分钟（见 .github/workflows/ci.yml）。
 * 所以这里按 `SHARDS` 开出几条**互不重叠**的用例，各自只拍其中一片，
 * CI 按标签把它们分到并行的 job 上；本机不加 `--grep` 就是几条依次跑完，总耗时和从前一样。
 */

import { expect, test } from '@playwright/test'

/** Storybook 的 index.json 里我们要用的那几个字段。 */
interface StoryIndex {
  entries: Record<string, { id: string; name: string; title: string; type: string }>
}

/**
 * 等这个属性出现才算这一帧可以拍了。
 *
 * 画布条目要等场景建完、手动时钟推到固定时刻；DOM 条目渲染出来就算数。
 * 两种都由 preview 的装饰器统一打这个标记（见 preview.tsx）。
 */
const READY = '[data-story-ready="1"]'

/**
 * 个别条目自己声明的单张截图时限（毫秒），由画布装饰器写在同一个元素上（见 pixiStory.tsx）。
 *
 * 为什么绕 DOM 走：条目清单是从 Storybook 的 index.json 读的，那份清单只有
 * id / name / title，`parameters` 里的东西一样都带不出来。
 */
const TIMEOUT_ATTR = 'data-screenshot-timeout'

/**
 * 分几片。
 *
 * 改这个数要**同时**改 `.github/workflows/ci.yml` 里 `catalog` 那个 job 的 matrix：
 * 工作流按 `@shard<n>` 这个标签筛用例，多出来的那一片会变成「一条用例都没匹配到」
 * 而不是失败，静悄悄地少拍一批条目。
 */
const SHARDS = 2

/**
 * 条目怎么分到各片：**按排序后的序号轮流发牌**（第 1 条给第 1 片、第 2 条给第 2 片……）。
 *
 * 不按 `Canvas/*` 和 `UI/*` 分，是因为两边条目数差得太远（现在是 149 比 15），
 * 分完仍然是一片扛住九成的时间。轮流发牌能让重条目（全屏的结算层、对局场景那六条）
 * 自然摊到各片上，而**基线图是按 story id 存的**，和它落在哪一片无关——
 * 新增条目让分片重新洗牌也不会让任何一张基线失效。
 */
function shardOf(index: number): number {
  return (index % SHARDS) + 1
}

for (let shard = 1; shard <= SHARDS; shard += 1) {
  test(`组件目录页第 ${shard}/${SHARDS} 片的条目都和基线一致`, { tag: `@shard${shard}` }, async ({
    page,
    baseURL,
  }) => {
    const response = await page.request.get(`${baseURL}/index.json`)
    expect(response.ok(), 'Storybook 的 index.json 取不到').toBe(true)
    const index = (await response.json()) as StoryIndex
    const all = Object.values(index.entries)
      .filter((entry) => entry.type === 'story')
      // 按 id 排一遍：index.json 的顺序跟着文件扫描走，而分片是按序号发的，
      // 不排的话同一条条目换台机器可能落进另一片。排过之后失败日志的次序也每次一样。
      .sort((a, b) => a.id.localeCompare(b.id))

    expect(all.length, '目录页一个条目都没有').toBeGreaterThan(0)
    const stories = all.filter((_, position) => shardOf(position) === shard)
    expect(stories.length, `第 ${shard} 片一个条目都没分到`).toBeGreaterThan(0)

    const problems: string[] = []
    page.on('pageerror', (error) => problems.push(error.message))

    for (const story of stories) {
      /*
       * 直接开 iframe.html 而不是 Storybook 的外壳：外壳带侧边栏、工具栏和地址栏状态，
       * 拍进来的话改一次 Storybook 版本所有基线就全废了。iframe.html 里只有条目本身。
       */
      await page.goto(`/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`)
      const frame = page.locator(READY)
      await frame.waitFor({ timeout: 60_000 })
      // 字体没加载完就拍的话，第一次是兜底字体、第二次是真字体，两次拍出来的不一样。
      await page.evaluate(() => document.fonts.ready)
      /*
       * 时限按条目走：绝大多数条目用 playwright.config.ts 里统一的那一档，个别特别重的
       *（首页那三条，理由见 HomeScene.stories.ts）自己声明一个更长的。没声明就没有这个属性。
       */
      const declared = await frame.getAttribute(TIMEOUT_ATTR)
      const options = declared === null ? {} : { timeout: Number(declared) }
      /*
       * 只拍这个条目本身那一块，不拍整页。
       *
       * 整页拍的是 1280×900 的视口，而一张卡只占中间那一小块——差异比例的分母被空白撑大十几倍，
       * 同样的阈值就等于放宽十几倍。按条目的实际大小拍，阈值才卡在该卡的地方。
       * 顺带也让基线图小一大截。
       *
       * 文件名就是 story id：id 由「title + 导出名」生成，改了名字基线跟着改名，一目了然。
       */
      await expect.soft(frame).toHaveScreenshot(`${story.id}.png`, options)
    }

    expect(problems, `目录页有条目在浏览器里报错：\n${problems.join('\n')}`).toEqual([])
  })
}
