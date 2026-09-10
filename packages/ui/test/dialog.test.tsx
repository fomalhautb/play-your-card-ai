/**
 * 弹窗 A 的逻辑：三条关闭路径、按钮的有无，以及「传送到 body」这件事真的发生了。
 *
 * 传送那一条值得测：它是这个组件唯一一处不显然的实现决定（理由见 Dialog.tsx 的文件头），
 * 而它坏掉的表现是「弹窗跟着舞台一起被缩小」——只有在对局界面里才看得出来，
 * 单看组件目录页是好的。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../src/Dialog'

const noop = () => undefined

afterEach(cleanup)

function open(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const confirm = { label: '确定离开', onSelect: noop }
  return render(<Dialog open title="离开对局" confirm={confirm} {...props} />)
}

describe('弹窗 A', () => {
  it('open 为 false 时什么都不渲染', () => {
    open({ open: false })
    expect(screen.queryByRole('dialog')).toBe(null)
  })

  it('传送到 body，不留在原来那棵子树里', () => {
    const { container } = open()
    expect(screen.getByRole('dialog')).not.toBe(null)
    // container 是 Testing Library 给的挂载点，弹窗要是没传送出去就会长在它里面。
    expect(container.querySelector('.ui-dialog')).toBe(null)
  })

  it('inline 时就地渲染（目录页那一档）', () => {
    const { container } = open({ inline: true })
    expect(container.querySelector('.ui-dialog')).not.toBe(null)
  })

  it('点确认叫 confirm.onSelect', () => {
    const onSelect = vi.fn()
    open({ confirm: { label: '确定离开', onSelect } })
    screen.getByRole('button', { name: '确定离开' }).click()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('没给取消就不画那颗按钮', () => {
    open()
    expect(screen.queryByRole('button', { name: '再想想' })).toBe(null)
  })

  it('点遮罩叫 onDismiss', () => {
    const onDismiss = vi.fn()
    open({ onDismiss })
    screen.getByRole('button', { name: '关闭对话框' }).click()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('没给 onDismiss 就连遮罩热区都不画', () => {
    open()
    expect(screen.queryByRole('button', { name: '关闭对话框' })).toBe(null)
  })

  it('按 Esc 叫 onDismiss', () => {
    const onDismiss = vi.fn()
    open({ onDismiss })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('关掉之后 Esc 不再有反应', () => {
    const onDismiss = vi.fn()
    const view = open({ onDismiss })
    view.rerender(
      <Dialog
        open={false}
        title="离开对局"
        confirm={{ label: '确定离开', onSelect: noop }}
        onDismiss={onDismiss}
      />,
    )
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('正文不给就整块不渲染', () => {
    open()
    expect(document.querySelector('.ui-dialog__body')).toBe(null)
  })
})
