/**
 * 组件目录页条目：按钮（7.1 第 3 条）。
 *
 * 正式版简化第 3 步把每个组件的条目收成一条，只摆最基本的样子：
 * 组件现在是素方块，「悬停 / 按下 / 禁用」那几档拍出来和普通态一模一样
 *（它们从前的区别全在颜色和边框上）。重做视觉时再按状态矩阵补回来。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { Button } from './Button'

export default {
  title: 'UI/Button',
  component: Button,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { children: '开始游戏' },
}

export const Normal = { name: '普通' }
