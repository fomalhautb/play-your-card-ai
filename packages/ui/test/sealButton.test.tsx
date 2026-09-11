/**
 * 夜色圆章图标钮的逻辑：点得动 / 点不动、开关语义、名字从哪儿来。
 *
 * 「开关类的传 `pressed`，不是开关的不传」这一条值得测：它决定读屏软件把这颗钮读成
 * 「已按下的切换钮」还是「普通按钮」，而静音钮和全屏入口长得一模一样、意思完全不同。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SealButton } from '../src/SealButton'

afterEach(cleanup)

describe('夜色圆章图标钮', () => {
  it('点了叫 onClick', () => {
    const onClick = vi.fn()
    render(<SealButton icon="unmuted" label="关闭声音" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭声音' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('禁用时点不动', () => {
    const onClick = vi.fn()
    render(<SealButton icon="unmuted" label="关闭声音" onClick={onClick} disabled />)
    fireEvent.click(screen.getByRole('button', { name: '关闭声音' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('传了 pressed 就报成开关态', () => {
    render(<SealButton icon="muted" label="打开声音" pressed />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('不传 pressed 就是普通按钮，不该冒出一个开关语义', () => {
    render(<SealButton icon="fullscreen" label="进入全屏" />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBeNull()
  })

  it('剪影按直径的一半画，整颗缩放时里面那枚跟着缩', () => {
    const { container } = render(<SealButton icon="unmuted" label="关闭声音" size={52} />)
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('26')
  })
})
