/**
 * 组件目录页条目：弹窗 E（结算遮罩）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   它是一层暗幕，不是控件，五态全部不适用（需求单弹窗 E 那一行记的也是「普通 ✓ · 其余 —」）。
 *   两条条目分的是「底下压着什么」：单看一层黑什么都看不出来，得有东西垫在下面才看得出
 *   这层幕压得够不够。
 *
 * 外面那个定尺寸的相对定位盒子是必须的：`Veil` 是 `position: absolute`，
 * 没有定位祖先的话它会铺到视口上，而截图回归拍的是条目那一块（见 Veil.tsx 的文件头）。
 * 尺寸写死而不是跟着容器走，是目录页的确定性要求
 *（见 client/dev/storybook/README.md 的第 5 条）。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'
import { Veil } from './Veil'

const noop = () => undefined

/** 假装底下是对局那一屏：一块深色底，好看出暗幕压上去之后差多少。 */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: 960,
        height: 540,
        background: 'var(--color-paper-night)',
      }}
    >
      {children}
    </div>
  )
}

export default {
  title: 'UI/Veil',
  component: Veil,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  decorators: [
    (Story: () => ReactNode) => (
      <Stage>
        <Story />
      </Stage>
    ),
  ],
}

/** 真正的用处：终局结算那块羊皮纸压在暗幕上。 */
export const WithSheet = {
  name: '压着结算板',
  args: {
    children: (
      <Sheet title="你赢了" tone="victory" background="/battle/final-victory-bg.webp">
        <div style={{ display: 'flex', gap: 'var(--space-xxl)' }}>
          <Button onClick={noop}>再来一局</Button>
          <Button onClick={noop}>回首页</Button>
        </div>
      </Sheet>
    ),
  },
}

/** 只有幕本身，看它到底压掉了多少底色。 */
export const Bare = { name: '只有暗幕', args: { children: null } }
