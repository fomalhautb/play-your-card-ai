/**
 * 组件目录页条目：对话框（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头。
 *
 * 两件事这一条必须做：
 * 1. 传 `inline`——真界面里对话框走 `showModal()` 进浏览器顶层，而顶层里的东西
 *    在原地的布局尺寸是 0，截图回归拍的那一块会是一片空（见 Dialog.tsx 的 `inline`）。
 * 2. 外面套一个定尺寸的相对定位盒子——非模态的 `<dialog>` 是 `position: absolute`，
 *    没有定位祖先的话它会跑到视口上去。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Dialog } from './Dialog'

const noop = () => undefined

/** 定尺寸的相对定位盒子，理由见文件头。 */
function Frame({ children }: { children: ReactNode }) {
  return <div style={{ position: 'relative', width: 520, height: 260 }}>{children}</div>
}

export default {
  title: 'UI/Dialog',
  component: Dialog,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { open: true, inline: true, onDismiss: noop },
  decorators: [
    (Story: () => ReactNode) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
}

/** 两个操作：对局里的离开确认就是这一档。 */
export const Normal = {
  name: '普通',
  args: {
    title: '离开对局',
    children: '现在离开就是认输，这一局不会保留。确定要走吗？',
    confirm: { label: '确定离开', onSelect: noop },
    cancel: { label: '再想想', onSelect: noop },
  },
}
