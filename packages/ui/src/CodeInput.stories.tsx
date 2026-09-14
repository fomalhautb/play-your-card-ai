/**
 * 组件目录页条目：四位房间码的输入框（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头。
 * 不传 `autoFocus`：焦点框会被拍进基线图，而它在真界面里是必开的
 *（见 CodeInput.tsx 的那条 biome-ignore）。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { CodeInput } from './CodeInput'

export default {
  title: 'UI/CodeInput',
  component: CodeInput,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  // 受控组件，目录页只摆样子，不接 onChange。
  args: { label: '房间码', value: '4821', onChange: () => undefined },
}

export const Normal = { name: '普通' }
