/**
 * 组件目录页条目：设置页那一排开关（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头。带上说明那行小字，
 * 因为设置页三条里有两条都带。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { Toggle } from './Toggle'

export default {
  title: 'UI/Toggle',
  component: Toggle,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: {
    label: '减少动效',
    hint: '关掉画面上的弹跳和位移，留下必要的淡入淡出。',
    checked: false,
    onChange: () => undefined,
  },
}

export const Normal = { name: '普通' }
