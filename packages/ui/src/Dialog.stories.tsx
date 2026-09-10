/**
 * 组件目录页条目：弹窗 A（纸面对话框）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   面板本身不是控件，五态全部不适用；里面那两颗按钮的状态在 `UI/Button` 那几条里。
 * 变体按「有几个操作」分两条：两个操作（离开确认）和一个操作（只有确认的提示）。
 *
 * 每条都传 `inline`：截图回归拍的是条目那一块，传送到 body 之后那一块里就什么都没有了
 *（见 Dialog.tsx 的 `inline`）。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import { Dialog } from './Dialog'

const noop = () => undefined

export default {
  title: 'UI/Dialog',
  component: Dialog,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { open: true, inline: true, onDismiss: noop },
}

/** 两个操作：对局里的离开确认就是这一档。 */
export const TwoActions = {
  name: '两个操作',
  args: {
    title: '离开对局',
    children: '现在离开就是认输，这一局不会保留。确定要走吗？',
    confirm: { label: '确定离开', onSelect: noop },
    cancel: { label: '再想想', onSelect: noop },
  },
}

/** 一个操作：只有确认的提示。点遮罩和按 Esc 仍然能退（见 Dialog.tsx 的文件头）。 */
export const OneAction = {
  name: '一个操作',
  args: {
    title: '横过来玩',
    children: '这一局要横屏才排得下战场和手牌。',
    confirm: { label: '知道了', onSelect: noop },
  },
}

/** 只有标题和一颗按钮，正文整行不渲染。 */
export const TitleOnly = {
  name: '只有标题',
  args: { title: '对局已结束', confirm: { label: '回首页', onSelect: noop } },
}
