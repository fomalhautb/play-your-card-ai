/**
 * 组件目录页条目：方块按钮（7.1 第 3 条）。
 *
 * 这是 React 这半边唯一一种按钮，所以目录页的「UI/」下面也只有这一条按钮条目。
 *
 * 状态矩阵：
 *   普通    「普通」那条
 *   悬停    不适用。方块按钮没有悬停的视觉态（只换指针形状，拍不出来），同画布的 Box
 *   按下    不适用，同上
 *   禁用    「禁用」那条，整颗 0.4 透明度
 *   开着    「开着」那条。这不是瞬态，是开关类按钮的当前值（`pressed`），反色表示
 *   加载    不适用。它不等任何东西
 *
 * 前三档对应画布 `Box.stories.ts` 的普通 / 禁用两条，第四档是画布上没有的开关语义。
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
export const Disabled = { name: '禁用', args: { disabled: true } }
export const Pressed = { name: '开着', args: { children: '打开声音', pressed: true } }
