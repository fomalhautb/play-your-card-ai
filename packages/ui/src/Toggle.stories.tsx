/**
 * 组件目录页条目：设置页那一排开关（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓（关 / 开各一条）· 悬停 ✓ · 按下 ✓ · 禁用 ✓ · 加载 — 不适用
 * 悬停和按下靠 `state` 摆出来：目录页没有装模拟伪类的插件
 *（见 client/dev/storybook/README.md）。
 *
 * 这个组件在需求单里还没有编号，理由见 Toggle.tsx 的文件头。
 *
 * 条目外面套一个定宽的盒子：这一行是「左边文字右边滑块」，没有宽度就看不出它长什么样。
 * 宽度写死而不是跟着容器走，是目录页的确定性要求（README 的第 5 条）。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Toggle } from './Toggle'

const noop = () => undefined

/** 定宽的一栏，外加纸面底色——真界面里这一排是摆在纸面或夜色页上的。 */
function Column({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        width: 420,
        padding: 16,
        background: 'var(--color-paper-base)',
        color: 'var(--color-paper-ink)',
      }}
    >
      {children}
    </div>
  )
}

export default {
  title: 'UI/Toggle',
  component: Toggle,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { label: '关闭声音', checked: false, onChange: noop },
  decorators: [
    (Story: () => ReactNode) => (
      <Column>
        <Story />
      </Column>
    ),
  ],
}

export const Off = { name: '关' }

export const On = { name: '开', args: { checked: true } }

/** 带一行说明：设置页里「减少动效」那一条要解释清楚它会关掉什么。 */
export const WithHint = {
  name: '带说明',
  args: {
    label: '减少动效',
    hint: '关掉画面上的弹跳和位移，留下必要的淡入淡出。',
    checked: true,
  },
}

export const Hover = { name: '悬停', args: { state: 'hover' } }

export const Pressed = { name: '按下', args: { state: 'pressed' } }

/** 禁用：这台设备不给整页全屏时（iPhone 上就是这样），「全屏」那一条是灰的。 */
export const Disabled = {
  name: '禁用',
  args: { label: '全屏', hint: '这台设备的浏览器不给网页整页全屏。', disabled: true },
}
