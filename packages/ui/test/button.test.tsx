/**
 * 按钮的逻辑：点得动 / 点不动，以及默认不是提交键。
 *
 * 只测逻辑，不测样子：长什么样归组件目录页的截图回归（6.8）。
 * 从前这里还断言「目录页那两档瞬态写进了 data-state」，正式版简化第 3 步
 * 把那套摆态连同样式一起删了。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/Button'

afterEach(cleanup)

describe('按钮', () => {
  it('点一下叫一次 onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>开始游戏</Button>)
    screen.getByRole('button', { name: '开始游戏' }).click()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('禁用时点不动', () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        开始游戏
      </Button>,
    )
    const button = screen.getByRole('button', { name: '开始游戏' })
    expect(button.hasAttribute('disabled')).toBe(true)
    button.click()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('默认不是提交键', () => {
    // 不显式写 type 的 <button> 在表单里默认是 submit，会把整个表单提交掉。
    render(<Button>开始游戏</Button>)
    expect(screen.getByRole('button', { name: '开始游戏' }).getAttribute('type')).toBe('button')
  })
})
