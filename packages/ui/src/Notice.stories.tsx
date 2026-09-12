/**
 * 组件目录页条目：一行提示（7.1 第 3 条）。
 *
 * 只有一条，理由见 Button.stories.tsx 的文件头——三档语气现在只差一个 `role`，
 * 拍出来完全一样。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { Notice } from './Notice'

export default {
  title: 'UI/Notice',
  component: Notice,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { children: '连不上账号服务（网络请求失败），过一会儿再试。' },
}

export const Normal = { name: '普通' }
