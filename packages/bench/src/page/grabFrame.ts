/**
 * 把此刻的画面抓成一张 PNG（data URL），给剧本关键帧的截图回归用。
 *
 * 不用 Playwright 的 `page.screenshot()`，走 Pixi 自己的 `extract`，两个理由：
 * 一是 WebGL 画布默认不保留绘制缓冲，截屏拿到的可能是空白，而 `extract` 是重新渲染一遍到
 * 离屏纹理再读回来，不依赖浏览器合成器的时机；二是它**同步**，可以卡在剧本的某一帧之间抓，
 * 不用为了截图把剧本停下来再恢复。
 *
 * 抓的范围显式给成整块视口（`frame`），不让 `extract` 按内容包围盒裁——包围盒每帧都在变，
 * 裁出来的图尺寸也跟着变，就没法和基线逐像素比了。
 * 底色也要显式给：渲染器的 `background` 不是场景树的一部分，不给的话抓回来是透明底，
 * 而透明底在 PNG 里和「画了一层同色的背景」是两张不同的图。
 */

import { tokens } from '@ai-duel/design'
import { Rectangle } from 'pixi.js'
import type { RenderProbe } from './renderProbe'

/**
 * 基线图按逻辑像素的**一半**存。
 *
 * 关键帧要拦的是「这一刻画面对不对」——牌飞到哪儿了、层开没开、字有没有出现；
 * 逐像素级的字形回归由目录页那条负责（那边是原尺寸拍的）。半倍之后一张桌面档的图从
 * 八百多 KB 降到两百 KB，四段剧本两档视口两个平台加起来才不至于把基线目录撑爆。
 * 差异比例的口径不受影响：0.001 是**比例**，分母跟着一起缩。
 */
const SHOT_SCALE = 0.5

export function grabFrame(probe: RenderProbe, width: number, height: number): string {
  const renderer = probe.renderer()
  const stage = probe.stage()
  if (!renderer || !stage) throw new Error('没抓到 Pixi 的渲染调用，截不了图')
  const canvas = renderer.extract.canvas({
    target: stage,
    frame: new Rectangle(0, 0, width, height),
    // 倍率和渲染倍率（3.3 允许到 1.5）脱钩，固定按这个数抓，改渲染倍率不用重拍基线。
    resolution: SHOT_SCALE,
    clearColor: tokens.color.page.background,
  })
  if (typeof canvas.toDataURL !== 'function') throw new Error('这个环境的画布不支持 toDataURL')
  return canvas.toDataURL('image/png')
}
