/**
 * 对话框的逻辑：开 / 关、三条关闭路径、按钮的有无。
 *
 * 「真的调了 `showModal()`」这一条值得测：它是这个组件唯一一处不显然的实现决定
 *（理由见 Dialog.tsx 的文件头），而它坏掉的表现是「弹窗跟着画布舞台一起被缩小」——
 * 只有在对局界面里才看得出来，单看组件目录页是好的。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../src/Dialog'

const noop = () => undefined

afterEach(cleanup)

function open(props: Partial<Parameters<typeof Dialog>[0]> = {}) {
  const confirm = { label: '确定离开', onSelect: noop }
  const view = render(<Dialog open title="离开对局" confirm={confirm} {...props} />)
  return { ...view, dialog: view.container.querySelector('dialog') as HTMLDialogElement }
}

describe('对话框', () => {
  it('open 为 false 时什么都不渲染', () => {
    const { container } = render(
      <Dialog open={false} title="离开对局" confirm={{ label: '确定离开', onSelect: noop }} />,
    )
    expect(container.querySelector('dialog')).toBe(null)
  })

  it('挂上去就进顶层（showModal），不是就地开着', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const show = vi.spyOn(HTMLDialogElement.prototype, 'show')
    const { dialog } = open()
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(show).not.toHaveBeenCalled()
    expect(dialog.open).toBe(true)
    showModal.mockRestore()
    show.mockRestore()
  })

  it('inline 时不进顶层（目录页那一档）', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const show = vi.spyOn(HTMLDialogElement.prototype, 'show')
    open({ inline: true })
    expect(show).toHaveBeenCalledTimes(1)
    expect(showModal).not.toHaveBeenCalled()
    showModal.mockRestore()
    show.mockRestore()
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

  it('点遮罩叫 onDismiss：点在遮罩上时事件目标就是 <dialog> 本身', () => {
    const onDismiss = vi.fn()
    const { dialog } = open({ onDismiss })
    fireEvent.click(dialog)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('点里面的内容不算点遮罩', () => {
    const onDismiss = vi.fn()
    open({ onDismiss, children: <span>正文</span> })
    fireEvent.click(screen.getByText('正文'))
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('按 Esc 叫 onDismiss，但不让浏览器自己把它关掉', () => {
    const onDismiss = vi.fn()
    const { dialog } = open({ onDismiss })
    // 原生 Esc 先发一个可取消的 cancel，组件拦下它，开关仍然由调用方的 open 说了算。
    const cancelled = fireEvent(dialog, new Event('cancel', { cancelable: true, bubbles: true }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(cancelled).toBe(false)
  })

  it('关掉再开一次还开得起来', () => {
    const confirm = { label: '确定离开', onSelect: noop }
    const view = render(<Dialog open title="离开对局" confirm={confirm} />)
    view.rerender(<Dialog open={false} title="离开对局" confirm={confirm} />)
    expect(view.container.querySelector('dialog')).toBe(null)
    view.rerender(<Dialog open title="离开对局" confirm={confirm} />)
    const again = view.container.querySelector('dialog') as HTMLDialogElement
    expect(again.open).toBe(true)
  })

  it('没给 onDismiss 时三条路都不通', () => {
    const { dialog } = open()
    // 不该抛，也不该有别的反应——这里只是确认没有默默走别的路。
    fireEvent.click(dialog)
    fireEvent(dialog, new Event('cancel', { cancelable: true, bubbles: true }))
    expect(dialog.open).toBe(true)
  })
})
