/**
 * 安全区与视口能力：画面能用的那块矩形有多大、四边要让开多少、现在是横屏还是竖屏。
 *
 * 四样东西打成一份快照一起报，因为它们总是一起变：转屏、进出全屏、手机地址栏收起来，
 * 每一次都同时改宽高、改方向、改刘海让位。分成四个订阅的话，调用方会为同一次变化
 * 重排好几遍（旧代码就吃过这个亏，见 legacy-client/src/ui/viewportVars.ts 的说明）。
 *
 * 旧代码里对应的三处：
 * - viewportVars.ts：把视口宽高量成 CSS 变量，因为动态视口单位在安卓上更新会慢一拍；
 * - useStageScale.ts：按视口算舞台缩放；
 * - OrientationNotice.tsx：竖屏 + 粗指针才提示「请横屏」。
 * 安全区旧代码是纯 CSS 的 env(safe-area-inset-*)，正式版画面在画布上，CSS 够不着，
 * 所以要有一份能读到数的接口。
 */

/** 四边要让开的像素数。刘海、圆角、底部横条那些。 */
export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export type ScreenOrientation = 'portrait' | 'landscape'

export interface ViewportMetrics {
  /** 视口宽高，CSS 像素。 */
  width: number
  height: number
  insets: SafeAreaInsets
  orientation: ScreenOrientation
  /**
   * 设备像素比。
   *
   * 渲染器要拿它算画布的实际分辨率，而性能纪律第 3 条给它封了顶（最高按 1.5 渲染）。
   * 封顶是渲染器的事，这里只报告设备真实的值。
   */
  pixelRatio: number
}

export interface SafeAreaCapability {
  /** 当前这一份快照。 */
  metrics(): ViewportMetrics
  /**
   * 快照变了就回调，返回退订函数。
   *
   * 实现要保证只在**值真的变了**的时候发：转屏期间浏览器会连着报好几次尺寸，
   * 中间还夹着 0（有些浏览器在转屏中途量不出东西），原样转发会让画面抽好几下。
   */
  onChange(listener: (metrics: ViewportMetrics) => void): () => void
  /**
   * 主指针是不是粗指针（手指）。手机平板为真，鼠标为假。
   *
   * 用它而不是判断窗口宽窄：把电脑浏览器窗口拖成竖条的人不该被弹一脸「请横屏」，
   * 而他们的指针是细的。这个值一次会话里不会变，实现可以只算一次。
   */
  isCoarsePointer(): boolean
}
