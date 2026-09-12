// @vitest-environment happy-dom

/**
 * Electron 平台的三处覆盖（迁移第 35 条）。
 *
 * 要 DOM 环境：这一套以网页实现为底，而网页实现一建出来就会去碰 `document` 和 `navigator`。
 * 桥本身不用 Electron——它是 preload 经 `contextBridge` 挂在 `window` 上的一个**普通对象**，
 * 测试里自己摆一个同样形状的就行，这正是把桥定成纯数据加函数的好处。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShellBridge } from '../src/index'
import { createElectronPlatform } from '../src/index'

interface Harness {
  bridge: ShellBridge
  /** 模拟玩家自己按 F11 / 点窗口按钮，主进程把新状态推过来。 */
  pushFullscreen(active: boolean): void
  /** `fullscreen.set()` 被调过的参数，按顺序。 */
  readonly setCalls: readonly boolean[]
}

function mountBridge(overrides: { available?: boolean; ticket?: string | null } = {}): Harness {
  const listeners = new Set<(active: boolean) => void>()
  const setCalls: boolean[] = []
  let active = false

  const bridge: ShellBridge = {
    kind: 'electron',
    steam: {
      available: overrides.available ?? true,
      personaName: '假玩家',
      authTicket() {
        const ticket = overrides.ticket === undefined ? 'deadbeef' : overrides.ticket
        return ticket === null ? Promise.reject(new Error('Steam 没在跑')) : Promise.resolve(ticket)
      },
    },
    fullscreen: {
      isActive: () => active,
      set(next) {
        setCalls.push(next)
        active = next
        return Promise.resolve(next)
      },
      onChange(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }

  Object.assign(window, { aiDuelShell: bridge })
  return {
    bridge,
    pushFullscreen(next) {
      active = next
      for (const listener of [...listeners]) listener(next)
    },
    setCalls,
  }
}

afterEach(() => {
  // 桥挂在全局上，不摘掉的话下一个用例会捡到上一个的那座。
  Object.assign(window, { aiDuelShell: undefined })
  vi.restoreAllMocks()
})

describe('桥不在的时候', () => {
  it('退回纯网页实现，steam 那一项是 undefined', () => {
    const platform = createElectronPlatform()
    expect(platform.steam).toBeUndefined()
    // 网页实现在 happy-dom 里问得到 document.fullscreenEnabled（它是 false），
    // 而 Electron 实现恒为 true——用这一项分得出走的是哪一条。
    expect(platform.fullscreen.isSupported()).toBe(false)
  })

  it('挂着的不是 electron 那座桥也不认', () => {
    Object.assign(window, { aiDuelShell: { kind: 'capacitor' } })
    expect(createElectronPlatform().steam).toBeUndefined()
  })
})

describe('全屏走窗口', () => {
  it('进全屏调的是桥，不是 document.requestFullscreen', async () => {
    const harness = mountBridge()
    // happy-dom 没实现 requestFullscreen，自己摆一个：要验的是它**没有**被调到。
    const request = vi.fn(() => Promise.resolve())
    Object.assign(document.documentElement, { requestFullscreen: request })
    const platform = createElectronPlatform()

    expect(platform.fullscreen.isSupported()).toBe(true)
    expect(await platform.fullscreen.enterLandscape()).toBe(true)
    expect(harness.setCalls).toEqual([true])
    expect(request).not.toHaveBeenCalled()
    expect(platform.fullscreen.isActive()).toBe(true)

    await platform.fullscreen.exit()
    expect(harness.setCalls).toEqual([true, false])
  })

  it('玩家自己按 F11 时也报得出来', () => {
    const harness = mountBridge()
    const platform = createElectronPlatform()
    const seen: boolean[] = []
    const stop = platform.fullscreen.onChange((value) => seen.push(value))

    harness.pushFullscreen(true)
    stop()
    harness.pushFullscreen(false)

    // 退订之后那一次不该再收到——桥上的退订函数要真的管用。
    expect(seen).toEqual([true])
  })

  it('桥那边失败只返回 false，不抛错', async () => {
    const harness = mountBridge()
    // 全屏是锦上添花：窗口已经关了这种情况不该让调用方那一步流程断掉。
    harness.bridge.fullscreen.set = () => Promise.reject(new Error('窗口已经关了'))
    const platform = createElectronPlatform()

    expect(await platform.fullscreen.enterLandscape()).toBe(false)
    await expect(platform.fullscreen.exit()).resolves.toBeUndefined()
  })

  it('桌面上没有方向锁，也不该再劝玩家进全屏', () => {
    mountBridge()
    const platform = createElectronPlatform()
    expect(platform.fullscreen.canLockOrientation()).toBe(false)
    expect(platform.fullscreen.isStandalone()).toBe(true)
  })
})

describe('触感', () => {
  it('说自己不支持，调了也什么都不做', () => {
    mountBridge()
    const vibrate = vi.fn()
    Object.assign(navigator, { vibrate })
    const platform = createElectronPlatform()

    expect(platform.haptics.isSupported()).toBe(false)
    platform.haptics.impact('heavy')
    platform.haptics.selection()
    platform.haptics.notification('error')
    // 关键是这一条：Chromium 里 navigator.vibrate 是**在**的，沿用网页实现会调到它。
    expect(vibrate).not.toHaveBeenCalled()
  })
})

describe('Steam', () => {
  it('票据每次现取，不缓存', async () => {
    mountBridge()
    const platform = createElectronPlatform()
    expect(platform.steam?.isAvailable()).toBe(true)
    expect(platform.steam?.personaName()).toBe('假玩家')
    expect(await platform.steam?.authTicket()).toBe('deadbeef')
  })

  it('Steam 没在跑时 isAvailable 是 false，取票据会失败', async () => {
    mountBridge({ available: false, ticket: null })
    const platform = createElectronPlatform()
    expect(platform.steam?.isAvailable()).toBe(false)
    await expect(platform.steam?.authTicket()).rejects.toThrow('Steam 没在跑')
  })
})
