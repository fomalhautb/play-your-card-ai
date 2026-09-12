/**
 * 设置开关的逻辑：报出去的是**翻过之后**的值、禁用时点不动、说明那行小字在不在。
 *
 * 「报翻过之后的值」这一条值得测：写反了界面上会变成「点一下没反应，点两下才动一格」，
 * 那种坏法在目录页的截图里一点都看不出来（6.8：Testing Library 只测逻辑，不测样式）。
 *
 * 组件现在是原生复选框，所以角色是 `checkbox` 而不是从前那个 `switch`。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Toggle } from '../src/Toggle'

afterEach(cleanup)

function open(props: Partial<Parameters<typeof Toggle>[0]> = {}) {
  const onChange = vi.fn()
  render(<Toggle label="关闭声音" checked={false} onChange={onChange} {...props} />)
  return { onChange, toggle: screen.getByRole('checkbox', { name: '关闭声音' }) }
}

describe('设置开关', () => {
  it('关着的时候点一下报 true', () => {
    const { onChange, toggle } = open()
    fireEvent.click(toggle)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('开着的时候点一下报 false', () => {
    const { onChange } = open({ checked: true })
    fireEvent.click(screen.getByRole('checkbox', { name: '关闭声音' }))
    expect(onChange).toHaveBeenCalledWith(false)
  })

  it('当前状态直接落在复选框上', () => {
    open({ checked: true })
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
  })

  it('禁用时点不动', () => {
    const { onChange, toggle } = open({ disabled: true })
    fireEvent.click(toggle)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('不给 hint 就不渲染那行小字', () => {
    open()
    expect(screen.queryByText('关掉画面上的弹跳和位移。')).toBeNull()
  })

  it('给了 hint 就摆出来', () => {
    open({ hint: '关掉画面上的弹跳和位移。' })
    expect(screen.getByText('关掉画面上的弹跳和位移。')).not.toBeNull()
  })
})
