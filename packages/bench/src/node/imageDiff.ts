/**
 * 两张 PNG 差多少像素。跨浏览器一致性（《正式版架构》6.10、迁移第 34 条）用。
 *
 * 为什么不用 Playwright 自带的 `toMatchSnapshot`：那条路会把「参照图」当成**这个 project
 * 自己的基线**，跑 `--update-snapshots` 时顺手拿 webkit 拍的图把 chromium 的基线覆盖掉。
 * 跨浏览器比的是「webkit 和 chromium 画得一样吗」，chromium 那张是只读的参照物，
 * 不是这条用例的基线，所以比对自己做一遍，参照图全程只读。
 *
 * 另一个好处是**每次都能把实测比例打出来**。阈值是按实测定的，而 Linux 跑机上的数
 * 只有第一次真跑完才知道；比例进了日志，下次调阈值就有据可依，不用红一次再去猜。
 *
 * pixelmatch 是 6.12 工具表里点名的那一个，不自己写比对。
 */

import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

export interface ImageDiff {
  /** 判定为不一致的像素数。 */
  diffPixels: number
  /** 不一致像素占全图的比例，`toMatchSnapshot` 的 `maxDiffPixelRatio` 同一个口径。 */
  ratio: number
  width: number
  height: number
  /** 差异图的 PNG：不一致的像素涂红，底下压着一层淡淡的原图。 */
  diff: Buffer
}

/**
 * 单个像素差到什么程度才算「不一样」（pixelmatch 的 YIQ 色距，0～1）。
 *
 * 取 0.2 是跟着 Playwright 自己的默认值走：目录页和关键帧那两条回归用的就是这个数，
 * 三条检查用同一把尺子，报出来的比例才互相可比。
 * 再小的话跨浏览器那点亮度漂移会把整张图都点亮，比例失去意义。
 */
const PIXEL_THRESHOLD = 0.2

/**
 * 比两张 PNG。尺寸对不上直接抛——那不是「差异大」，是抓图的口径变了（渲染倍率、
 * 视口或者 `SHOT_SCALE` 改过），继续比下去只会得到一个没意义的数。
 *
 * 抗锯齿像素**不计入**差异（pixelmatch 的默认行为，`includeAA` 不开）。
 * 这是跨浏览器比对的关键一条：三家的字形光栅化和边缘抗锯齿本来就各画各的，
 * 把那些像素算进去的话比例几乎全是它们贡献的，真正要抓的「整块缺失、颜色错、层级错」
 * 反而淹没在里面。
 */
export function diffPng(expected: Buffer, actual: Buffer): ImageDiff {
  const left = PNG.sync.read(expected)
  const right = PNG.sync.read(actual)
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `两张图尺寸不一样：${left.width}×${left.height} 对 ${right.width}×${right.height}，没法逐像素比`,
    )
  }
  const out = new PNG({ width: left.width, height: left.height })
  const diffPixels = pixelmatch(left.data, right.data, out.data, left.width, left.height, {
    threshold: PIXEL_THRESHOLD,
  })
  return {
    diffPixels,
    ratio: diffPixels / (left.width * left.height),
    width: left.width,
    height: left.height,
    diff: PNG.sync.write(out),
  }
}

/** 报告里那一行：`1.23%（12345/1036800 像素）`。比例小到一眼看不出时百分数比小数好读。 */
export function formatRatio(result: ImageDiff): string {
  const percent = (result.ratio * 100).toFixed(3)
  return `${percent}%（${result.diffPixels}/${result.width * result.height} 像素）`
}
