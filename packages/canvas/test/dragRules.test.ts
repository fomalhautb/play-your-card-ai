/**
 * 拖拽出牌判定的单元测试。
 *
 * 只测纯函数那一半：走多远算起拖、松手算不算打出。有状态的另一半（指针捕获、跟随、
 * 姿态切换）要真的 WebGL 上下文，那部分归 6.6 的截图回归和交互测试管，不在这里测。
 *
 * 挑的都是**边界**：阈值上下各一档、方向锁两侧、区域的四条边。
 * 中间地带过了不说明什么，边界挪了一格才是玩家能感觉到的手感变化。
 */

import { describe, expect, it } from 'vitest'
import {
  DRAG_THRESHOLD,
  type DropZoneRect,
  dragGestureOf,
  pointInZone,
  resolveDrop,
  TOUCH_DRAG_THRESHOLD,
  TOUCH_HOLD_TOLERANCE,
  TOUCH_SCROLL_SLOP,
} from '../src/interaction/dragRules'

describe('dragGestureOf：走多远算起拖', () => {
  it('鼠标：差一点点不算，正好到阈值就算', () => {
    expect(dragGestureOf({ dx: DRAG_THRESHOLD - 0.01, dy: 0, scrollGuard: false })).toBe('idle')
    expect(dragGestureOf({ dx: DRAG_THRESHOLD, dy: 0, scrollGuard: false })).toBe('drag')
  })

  it('鼠标：任意方向都算，判的是直线距离不是某个轴', () => {
    // 3-4-5 直角三角形，斜边正好 5 > 4。
    expect(dragGestureOf({ dx: 3, dy: 4, scrollGuard: false })).toBe('drag')
    expect(dragGestureOf({ dx: 0, dy: -DRAG_THRESHOLD, scrollGuard: false })).toBe('drag')
  })

  it('滚动优先：竖向先跑出去就判成滚动，让滚列表赢在前面', () => {
    expect(dragGestureOf({ dx: 0, dy: TOUCH_SCROLL_SLOP, scrollGuard: true })).toBe('scroll')
    expect(dragGestureOf({ dx: 0, dy: -TOUCH_SCROLL_SLOP, scrollGuard: true })).toBe('scroll')
  })

  it('滚动优先：横向要够长**而且**压过竖向才算起拖', () => {
    expect(dragGestureOf({ dx: TOUCH_DRAG_THRESHOLD, dy: 0, scrollGuard: true })).toBe('drag')
    // 横向够长，但竖向也跑到了滚动阈值：45° 那种斜线要判给滚动，不能把牌抓起来。
    expect(
      dragGestureOf({ dx: TOUCH_DRAG_THRESHOLD, dy: TOUCH_DRAG_THRESHOLD, scrollGuard: true }),
    ).toBe('scroll')
  })

  it('滚动优先：两条线之间那段谁都不算，继续等', () => {
    expect(dragGestureOf({ dx: TOUCH_DRAG_THRESHOLD - 1, dy: 0, scrollGuard: true })).toBe('idle')
    expect(dragGestureOf({ dx: 0, dy: TOUCH_SCROLL_SLOP - 1, scrollGuard: true })).toBe('idle')
  })

  it('鼠标那 4px 在触屏上根本不算一次动作', () => {
    expect(dragGestureOf({ dx: DRAG_THRESHOLD, dy: 0, scrollGuard: true })).toBe('idle')
  })
})

const ZONE: DropZoneRect = { x: 100, y: 50, width: 200, height: 120 }

describe('pointInZone：指针在不在出牌区里', () => {
  it('四条边都算在里面', () => {
    expect(pointInZone(100, 50, ZONE)).toBe(true)
    expect(pointInZone(300, 170, ZONE)).toBe(true)
  })

  it('差一像素就在外面', () => {
    expect(pointInZone(99.9, 100, ZONE)).toBe(false)
    expect(pointInZone(300.1, 100, ZONE)).toBe(false)
    expect(pointInZone(200, 49.9, ZONE)).toBe(false)
    expect(pointInZone(200, 170.1, ZONE)).toBe(false)
  })

  it('没有出牌区、或者出牌区还没布局出来时一切落点都不成立', () => {
    expect(pointInZone(200, 100, null)).toBe(false)
    expect(pointInZone(0, 0, { x: 0, y: 0, width: 0, height: 0 })).toBe(false)
  })
})

describe('resolveDrop：松手之后怎么办', () => {
  const base = { zone: ZONE, dragging: true, enabled: true, moved: 100, scrollGuard: false }

  it('拖进出牌区松手就是打出', () => {
    expect(resolveDrop({ ...base, pointerX: 200, pointerY: 100 })).toBe('play')
  })

  it('落在别处就回弹', () => {
    expect(resolveDrop({ ...base, pointerX: 200, pointerY: 400 })).toBe('return')
  })

  it('拖到一半被关掉出牌权限的话，松在哪儿都按取消算', () => {
    expect(resolveDrop({ ...base, pointerX: 200, pointerY: 100, enabled: false })).toBe('return')
  })

  it('没起拖就是原地点了一下', () => {
    expect(resolveDrop({ ...base, pointerX: 200, pointerY: 400, dragging: false, moved: 1 })).toBe(
      'tap',
    )
  })

  it('锁着的时候连点一下都不算，不然会绕过出牌权限', () => {
    const locked = { ...base, pointerX: 200, pointerY: 400, dragging: false, moved: 1 }
    expect(resolveDrop({ ...locked, enabled: false })).toBe('return')
  })

  it('滚动优先下斜着划了一大段不算点击：那不是"点了一下"', () => {
    const swipe = {
      ...base,
      pointerX: 200,
      pointerY: 400,
      dragging: false,
      scrollGuard: true,
      moved: TOUCH_HOLD_TOLERANCE + 1,
    }
    expect(resolveDrop(swipe)).toBe('return')
    expect(resolveDrop({ ...swipe, moved: TOUCH_HOLD_TOLERANCE })).toBe('tap')
  })
})
