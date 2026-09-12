/**
 * 四个「只负责画、没有交互」的组件的逻辑：`Sheet`、`Veil`、`Notice`、`CardLoader`、`Icon`。
 *
 * 合成一个文件是因为每个都只有两三条值得测的分支，各开一个文件的话每份里
 * 一半篇幅是 import 和 `afterEach`。测的都是**逻辑**：哪些东西该出现、
 * 读屏软件听到的是什么，不测样式（6.8，而且 happy-dom 根本不排版）。
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CardLoader } from '../src/CardLoader'
import { Icon } from '../src/Icon'
import { Notice } from '../src/Notice'
import { Sheet } from '../src/Sheet'
import { Veil } from '../src/Veil'

afterEach(cleanup)

describe('羊皮纸结算底板', () => {
  it('标题和内容都摆出来', () => {
    render(
      <Sheet title="你赢了">
        <p>最终比分 3 : 1</p>
      </Sheet>,
    )
    expect(screen.getByText('你赢了')).not.toBeNull()
    expect(screen.getByText('最终比分 3 : 1')).not.toBeNull()
  })

  it('不给底图就整张不渲染：图没到的时候板子照样是完整的', () => {
    const { container } = render(<Sheet title="平局" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('给了底图就摆一张装饰图，对读屏软件藏起来', () => {
    const { container } = render(
      <Sheet title="你赢了" background="/battle/final-victory-bg.webp" />,
    )
    const art = container.querySelector('img')
    expect(art?.getAttribute('src')).toBe('/battle/final-victory-bg.webp')
    // alt 为空且 aria-hidden：底纹被念出来只会打断真正的内容。
    expect(art?.getAttribute('alt')).toBe('')
    expect(art?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('结算遮罩', () => {
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

describe('卡牌加载动画', () => {
  it('报成一处状态，文字全在 aria-label 上', () => {
    render(<CardLoader />)
    expect(screen.getByRole('status').getAttribute('aria-label')).toBe('加载中')
  })

  it('尺寸写进自定义属性，宽度和描边由 CSS 从它推出来', () => {
    render(<CardLoader size={110} />)
    expect(screen.getByRole('status').style.getPropertyValue('--cl-size')).toBe('110px')
  })

  it('不给 speed 就整个不写这一条，让 CSS 里读令牌的默认值生效', () => {
    render(<CardLoader />)
    expect(screen.getByRole('status').style.getPropertyValue('--cl-speed')).toBe('')
  })
})

describe('图标', () => {
  it('对读屏软件藏起来：它永远长在一颗带名字的按钮里，再读一遍就重复了', () => {
    const { container } = render(<Icon name="back" />)
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('尺寸同时管宽和高（取景框是正方形）', () => {
    const { container } = render(<Icon name="star" size={18} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('18')
    expect(svg?.getAttribute('height')).toBe('18')
  })

  it('星芒和菱形标成实心：这两个太小，描边会把内部空间挤没', () => {
    const { container } = render(<Icon name="diamond" />)
    expect(container.querySelector('svg')?.getAttribute('data-fill')).toBe('true')
  })

  it('线稿那几个不标实心', () => {
    const { container } = render(<Icon name="muted" />)
    expect(container.querySelector('svg')?.getAttribute('data-fill')).toBeNull()
  })
})
