/**
 * 纸面输入框的逻辑：按码点截断、回车和 Esc 那两条快捷键、挂上去抢焦点。
 *
 * 截断那一条值得测：它是这个组件唯一一处不显然的实现决定（见 TextField.tsx 的文件头），
 * 而它坏掉的表现是「打一个 emoji 变成两个乱码方框」——只有真打字才看得出来。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextField } from '../src/TextField'

const noop = () => undefined

afterEach(cleanup)

function open(props: Partial<Parameters<typeof TextField>[0]> = {}) {
  const onChange = vi.fn()
  render(<TextField value="" label="牌组名" onChange={onChange} {...props} />)
  return { onChange, input: screen.getByLabelText('牌组名') as HTMLInputElement }
}

describe('纸面输入框', () => {
  it('把改动原样报出去', () => {
    const { onChange, input } = open()
    fireEvent.change(input, { target: { value: '低费流' } })
    expect(onChange).toHaveBeenCalledWith('低费流')
  })

  it('超过上限的部分打不进去', () => {
    const { onChange, input } = open({ maxLength: 3 })
    fireEvent.change(input, { target: { value: '一二三四五' } })
    expect(onChange).toHaveBeenCalledWith('一二三')
  })

  it('按码点截断：emoji 算一个字，不会被切成半个乱码', () => {
    const { onChange, input } = open({ maxLength: 2 })
    // 「🀄」在 JS 里占两个 UTF-16 码元，按 slice 截会只剩半个代理对。
    fireEvent.change(input, { target: { value: '🀄🎴🃏' } })
    expect(onChange).toHaveBeenCalledWith('🀄🎴')
  })

  it('回车报 onSubmit，Esc 报 onCancel', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const { input } = open({ onSubmit, onCancel })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('别的键不会误触那两条', () => {
    const onSubmit = vi.fn()
    const onCancel = vi.fn()
    const { input } = open({ onSubmit, onCancel })
    fireEvent.keyDown(input, { key: 'a' })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('autoFocus 时挂上去就抢焦点，光标停在末尾', () => {
    render(<TextField value="低费流" label="改名" onChange={noop} autoFocus />)
    const input = screen.getByLabelText('改名') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe('低费流'.length)
  })

  it('不传 autoFocus 就不抢：别的地方的焦点不该被它偷走', () => {
    const { input } = open()
    expect(document.activeElement).not.toBe(input)
  })
})
