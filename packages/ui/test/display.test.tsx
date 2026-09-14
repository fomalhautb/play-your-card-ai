/**
 * 三个「只负责画、没有交互」的组件的逻辑：`Sheet`、`Veil`、`Notice`。
 *
 * 合成一个文件是因为每个都只有两三条值得测的分支，各开一个文件的话每份里
 * 一半篇幅是 import 和 `afterEach`。测的都是**逻辑**：哪些东西该出现、
 * 读屏软件听到的是什么，不测样式（6.8，而且 happy-dom 根本不排版）。
 *
 * `Icon` 那一组跟着组件一起删了（正式版简化第 3 步）。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Notice } from '../src/Notice'
import { Sheet } from '../src/Sheet'
import { Veil } from '../src/Veil'

afterEach(cleanup)

describe('结算底板', () => {
  it('标题和内容都摆出来', () => {
    render(
      <Sheet title="你赢了">
        <p>最终比分 3 : 1</p>
      </Sheet>,
    )
    expect(screen.getByRole('heading', { name: '你赢了' })).not.toBeNull()
    expect(screen.getByText('最终比分 3 : 1')).not.toBeNull()
  })

  it('不给内容也是一块完整的板', () => {
    render(<Sheet title="平局" />)
    expect(screen.getByRole('heading', { name: '平局' })).not.toBeNull()
  })
})

describe('结算暗幕', () => {
  it('内容原样压在幕上', () => {
    render(
      <Veil>
        <p>盖在上面的东西</p>
      </Veil>,
    )
    expect(screen.getByText('盖在上面的东西')).not.toBeNull()
  })

  it('整层没有任何可点的东西：这一局已经打完了，点哪儿都不该退', () => {
    const { container } = render(
      <Veil>
        <p>结算</p>
      </Veil>,
    )
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('提示行', () => {
  it('默认是错误那一档，用 alert 让读屏软件当场念出来', () => {
    render(<Notice>连不上账号服务</Notice>)
    expect(screen.getByRole('alert').textContent).toBe('连不上账号服务')
  })

  it('其余两档用 status：等读完手头的再念，别打断玩家', () => {
    render(<Notice tone="ok">存档已经清空</Notice>)
    expect(screen.getByRole('status').textContent).toBe('存档已经清空')
  })

  it('补充说明那一档也是 status', () => {
    render(<Notice tone="info">绑定账号还没做好</Notice>)
    expect(screen.getByRole('status')).not.toBeNull()
  })
})
