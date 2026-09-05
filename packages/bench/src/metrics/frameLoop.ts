/**
 * 包一层 requestAnimationFrame，用来验证 6.9 表的「空闲时帧循环」。
 *
 * 手动时钟下把 rAF 直接掐掉：契约说好 manualClock 时场景不注册任何真实时间源，
 * 但 gsap 和 Pixi 的 ticker 只要有人碰到就会自己起 rAF 循环。掐掉之后
 * 「有东西在偷偷动」不再是靠计数猜，而是根本推不动——剧本外的任何动画都会停住。
 *
 * 时间指标那一组走真实时钟（manualClock: false），这时只数不拦。
 */

export interface FrameLoopHandle {
  /** 从安装以来 rAF 被调用了多少次。 */
  requests(): number
  /** 手动时钟：true 时 rAF 只记数、不排期。 */
  setBlocking(blocking: boolean): void
  uninstall(): void
}

let installed: FrameLoopHandle | null = null

export function installFrameLoopCounter(): FrameLoopHandle {
  if (installed) return installed

  const originalRequest = window.requestAnimationFrame.bind(window)
  const originalCancel = window.cancelAnimationFrame.bind(window)
  let requests = 0
  let blocking = false
  // 被拦下来的请求也要给一个句柄，否则调用方拿到 undefined，
  // 之后 cancelAnimationFrame(undefined) 在有些实现里会抛。负数不会和真句柄撞。
  let fakeHandle = -1

  window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    requests += 1
    if (blocking) {
      fakeHandle -= 1
      return fakeHandle
    }
    return originalRequest(callback)
  }
  window.cancelAnimationFrame = (handle: number): void => {
    if (handle < 0) return
    originalCancel(handle)
  }

  installed = {
    requests: () => requests,
    setBlocking: (value: boolean) => {
      blocking = value
    },
    uninstall: () => {
      window.requestAnimationFrame = originalRequest
      window.cancelAnimationFrame = originalCancel
      installed = null
    },
  }
  return installed
}
