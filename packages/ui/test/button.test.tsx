/**
 * 方块按钮的逻辑：点得动 / 点不动、默认不是提交键、开关语义。
 *
 * 只测逻辑，不测样子：长什么样归组件目录页的截图回归（6.8）。
 * 从前这里还断言「目录页那两档瞬态写进了 data-state」，正式版简化第 3 步
 * 把那套摆态连同样式一起删了。
 *
 * 后两条是从原来的 `sealButton.test.tsx` 并过来的（那个组件已经合进这里）。
 * 「开关类的传 `pressed`，不是开关的不传」值得测：它决定读屏软件把这颗钮读成
 * 「已按下的切换钮」还是「普通按钮」，而静音和「进全屏」这两种用法看着一样、意思不同。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/Button'

afterEach(cleanup)

describe('方块按钮', () => {
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

  it('传了 pressed 就报成开关态', () => {
    render(<Button pressed>打开声音</Button>)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('不传 pressed 就是普通按钮，不该冒出一个开关语义', () => {
    render(<Button>进入全屏</Button>)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBeNull()
  })
})
