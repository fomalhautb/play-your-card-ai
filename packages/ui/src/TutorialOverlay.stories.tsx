/**
 * 组件目录页条目：新手教程的引导层（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   它是一层引导浮层，不是控件，后四态全部不适用。三条条目分的是这一层的三种长相：
 *   指着一处（最常见）、同时指两处（第 1 轮那句「双方出牌结束」）、
 *   以及不压暗的弱引导（第 3 轮放手轮）。
 *
 * 外面那个定尺寸的相对定位盒子是必须的：`TutorialOverlay` 是 `position: absolute`，
 * 没有定位祖先的话它会铺到视口上，而截图回归拍的是条目那一块（同 Veil / Page）。
 * 尺寸写死而不是跟着容器走，是目录页的确定性要求（见 client/dev/storybook/README.md 第 5 条）。
 *
 * 洞的位置这里是**写死的**：真界面上它每帧问画布场景要（`anchorRect`），
 * 而目录页没有画布可问，写死一组坐标正好把这一层的排版单独拍出来。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import type { OverlayRect } from './overlayGeometry'
import { TutorialOverlay } from './TutorialOverlay'

const noop = () => undefined

/** 假装底下是对局那一屏：一块深色底，好看出压暗和洞口的对比。 */
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

/** 挖一组固定的洞。`measure` 每帧被调一次，所以这里返回的必须是同一个数组。 */
function fixed(rects: OverlayRect[]) {
  return () => rects
}

const HAND: OverlayRect[] = [{ x: 250, y: 400, w: 460, h: 120 }]
const BOTH_BOARDS: OverlayRect[] = [
  { x: 260, y: 90, w: 440, h: 130 },
  { x: 260, y: 250, w: 440, h: 130 },
]

export default {
  title: 'UI/TutorialOverlay',
  component: TutorialOverlay,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { active: true },
  decorators: [
    (Story: () => ReactNode) => (
      <Stage>
        <Story />
      </Stage>
    ),
  ],
}

/** 最常见的一步：指着一处，气泡贴在洞上方，右下角一颗「下一步」。 */
export const OneHole = {
  name: '指一处',
  args: {
    instruction: '这是你的手牌。你的牌组共 20 张，开局抽 5 张。',
    measure: fixed(HAND),
    onNext: noop,
  },
}

/** 同时指两处（第 1 轮那句「双方出牌结束」）：两个洞，气泡贴着第一个放。 */
export const TwoHoles = {
  name: '指两处',
  args: {
    instruction: '对方已经打完这一轮的牌，双方出牌结束。接下来，场上的 AI 将进入答题环节。',
    measure: fixed(BOTH_BOARDS),
    onNext: noop,
  },
}

/**
 * 第 3 轮的弱引导：不压暗、不等点击，只留一圈描边和一句话
 *（那一轮要验证玩家自己走得完一整轮，见 client 的 tutorial/steps.ts）。
 */
export const NoDim = {
  name: '不压暗',
  args: { instruction: '现在由你决定这一轮怎么出牌。', measure: fixed(HAND), dim: false },
}

/** 「刚才那一下不行」：它和常驻提示同时出现也不该互相顶替，所以两句一起拍一张。 */
export const Blocked = {
  name: '操作被挡下',
  args: {
    instruction: '这次先派它——打出 AI 牌会消耗 Token。',
    measure: fixed(HAND),
    blockTip: '教学第 1 轮：先打出高亮的那张 AI 牌',
  },
}
