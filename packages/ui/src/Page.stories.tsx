/**
 * 组件目录页条目：文字页外壳（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头。
 *
 * 外面那个定尺寸的相对定位盒子是必须的：`Page` 是 `position: absolute`，
 * 没有定位祖先的话它会铺到视口上，而截图回归拍的是条目那一块。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Button } from './Button'
import { Page } from './Page'

const noop = () => undefined

/** 定尺寸的相对定位盒子，理由见文件头。 */
function Frame({ children }: { children: ReactNode }) {
  return <div style={{ position: 'relative', width: 640, height: 320 }}>{children}</div>
}

export default {
  title: 'UI/Page',
  component: Page,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: {
    title: '关于本作',
    onBack: noop,
    actions: <Button onClick={noop}>关闭声音</Button>,
    children: <p>出牌吧！AI！ 是一个把大模型答题做成卡牌对战的小游戏。</p>,
  },
  decorators: [
    (Story: () => ReactNode) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
}

export const Normal = { name: '普通' }
