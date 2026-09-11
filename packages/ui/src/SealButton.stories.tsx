/**
 * 组件目录页条目：按钮 J（夜色圆章图标钮）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 ✓ · 按下 ✓ · 禁用 ✓ · 加载 — 不适用（这颗钮没有加载态）
 * 悬停和按下靠 `state` 摆出来：目录页没有装模拟伪类的插件
 *（见 client/dev/storybook/README.md）。
 *
 * 另外两条按「另一档尺寸」和「开关态」分：首页那颗是 52，静音开着时图标要换成划掉的喇叭。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import { SealButton } from './SealButton'

const noop = () => undefined

export default {
  title: 'UI/SealButton',
  component: SealButton,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { icon: 'unmuted', label: '关闭声音', onClick: noop },
}

export const Normal = { name: '普通' }

export const Hover = { name: '悬停', args: { state: 'hover' } }

export const Pressed = { name: '按下', args: { state: 'pressed' } }

export const Disabled = { name: '禁用', args: { disabled: true } }

/** 开关按下去之后：图标换成划掉的喇叭，`aria-pressed` 也跟着翻。 */
export const Muted = {
  name: '静音中',
  args: { icon: 'muted', label: '打开声音', pressed: true },
}

/** 首页那一档 52，需求单按钮 J 里给的三档尺寸中最大的一个。 */
export const Large = { name: '大尺寸', args: { size: 52 } }
