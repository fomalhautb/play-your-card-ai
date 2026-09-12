/**
 * 组件目录页条目：按钮 A（墨蓝匾额）的 React 版（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 ✓ · 按下 ✓ · 禁用 ✓ · 加载 —（需求单里按钮 A 没有加载态）
 *
 * 悬停和按下靠 `state` 这个 prop 摆出来，不靠伪类：目录页没有装模拟 CSS 伪类的插件
 *（见 client/dev/storybook/README.md），伪类那条路拍出来和普通态一模一样。
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

export const Hover = { name: '悬停', args: { state: 'hover' } }

export const Pressed = { name: '按下', args: { state: 'pressed' } }

export const Disabled = { name: '禁用', args: { disabled: true } }

/** 窄容器里按钮跟着缩（宽是 `min(224px, 100%)`），字距和框线都照旧。 */
export const Narrow = {
  name: '窄容器',
  render: () => (
    <div style={{ width: 160 }}>
      <Button>回首页</Button>
    </div>
  ),
}
