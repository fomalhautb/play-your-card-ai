/**
 * 组件目录页的全局设置：底色、控制面板上的「实时」开关，以及把 Pixi 条目换成画布的装饰器。
 *
 * 为什么 Pixi 那半边要走装饰器：story 文件跟着组件走，`canvas` 包里那些 story 因此
 * **不能 import React**（依赖规则「边界-canvas-不碰-react」，见 .dependency-cruiser.cjs），
 * 也不能 import 本目录下的任何东西（跨包只走包入口，7.2 第 2 条）。
 * 所以它们只在 `parameters.pixi` 里放一份纯数据的声明（见 pixiStory.tsx 的 PixiStorySpec），
 * 由这里认出来、换成 `<PixiStage>`。canvas 的 story 于是一行 React 都没有。
 */

import { Button } from '@ai-duel/ui'
import type { Decorator, Preview } from '@storybook/react-vite'
import { useState } from 'react'
import { PixiStage, type PixiStorySpec } from './pixiStory'
// 这里原先还 import 过 `@ai-duel/design/tokens.css`，正式版简化第 5 步连同那份 CSS 产物
// 一起删了：目录页没有一条条目还在读 `var(--…)`。
import './preview.css'

/**
 * 认出 `parameters.pixi` 的条目，换成嵌在页面里的画布。
 * 没有这个参数的条目（`ui` 的 React 组件）原样渲染，只多包一层就绪标记。
 */
const withPixiStage: Decorator = (Story, context) => {
  const spec = context.parameters.pixi as PixiStorySpec | undefined
  if (spec === undefined) {
    // DOM 条目一渲染出来就算就绪：React 提交完这一层，里面的内容也已经在 DOM 里了。
    return (
      <div data-story-ready="1">
        <Story />
      </div>
    )
  }
  return <PixiStoryHost spec={spec} live={context.args.live === true} />
}

/**
 * 画布条目的外壳：管「重播」这一个按钮。
 *
 * 按钮只在实时那一档出现。手动时钟下画面本来就停在固定的一帧，重播没有意义，
 * 而且截图回归拍的就是这一档——多一颗按钮就是多一块会随主题变化的像素。
 *
 * 用 `ui` 的方块按钮而不是原生 `<button>`：目录页是拿来看组件长相的，
 * 页面上自己那颗钮却是浏览器默认外观的话，看的人分不清哪一种才是这个项目的按钮。
 */
function PixiStoryHost({ spec, live }: { spec: PixiStorySpec; live: boolean }) {
  const [epoch, setEpoch] = useState(0)
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 8 }}>
      {/*
        key 把「换时钟」和「重播」都变成整个换一个组件：Pixi 拆渲染器时会把画布的 WebGL
        上下文永久丢掉，在同一个 <canvas> 上重建是画不出东西的（理由见 pixiStory.tsx）。
      */}
      <PixiStage key={`${live}-${epoch}`} spec={spec} live={live} />
      {live && <Button onClick={() => setEpoch((n) => n + 1)}>重播</Button>}
    </div>
  )
}

const preview: Preview = {
  decorators: [withPixiStage],
  /*
   * 「实时」是全局参数而不是每条 story 各写一份：canvas 那边有五个 story 文件，
   * 各写一遍只会让它们跟着这个开关的写法一起漂。`ui` 的条目用不上它，
   * 在自己的 meta 里把这一项从面板上关掉。
   */
  args: { live: false },
  argTypes: {
    live: {
      name: '实时',
      description: '关：手动时钟推进到固定的一帧（截图回归用这一档）。开：真实 ticker，看动画。',
      control: 'boolean',
    },
  },
  parameters: {
    layout: 'centered',
    // 目录页只看外观，不需要 Storybook 那套「点了什么」的日志面板。
    actions: { disable: true },
  },
}

export default preview
