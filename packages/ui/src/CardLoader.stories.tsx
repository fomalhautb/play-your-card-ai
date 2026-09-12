/**
 * 组件目录页条目：条 D（卡牌加载动画）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   它本身就是「加载」这件事的显示，不是控件，其余四态不适用。
 *   条目分的是**尺寸**：这个组件只有这一个旋钮会改观感。
 *
 * ## 动画怎么停住
 *
 * 这是一条永不结束的 CSS 动画，而 `toHaveScreenshot` 要连拍两张一致的才算稳。
 * 停住它的不是这份 story——是截图回归配置里的 `animations: 'disabled'`
 *（见 client/dev/storybook/playwright.config.ts），它会把页面上的 CSS 动画一律
 * 停在第一帧。所以基线拍到的是「落地压扁」那一帧（keyframes 的 0%）。
 * 画布条目那套手动时钟和这条无关。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { CardLoader } from './CardLoader'

export default {
  title: 'UI/CardLoader',
  component: CardLoader,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  decorators: [
    (Story: () => ReactNode) => (
      <div style={{ padding: 16, color: 'var(--color-card-loader-line)' }}>{Story()}</div>
    ),
  ],
}

/** 默认 72：加载页上就是这一档。 */
export const Normal = { name: '普通' }

/** 小一档：内框和菱形在这个尺寸下还认不认得出来。 */
export const Small = { name: '小尺寸', args: { size: 44 } }

/** 大一档：描边被 clamp 顶到 3px 的上限，线不会跟着无限变粗。 */
export const Large = { name: '大尺寸', args: { size: 110 } }
