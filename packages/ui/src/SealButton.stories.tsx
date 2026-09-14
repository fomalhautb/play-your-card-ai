/**
 * 组件目录页条目：带开关语义的按钮（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头——`pressed` 现在只改无障碍语义，
 * 拍出来和不传时一样。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { SealButton } from './SealButton'

export default {
  title: 'UI/SealButton',
  component: SealButton,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { label: '关闭声音', onClick: () => undefined },
}

export const Normal = { name: '普通' }
