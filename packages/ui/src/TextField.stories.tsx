/**
 * 组件目录页条目：单行文字输入框（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { TextField } from './TextField'

export default {
  title: 'UI/TextField',
  component: TextField,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { label: '牌组名', value: '低费流', onChange: () => undefined },
}

export const Normal = { name: '普通' }
