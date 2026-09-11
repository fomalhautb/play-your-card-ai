/**
 * 进度条的逻辑：百分数怎么算、超出范围和 NaN 怎么兜、无障碍属性报的是什么。
 *
 * 这几条全是「坏了也看不出来」的那种：进度条画到 100% 而画面没换、
 * 或者宽度变成 `NaN%` 被 CSS 忽略于是看着卡在原地，两种表现都像是加载本身慢，
 * 谁也不会想到去查这几行（见 ProgressBar.tsx 的文件头）。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressBar } from '../src/ProgressBar'

afterEach(cleanup)

function reported(): number {
  return Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
}

describe('素材加载进度条', () => {
  it('把 0~1 换成整数百分比', () => {
    render(<ProgressBar value={0.42} />)
    expect(reported()).toBe(42)
  })

  it('只取整不四舍五入：99.6% 不许显示成 100%', () => {
    // 显示成 100% 但画面还没换，看着像卡住了（抄旧版 LoadingScreen 的理由）。
    render(<ProgressBar value={0.996} />)
    expect(reported()).toBe(99)
  })

  it('超过 1 夹回 100', () => {
    render(<ProgressBar value={3} />)
    expect(reported()).toBe(100)
  })

  it('负数夹回 0', () => {
    render(<ProgressBar value={-1} />)
    expect(reported()).toBe(0)
  })

  it('NaN 当 0：不然宽度会变成 NaN%，CSS 直接忽略，看着像卡在原地', () => {
    render(<ProgressBar value={Number.NaN} />)
    expect(reported()).toBe(0)
  })

  it('默认不显示百分数', () => {
    render(<ProgressBar value={0.5} />)
    expect(screen.queryByText('50%')).toBeNull()
  })

  it('要百分数时摆出来', () => {
    render(<ProgressBar value={0.5} showPercent />)
    expect(screen.getByText('50%')).not.toBeNull()
  })
})
