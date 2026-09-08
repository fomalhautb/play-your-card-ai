/**
 * 组件目录页的截图回归：把目录页上**每一个条目**各拍一张，和基线逐像素比。
 * 对应《正式版架构》6.6（Pixi 场景）和 6.8（React 界面）里那两条「拿目录页当输入」。
 *
 * 条目清单不写死，从 Storybook 自己的 `index.json` 读：7.1 第 3 条要求「每个组件必须有
 * 目录页条目，没有条目视同没写完」，清单要是手工维护的，加了组件忘了加条目就查不出来。
 *
 * 为什么是一条用例遍历全部，而不是每个条目一条：Playwright 建用例必须在加载测试文件时
 * **同步**完成，而条目清单要等服务器起来之后才拿得到。用 `expect.soft` 之后，
 * 一条条目对不上不会打断后面的，一轮跑完能看到全部差异——这正是每个条目一条用例的好处。
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

test('组件目录页每个条目都和基线一致', async ({ page, baseURL }) => {
  const response = await page.request.get(`${baseURL}/index.json`)
  expect(response.ok(), 'Storybook 的 index.json 取不到').toBe(true)
  const index = (await response.json()) as StoryIndex
  const stories = Object.values(index.entries)
    .filter((entry) => entry.type === 'story')
    // 按 id 排一遍：index.json 的顺序跟着文件扫描走，排过之后失败日志每次的次序才一样。
    .sort((a, b) => a.id.localeCompare(b.id))

  expect(stories.length, '目录页一个条目都没有').toBeGreaterThan(0)

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
     * 只拍这个条目本身那一块，不拍整页。
     *
     * 整页拍的是 1280×900 的视口，而一张卡只占中间那一小块——差异比例的分母被空白撑大十几倍，
     * 同样的阈值就等于放宽十几倍。按条目的实际大小拍，阈值才卡在该卡的地方。
     * 顺带也让基线图小一大截。
     *
     * 文件名就是 story id：id 由「title + 导出名」生成，改了名字基线跟着改名，一目了然。
     */
    await expect.soft(frame).toHaveScreenshot(`${story.id}.png`)
  }

  expect(problems, `目录页有条目在浏览器里报错：\n${problems.join('\n')}`).toEqual([])
})
