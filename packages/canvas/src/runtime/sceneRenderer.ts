/**
 * 建一块画布的渲染器。六个场景（首页、选英雄、开包、组牌、房间、对局）共用这一份。
 *
 * 抽出来是因为这几项**必须各页一致**，抄六份迟早有一处走岔：
 * - `preference: ['webgl']`——纪律 3.8，显式走 WebGL 不试 WebGPU。数组形式是排除式的：
 *   WebGPU 不在名单里就整个不试。漏掉这一项的那一页会在支持 WebGPU 的浏览器上走另一条
 *   渲染路径，而截图基线和性能指标都是按 WebGL 那条定的。
 * - `autoDensity: true`——让 Pixi 顺手把 canvas 的 CSS 尺寸设成逻辑像素，
 *   画布分辨率才和 `resolution` 对得上。漏掉它画面会糊掉或者整体偏大。
 * - `background`——底色不透明。这几页都整幅铺满，透明只会让壳的底色从边缘漏出来。
 * - `antialias: true`——卡面和边框都有斜边，关掉看得出锯齿。
 *
 * 渲染倍率由调用方给（纪律 3.3 封到 1.5，在装配层算，见 client 的各 *Stage）。
 */

import { autoDetectRenderer, type Renderer } from 'pixi.js'
import { CANVAS_BACKGROUND } from '../components/Box'

/** 建渲染器要的那几样，各场景的 `*SceneOptions` 都是它的超集。 */
export interface SceneRendererOptions {
  canvas: HTMLCanvasElement
  /** CSS 像素。 */
  width: number
  height: number
  /** 设备像素比，封顶 1.5（纪律 3.3）。 */
  resolution: number
}

export async function createSceneRenderer(options: SceneRendererOptions): Promise<Renderer> {
  return await autoDetectRenderer({
    canvas: options.canvas,
    width: options.width,
    height: options.height,
    resolution: options.resolution,
    preference: ['webgl'],
    antialias: true,
    autoDensity: true,
    background: CANVAS_BACKGROUND,
  })
}
