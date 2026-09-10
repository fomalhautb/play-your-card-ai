/**
 * 组件目录页条目：纸面单行输入框（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 有内容 ✓ · 悬停 — 不适用（输入框没有悬停态）
 *   按下 — 不适用 · 禁用 — 还没有哪儿要它，用到时再补 · 加载 — 不适用
 * 焦点圈拍不到：目录页没有装模拟伪类的插件，而 `:focus-visible` 要真键盘操作才出现
 *（同 README「状态矩阵」那一节）。
 *
 * 这个组件在需求单里还没有编号，理由见 TextField.tsx 的文件头。
 */

import { TextField } from './TextField'

const noop = () => undefined

export default {
  title: 'UI/TextField',
  component: TextField,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { onChange: noop, label: '牌组名' },
}

/** 空着：只有占位字。 */
export const Empty = {
  name: '空着',
  args: { value: '', placeholder: '给这套牌组起个名字' },
}

/** 有内容：构筑页改名时就是这一档。 */
export const Filled = {
  name: '有内容',
  args: { value: '低费流' },
}

/** 到上限：牌组名最多 10 个字，再打就打不进去了（截断按码点算）。 */
export const AtLimit = {
  name: '到字数上限',
  args: { value: '十个字正好到这里', maxLength: 10 },
}
