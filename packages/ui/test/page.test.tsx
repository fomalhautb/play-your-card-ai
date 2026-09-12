/**
 * 文字页外壳的逻辑：返回钮出不出现、点了叫谁、右上角那一簇摆不摆。
 *
 * 值得测的是「不给 `onBack` 就整颗不渲染」：设置、账号、关于三页都靠这颗钮回首页，
 * 它是这几页唯一的出口。渲染成一颗点了没反应的钮比不渲染更糟——玩家会以为页面卡了。
 *
 * 版式（标题在不在正中、正文栏多宽）不在这里测：那是组件目录页截图回归的活（6.8），
 * 而 happy-dom 根本不排版，量出来的尺寸全是 0。
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Page } from '../src/Page'

afterEach(cleanup)

describe('文字页外壳', () => {
  it('标题作为一级标题摆出来', () => {
    render(<Page title="开发者信息">正文</Page>)
    expect(screen.getByRole('heading', { level: 1, name: '开发者信息' })).not.toBeNull()
  })

  it('正文原样渲染', () => {
    render(<Page title="设置">这里是正文</Page>)
    expect(screen.getByText('这里是正文')).not.toBeNull()
  })

  it('给了 onBack 就有返回钮，点了叫它', () => {
    const onBack = vi.fn()
    render(
      <Page title="设置" onBack={onBack}>
        正文
      </Page>,
    )
    fireEvent.click(screen.getByRole('button', { name: /返回/ }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('不给 onBack 就整颗不渲染，不留一颗点了没反应的钮', () => {
    render(<Page title="设置">正文</Page>)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('返回钮的名字可以换：多步流程里那颗可以写成「跳过」', () => {
    render(
      <Page title="设置" onBack={() => undefined} backLabel="跳过">
        正文
      </Page>,
    )
    expect(screen.getByRole('button', { name: '跳过' })).not.toBeNull()
  })

  it('右上角那一簇原样摆出来', () => {
    render(
      <Page title="开发者信息" actions={<button type="button">静音</button>}>
        正文
      </Page>,
    )
    expect(screen.getByRole('button', { name: '静音' })).not.toBeNull()
  })
})
