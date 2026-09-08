/**
 * 全屏能力的网页实现。整套特性检测和降级从 legacy-client/src/ui/fullscreen.ts 搬过来。
 *
 * 一律走特性检测，不判 UA：安卓那边内核碎片化（各家浏览器、微信 XWeb），
 * 能不能用只有真机说了算；iOS 上不管壳是 Safari 还是 Chrome，底下都是同一个 WebKit。
 */

import type { FullscreenCapability } from '../fullscreen'

/** iPad Safari 16.4 之前只有带 webkit 前缀的那套，标准类型里没有，自己补上。 */
interface PrefixedElement extends HTMLElement {
  webkitRequestFullscreen?: (options?: FullscreenOptions) => Promise<void> | void
}

interface PrefixedDocument extends Document {
  webkitFullscreenEnabled?: boolean
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

export function createWebFullscreen(): FullscreenCapability {
  return {
    isSupported,
    canLockOrientation,
    isActive,
    onChange(listener) {
      const handler = (): void => listener(isActive())
      // 两个事件名都接：老 WebKit 只发带前缀的那个。
      document.addEventListener('fullscreenchange', handler)
      document.addEventListener('webkitfullscreenchange', handler)
      return () => {
        document.removeEventListener('fullscreenchange', handler)
        document.removeEventListener('webkitfullscreenchange', handler)
      }
    },
    enterLandscape,
    async exit() {
      const doc = document as PrefixedDocument
      try {
        await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.())
      } catch {
        // 已经不在全屏里、或者浏览器不让退，都不是调用方能处理的事。
      }
    },
    isStandalone,
  }
}

/**
 * 能不能把整页变全屏。
 *
 * 除了看方法在不在，还要看 fullscreenEnabled：它同时反映「浏览器支持」和
 * 「当前文档被允许全屏」（比如被别人 iframe 进去又没给 allow="fullscreen"）。
 * iPhone Safari 上这个值是 false，正是要的那条分叉。
 */
function isSupported(): boolean {
  const doc = document as PrefixedDocument
  if (!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled)) return false
  const root = document.documentElement as PrefixedElement
  return (
    typeof root.requestFullscreen === 'function' ||
    typeof root.webkitRequestFullscreen === 'function'
  )
}

/**
 * 方法在不在。
 *
 * 存在不等于调用会成功：桌面 Chrome 上它也在，但不在全屏里调用直接 reject。
 * 所以这只是「值不值得把按钮显示出来」的判据。
 */
function canLockOrientation(): boolean {
  return typeof screen !== 'undefined' && typeof screen.orientation?.lock === 'function'
}

/**
 * 判的是「有没有元素处于全屏」，不是「是不是我们这一层进的全屏」：
 * 玩家可能已经按过浏览器自己的全屏入口，那时不该再劝一遍。
 */
function isActive(): boolean {
  const doc = document as PrefixedDocument
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null
}

async function enterLandscape(): Promise<boolean> {
  const root = document.documentElement as PrefixedElement
  const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root)
  if (request === undefined) return false

  try {
    // navigationUI: 'hide' 是「连浏览器自己的导航条也一起藏掉」的请求，浏览器可以不听；
    // 带前缀的老实现不认参数，多传一个也无害。
    await request({ navigationUI: 'hide' })
  } catch {
    // 进不去全屏，锁横屏也就无从谈起。
    return false
  }

  try {
    await screen.orientation?.lock?.('landscape')
  } catch {
    // 锁不上就算了：起码已经进了全屏，画面大了一圈，玩家仍然可以自己转手机。
    // 也不用管解锁——退出全屏时浏览器会把方向锁一并解掉。
  }
  return true
}

/**
 * 两条判据分别对应两个平台：display-mode 是标准写法，安卓认，iOS 16.4 起也认；
 * navigator.standalone 是 iOS 自己的老字段，老版本 iOS 上只有它。
 */
function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  if (nav.standalone === true) return true
  if (typeof window.matchMedia !== 'function') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches
  )
}
