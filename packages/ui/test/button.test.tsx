/**
 * 按钮 A 的逻辑：点得动 / 点不动，以及目录页那两档瞬态确实落到了 DOM 上。
 *
 * 只测逻辑，不测样子：长什么样归组件目录页的截图回归（6.8）。
 * 这里断言 `data-state` 有没有写上去，是因为「悬停」「按下」两条 story 全靠它——
 * 那个属性没写出来的话，目录页拍到的两张会和普通态一模一样，而基线比对也发现不了。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/Button'

afterEach(cleanup)

describe('按钮 A', () => {
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

  it('没传 state 时 data-state 整个不出现', () => {
    // 属性存在但为空串的话 CSS 的 `[data-state]` 照样命中，普通态会被当成悬停态。
    render(<Button>开始游戏</Button>)
    expect(screen.getByRole('button', { name: '开始游戏' }).hasAttribute('data-state')).toBe(false)
  })

  it('state 摆成哪一档就写到 data-state 上', () => {
    render(<Button state="pressed">开始游戏</Button>)
    expect(screen.getByRole('button', { name: '开始游戏' }).getAttribute('data-state')).toBe(
      'pressed',
    )
  })
})
