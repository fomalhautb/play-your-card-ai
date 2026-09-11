/**
 * 组件目录页条目：条 B（素材加载进度条）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   它本身就是「加载」这件事的显示，不是控件，其余四态不适用。
 *   条目分的是**进度走到哪儿**：需求单条 B 那一行专门记了「0 / 100 两端 ✗ 未截到」，
 *   这里把两端补上。
 *
 * 条子宽度是写死的 220（见 progressBar.css），不跟着容器走，所以不用套定宽盒子；
 * 套一层只是给它一点留白，免得贴着条目边缘。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { ProgressBar } from './ProgressBar'

export default {
  title: 'UI/ProgressBar',
  component: ProgressBar,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  decorators: [(Story: () => ReactNode) => <div style={{ padding: 16 }}>{Story()}</div>],
}

/** 一张图都还没到：轨是空的。 */
export const Empty = { name: '零进度', args: { value: 0 } }

/** 走到一半，也就是加载页上绝大多数时候的样子。 */
export const Half = { name: '一半', args: { value: 0.5 } }

/** 满格：闸门放行前的最后一帧（`preloadAll` 结束时一定会补一次满格）。 */
export const Full = { name: '满格', args: { value: 1 } }

/** 带百分数：整屏加载页用这一档，玩家能看出还要等多久。 */
export const WithPercent = {
  name: '带百分数',
  args: { value: 0.42, showPercent: true },
}
