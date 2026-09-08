/**
 * 卡牌的透视投影：给一个卡面上的局部矩形，算出它绕 X / Y 轴转过之后的四个角。
 *
 * 卡上所有会跟着倾斜和翻面一起动的层（原画、边框铭牌、费用章、文字、牌背、高光）
 * 共用这一个投影，每层拿自己的局部矩形过一遍，得到的四个角直接喂给 Pixi 的
 * `PerspectivePlaneGeometry.setCorners`——它内部按细分做透视校正的 UV，
 * 所以贴图不会像仿射变换那样在梯形里被扯歪。
 *
 * 模型抄自旧客户端的 DOM 卡牌：`perspective: 1000px` 配 `rotateX` / `rotateY`，
 * 旋转中心是卡面正中（CSS 的 transform-origin 默认值），见 legacy 的 ui/cardTilt.ts
 * 和 styles.css 里 .hand-fan__slot 的 perspective。旧版用「压扁 + 错切」凑过一版，
 * 那是仿射变换，做不出近大远小，同样的角度看着就是另一回事，所以换成真投影。
 *
 * 数学：先按 CSS 的 `rotateX(ax) rotateY(ay)` 把点转到三维（矩阵是 Rx·Ry），
 * 再按观察点在 z = +CARD_PERSPECTIVE 处做透视除法。卡面本身在 z = 0 上，于是
 *
 *     x' = cosAy·x
 *     y' = sinAx·sinAy·x + cosAx·y
 *     z' = −cosAx·sinAy·x + sinAx·y
 *     投影 = (x', y') × d / (d − z')
 *
 * 坐标轴和 CSS 一致：x 向右、y 向下、z 朝观察者。所以正的绕 X 让上沿往后倒、
 * 正的绕 Y 让右沿往后倒，和旧版 cardTilt.ts 里那两句符号说明是同一套。
 */

import { CARD_HEIGHT } from '../layout/fanMath'

/**
 * 透视距离（卡面基准尺寸下的像素）。
 *
 * 旧版写的是 `perspective: calc(1000px * var(--hand-card-zoom))`——距离跟着卡一起放大，
 * 观察点等比后退，同样的角度在放大的卡上不会显得更夸张。这里的投影算在**卡自己的坐标系**里
 * （放大是外层容器的 scale），所以直接取 1000 就等价于旧版那条式子。
 */
const CARD_PERSPECTIVE = 1000

/** 旋转中心：卡面正中。卡的原点在底边中点，所以中心在 y = −卡高/2 处。 */
const PIVOT_Y = -CARD_HEIGHT / 2

/**
 * 四个角，顺序是左上、右上、右下、左下——和 `PerspectiveMesh.setCorners(x0,y0,…,x3,y3)`
 * 的入参顺序一一对应，可以直接展开传进去。
 */
export type Corners = [number, number, number, number, number, number, number, number]

export function createCorners(): Corners {
  return [0, 0, 0, 0, 0, 0, 0, 0]
}

/**
 * 一张卡的投影器。角度设一次，卡上每一层各调一次 project 拿自己的四个角。
 *
 * 一张卡一个实例，不做成模块级的共享对象：翻面和倾斜是逐帧写的，
 * 共享一份状态的话两张卡同时在动就会互相读到对方的角度。
 */
export class CardProjector {
  private sinX = 0
  private cosX = 1
  private sinY = 0
  private cosY = 1

  /** 设定绕 X、绕 Y 的角度（度）。翻面和倾斜是同一个绕 Y，调用方自己加好再传进来。 */
  setAngles(rotXDeg: number, rotYDeg: number): void {
    const ax = (rotXDeg * Math.PI) / 180
    const ay = (rotYDeg * Math.PI) / 180
    this.sinX = Math.sin(ax)
    this.cosX = Math.cos(ax)
    this.sinY = Math.sin(ay)
    this.cosY = Math.cos(ay)
  }

  /**
   * 把一个局部矩形投影成四个角，写进 out（不新建数组，逐帧调用不产生堆分配，见纪律 3.10）。
   *
   * @param mirrored 左右两列对调。牌背用：它和正面共用同一套角度，
   *   转过 180° 之后画出来天然是镜像的，对调一下正好抵消——这和旧版给背面单独写
   *   `scale.x = -1` 是同一件事，只是这里做在角点顺序上，不用多一层容器。
   */
  project(
    x: number,
    y: number,
    width: number,
    height: number,
    out: Corners,
    mirrored = false,
  ): void {
    const right = x + width
    const bottom = y + height
    this.point(x, y, out, mirrored ? 2 : 0)
    this.point(right, y, out, mirrored ? 0 : 2)
    this.point(right, bottom, out, mirrored ? 6 : 4)
    this.point(x, bottom, out, mirrored ? 4 : 6)
  }

  /** 投影一个点，结果写进 out 的第 slot、slot+1 两位。 */
  private point(px: number, py: number, out: Corners, slot: number): void {
    // 旋转中心的 x 就是 0（卡的原点在底边中点，正中在同一条竖线上），所以横坐标不用换算。
    const y = py - PIVOT_Y
    const rx = this.cosY * px
    const ry = this.sinX * this.sinY * px + this.cosX * y
    const rz = -this.cosX * this.sinY * px + this.sinX * y
    /*
     * z' 的绝对值最大也就半个卡宽加半个卡高（不到 200），离 1000 还远，
     * 所以分母不会趋近 0，翻到 90°、180° 都不用额外兜底。
     */
    const k = CARD_PERSPECTIVE / (CARD_PERSPECTIVE - rz)
    out[slot] = rx * k
    out[slot + 1] = PIVOT_Y + ry * k
  }
}
