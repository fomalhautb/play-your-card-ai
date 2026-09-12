/**
 * 组件目录页条目：结算底板（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头——胜 / 负 / 平那三档从前差的是底图和
 * 标题字色，两样都剥掉了。
 *
 * 外面那个定宽的盒子是目录页的确定性要求：版式不许跟着容器宽度走
 *（见 client/dev/storybook/README.md 的第 5 条），而 Storybook 的居中版式给的容器
 * 是收缩到内容的。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'

const noop = () => undefined

export default {
  title: 'UI/Sheet',
  component: Sheet,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: {
    title: '你赢了',
    children: (
      <>
        <p>最终比分 3 : 1</p>
        <Button onClick={noop}>再来一局</Button>
        <Button onClick={noop}>回首页</Button>
      </>
    ),
  },
  decorators: [
    (Story: () => ReactNode) => (
      <div style={{ width: 420 }}>
        <Story />
      </div>
    ),
  ],
}

export const Normal = { name: '普通' }
