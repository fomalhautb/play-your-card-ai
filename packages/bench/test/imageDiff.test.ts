/**
 * 跨浏览器比对那把尺子自己的测试（src/node/imageDiff.ts）。
 *
 * 比的是「这把尺子会不会量错」，不是「三家画得像不像」——后者要真浏览器，在
 * tests/crossBrowser.spec.ts。这里特别要钉死的是**抗锯齿像素不算差异**那条：
 * 它是跨浏览器容差能定得住的前提，哪天 pixelmatch 的默认值变了得当场红。
 */

import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { diffPng, formatRatio } from '../src/node/imageDiff'

/** 按一个「给我第 (x, y) 个像素什么颜色」的函数烤一张 PNG。 */
function png(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): Buffer {
  const image = new PNG({ width, height })
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      const [r, g, b] = paint(x, y)
      image.data[at] = r
      image.data[at + 1] = g
      image.data[at + 2] = b
      image.data[at + 3] = 255
    }
  }
  return PNG.sync.write(image)
}

const WHITE = (): [number, number, number] => [255, 255, 255]

describe('diffPng', () => {
  it('同一张图差 0 个像素', () => {
    const image = png(8, 8, WHITE)
    const result = diffPng(image, image)
    expect(result.diffPixels).toBe(0)
    expect(result.ratio).toBe(0)
    expect(result.width).toBe(8)
    expect(result.height).toBe(8)
  })

  it('整块画错时比例就是那一块的面积占比', () => {
    // 右半边整个涂黑：这正是这条检查要抓的那类岔子（某一层整块没画出来）。
    const left = png(8, 8, WHITE)
    const right = png(8, 8, (x) => (x >= 4 ? [0, 0, 0] : [255, 255, 255]))
    const result = diffPng(left, right)
    expect(result.diffPixels).toBe(32)
    expect(result.ratio).toBe(0.5)
  })

  it('整片轻微偏色不算差异', () => {
    // 跨浏览器最常见的就是这种：混合和精度差一点点，整张图一起偏一两个色阶。
    const left = png(8, 8, WHITE)
    const right = png(8, 8, () => [252, 252, 252])
    expect(diffPng(left, right).diffPixels).toBe(0)
  })

  it('斜边上的抗锯齿像素不算差异', () => {
    /*
     * 同一条斜边，一家把边缘像素画成中灰、另一家画成浅灰——三家的抗锯齿就是这么差的。
     * pixelmatch 认得出这是抗锯齿而不是内容变了，所以它们不进比例。
     */
    const edge =
      (light: number) =>
      (x: number, y: number): [number, number, number] => {
        if (x < y) return [0, 0, 0]
        if (x > y) return [255, 255, 255]
        return [light, light, light]
      }
    const result = diffPng(png(16, 16, edge(128)), png(16, 16, edge(200)))
    expect(result.diffPixels).toBe(0)
  })

  it('尺寸对不上直接抛，不给一个没意义的比例', () => {
    expect(() => diffPng(png(8, 8, WHITE), png(8, 4, WHITE))).toThrow('尺寸不一样')
  })
})

describe('formatRatio', () => {
  it('写成百分数加像素数', () => {
    const result = diffPng(
      png(10, 10, WHITE),
      png(10, 10, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255])),
    )
    expect(formatRatio(result)).toBe('10.000%（10/100 像素）')
  })
})
