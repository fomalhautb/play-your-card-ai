/**
 * 组件目录页条目：输入框 A（纸面数字框）的房间码档（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 —（框没有悬停样式）· 按下 —（不是按钮）· 禁用 —（这一档还没有用到的地方）
 *   加载 —（填码是同步的）
 * 另外拍一条「填了一半」和一条「码不对」——后者是这个框唯一会变红的时候。
 *
 * 三条都不传 `autoFocus`：焦点框会被拍进基线图，而它在真界面里是必开的
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
  args: { label: '房间码', value: '', onChange: () => undefined },
}

export const Empty = { name: '空' }

export const Filled = { name: '填好了', args: { value: '4821' } }

export const Invalid = { name: '码不对', args: { value: '4821', error: '这个房间不存在' } }
