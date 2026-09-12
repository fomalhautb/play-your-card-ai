/**
 * 引导层：几何那两条纯函数，加上这一层自己的几条规矩。
 *
 * 几何是这一层唯一值得测的东西——洞真的套住了目标、气泡不出屏。
 * 长什么样不在这里测（那是组件目录页截图回归的活，而 happy-dom 根本不排版）。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OverlayRect } from '../src/overlayGeometry'
import { HOLE_PADDING, holePath, inflate, TIP_WIDTH, tipPosition } from '../src/overlayGeometry'
import { TutorialOverlay } from '../src/TutorialOverlay'

afterEach(cleanup)

const STAGE = { w: 960, h: 540 }

describe('挖洞', () => {
  it('四边各放宽一圈，描边不会正压在元素边缘上', () => {
    expect(inflate({ x: 100, y: 50, w: 200, h: 80 })).toEqual({
      x: 100 - HOLE_PADDING,
      y: 50 - HOLE_PADDING,
      w: 200 + HOLE_PADDING * 2,
      h: 80 + HOLE_PADDING * 2,
    })
  })

  // 外圈和洞的绕向一样，填充规则必须是 evenodd，否则洞会被一起填上（整层纯黑）。
  it('路径是「整块减去洞」，填充规则写死 evenodd', () => {
    const path = holePath([{ x: 100, y: 50, w: 200, h: 80 }], STAGE.w, STAGE.h)
    expect(path).toBe('path(evenodd, "M0 0H960V540H0ZM100 50H300V130H100Z")')
  })

  it('几个洞就接几段子路径', () => {
    const path = holePath(
      [
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 20, w: 10, h: 10 },
      ],
      100,
      100,
    )
    expect(path).toBe('path(evenodd, "M0 0H100V100H0ZM0 0H10V10H0ZM20 20H30V30H20Z")')
  })

  // 空路径在各家浏览器里表现不一（有的当成全裁掉，整层就看不见了），所以那一档不裁。
  it('一个洞都没有时不给路径，整层照常铺满', () => {
    expect(holePath([], STAGE.w, STAGE.h)).toBeNull()
  })
})

describe('气泡落点', () => {
  it('洞在上半屏就放它下面', () => {
    const hole: OverlayRect = { x: 400, y: 60, w: 160, h: 100 }
    const tip = tipPosition([hole], STAGE, false)
    expect(tip.y).toBeGreaterThan(hole.y + hole.h)
  })

  it('洞在下半屏就放它上面', () => {
    const hole: OverlayRect = { x: 400, y: 380, w: 160, h: 100 }
    const tip = tipPosition([hole], STAGE, false)
    expect(tip.y).toBeLessThan(hole.y)
  })

  // 多一颗「下一步」时往上放要多让开它的高度，否则气泡底边会压到它指着的那个洞。
  it('带「下一步」时往上放得更高一点', () => {
    const hole: OverlayRect = { x: 400, y: 380, w: 160, h: 100 }
    const plain = tipPosition([hole], STAGE, false)
    const withNext = tipPosition([hole], STAGE, true)
    expect(withNext.y).toBeLessThan(plain.y)
  })

  it('贴边的目标不会把气泡挤出画面', () => {
    for (const hole of [
      { x: -20, y: 10, w: 80, h: 60 },
      { x: STAGE.w - 40, y: STAGE.h - 40, w: 80, h: 60 },
    ]) {
      const tip = tipPosition([hole], STAGE, true)
      expect(tip.x).toBeGreaterThanOrEqual(0)
      expect(tip.y).toBeGreaterThanOrEqual(0)
      expect(tip.x + TIP_WIDTH).toBeLessThanOrEqual(STAGE.w)
      expect(tip.y).toBeLessThanOrEqual(STAGE.h)
    }
  })

  it('一个洞都没有时摆在上方居中', () => {
    const tip = tipPosition([], STAGE, false)
    expect(tip.x).toBe((STAGE.w - TIP_WIDTH) / 2)
    expect(tip.y).toBeLessThan(STAGE.h / 2)
  })
})

describe('引导层本身', () => {
  const measure = () => []

  it('提示还没就绪时一个字都不画', () => {
    render(<TutorialOverlay instruction="这是你的手牌。" measure={measure} active={false} />)
    expect(screen.queryByText('这是你的手牌。')).toBeNull()
  })

  it('就绪之后把那句话念出来（读屏靠 role=status）', () => {
    render(<TutorialOverlay instruction="这是你的手牌。" measure={measure} active />)
    expect(screen.getByRole('status').textContent).toBe('这是你的手牌。')
  })

  // 要玩家出牌 / 等演出的那些步不传 onNext：界面照常操作，不该被一层接盘手挡住。
  it('不等点击的步骤既不画「下一步」，也不铺点击捕获层', () => {
    render(<TutorialOverlay instruction="打出那张牌。" measure={measure} active />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('等点击的步骤画一颗「下一步」，点它就往下走', () => {
    const onNext = vi.fn()
    render(
      <TutorialOverlay instruction="AI 牌会留在场上。" measure={measure} active onNext={onNext} />,
    )
    screen.getByRole('button', { name: /下一步/ }).click()
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  // 两句话说的是两件事（「现在该做什么」对「刚才那一下不行」），同时出现也不该互相顶替。
  it('被挡下那句话和常驻提示同时挂着', () => {
    render(
      <TutorialOverlay
        instruction="这次先派它。"
        measure={measure}
        active
        blockTip="先打出高亮的那张 AI 牌"
      />,
    )
    const lines = screen.getAllByRole('status').map((node) => node.textContent)
    expect(lines).toEqual(['这次先派它。', '先打出高亮的那张 AI 牌'])
  })
})
