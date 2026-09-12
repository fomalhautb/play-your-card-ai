/**
 * 安全区与视口能力的网页实现。
 *
 * 两处不显然的做法，都是旧代码踩出来的：
 *
 * 1. **视口尺寸用 JS 现量，不用 dvh 那类动态视口单位。**
 *    安卓 Chrome 上「进全屏 + 锁横屏」是两步，中间浏览器会连着改好几次视口尺寸，
 *    而动态视口单位是攒着更新的，有时最后一次排版用的还是收起地址栏之前的高度，
 *    画面底下就露出一条没画到的黑边（见黑客松版的 src/ui/viewportVars.ts）。
 * 2. **转屏和进出全屏之后连着复查一段时间。**
 *    那几帧里尺寸还在抖，resize 事件也不保证在最后一次尺寸变化时补发一遍，
 *    只听事件会停在中途那个尺寸上。
 *
 * 安全区的数从一个隐藏探针元素上量：CSS 的 env(safe-area-inset-*) 只能用在样式里，
 * 而正式版画面在画布上，得有个办法把它读成数字。不支持 env() 的浏览器上那条 padding
 * 声明会被整条丢掉，量出来就是 0——正好是「没有刘海」该有的值。
 */

import { createSignal } from '../listeners'
import type {
  SafeAreaCapability,
  SafeAreaInsets,
  ScreenOrientation,
  ViewportMetrics,
} from '../safeArea'

/**
 * 转屏 / 进出全屏之后继续复查的时长。
 * 一秒多足够覆盖转屏动画，又不会长到白烧电。
 */
const SETTLE_MS = 1200

const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }

export function createWebSafeArea(): SafeAreaCapability {
  const changed = createSignal<ViewportMetrics>()
  /** 上一次报出去的快照。只有和它不一样才会再报一次。 */
  let last: ViewportMetrics | null = null
  let settleUntil = 0
  let settleFrame = 0
  /** 现在有几个人在听。没人听就不往 window 上挂监听，也不跑复查循环。 */
  let subscribers = 0

  function refresh(): void {
    const next = read()
    // 有些浏览器在转屏中途会把宽高报成 0，照单全收的话画面会塌掉一帧。
    if (next.width === 0 || next.height === 0) return
    if (last !== null && sameMetrics(last, next)) return
    last = next
    changed.emit(next)
  }

  function tick(): void {
    refresh()
    if (performance.now() >= settleUntil) {
      settleFrame = 0
      return
    }
    settleFrame = requestAnimationFrame(tick)
  }

  /** 开始（或续上）一轮复查。重复调用只是把截止时间往后推，不会开出第二条循环。 */
  function resettle(): void {
    refresh()
    settleUntil = performance.now() + SETTLE_MS
    if (settleFrame === 0) settleFrame = requestAnimationFrame(tick)
  }

  return {
    metrics() {
      const next = read()
      if (next.width === 0 || next.height === 0) return last ?? next
      last = next
      return next
    },

    onChange(listener) {
      const off = changed.add(listener)
      subscribers += 1
      if (subscribers === 1) {
        last = read()
        window.addEventListener('resize', refresh)
        // 转屏和进出全屏之后尺寸还会再抖几帧，所以这两条要走复查循环。
        window.addEventListener('orientationchange', resettle)
        document.addEventListener('fullscreenchange', resettle)
        document.addEventListener('webkitfullscreenchange', resettle)
      }
      return () => {
        off()
        subscribers -= 1
        if (subscribers > 0) return
        window.removeEventListener('resize', refresh)
        window.removeEventListener('orientationchange', resettle)
        document.removeEventListener('fullscreenchange', resettle)
        document.removeEventListener('webkitfullscreenchange', resettle)
        if (settleFrame !== 0) {
          cancelAnimationFrame(settleFrame)
          settleFrame = 0
        }
      }
    },

    isCoarsePointer,
  }
}

function read(): ViewportMetrics {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    insets: readInsets(),
    orientation: readOrientation(),
    pixelRatio: window.devicePixelRatio || 1,
  }
}

function readOrientation(): ScreenOrientation {
  // 用媒体查询而不是自己比较宽高：地址栏伸缩、分屏、软键盘顶上来这些情况浏览器都算过了。
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape'
  }
  return window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
}

function isCoarsePointer(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

/** 量安全区用的隐藏元素。只建一个，一直留在文档里。 */
let probe: HTMLElement | null = null

function probeElement(): HTMLElement | null {
  // isConnected 一起判：测试里每个文件都是新的一份文档，上一份留下的探针量不出东西。
  if (probe?.isConnected) return probe
  const parent = document.body ?? document.documentElement
  if (parent === null) return null
  const element = document.createElement('div')
  /*
   * 不占位、不吃事件、不可见，只为了让浏览器把 env() 算出来给我们读。
   *
   * 每条都是 `max(env(...), var(--safe-area-inset-*, 0px))`，两个来源取大的那个：
   * - `env()` 是标准写法，浏览器和 iOS 的 WKWebView（配 viewport-fit=cover）报得准；
   * - `--safe-area-inset-*` 是 Capacitor 在**安卓**上注入的一组变量
   *   （`plugins.SystemBars.insetsHandling: 'css'`，默认开着）。安卓 WebView 的 env()
   *   在边到边模式下会报 0，那时刘海和底部手势条就没人让位了。
   * 取大的：哪一边量不出来都是 0，不会把另一边压下去。`var()` 的默认值写成 0px 是必须的
   * ——变量没定义时整条 max() 会失效，连带整条 padding 声明被丢掉。
   */
  element.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:max(env(safe-area-inset-top),var(--safe-area-inset-top,0px)) ' +
    'max(env(safe-area-inset-right),var(--safe-area-inset-right,0px)) ' +
    'max(env(safe-area-inset-bottom),var(--safe-area-inset-bottom,0px)) ' +
    'max(env(safe-area-inset-left),var(--safe-area-inset-left,0px));'
  parent.appendChild(element)
  probe = element
  return element
}

function readInsets(): SafeAreaInsets {
  const element = probeElement()
  if (element === null) return NO_INSETS
  const style = getComputedStyle(element)
  return {
    top: pixels(style.paddingTop),
    right: pixels(style.paddingRight),
    bottom: pixels(style.paddingBottom),
    left: pixels(style.paddingLeft),
  }
}

/** 计算样式里的长度都是 "12px" 这种形状；量不出来（空串、不支持 env()）一律当 0。 */
function pixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function sameMetrics(a: ViewportMetrics, b: ViewportMetrics): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.orientation === b.orientation &&
    a.pixelRatio === b.pixelRatio &&
    a.insets.top === b.insets.top &&
    a.insets.right === b.insets.right &&
    a.insets.bottom === b.insets.bottom &&
    a.insets.left === b.insets.left
  )
}
