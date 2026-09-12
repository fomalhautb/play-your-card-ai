/**
 * 组件目录页条目：面板 H（羊皮纸结算底板）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   面板本身不是控件，五态全部不适用；里面那两颗按钮的状态在 `UI/Button` 那几条里。
 *   条目分的是需求单记的那三档结果（胜 / 负 / 平），外加「底图还没下来」那一档。
 *
 * 底图从壳的 public 读（目录页把 `apps/web/public` 当静态根，见 storybook 的 main.ts），
 * 那几张是 `pnpm assets:build` 的产物。图没打过的话这几条会拍成纯纸面——
 * 和 `needsAtlas` 那套一样，跑比对前先 `pnpm assets:build`。
 *
 * ## 外面那个定宽的盒子不能省
 *
 * 板子的宽是 `min(775px, 100%)`，而 Storybook 的居中版式给的是一个**收缩到内容**的容器：
 * 那时 `100%` 要拿「内容有多宽」去算，算出来是三百多，标题于是断成两行、按钮也挤掉了。
 * 套一个写死 820 宽的盒子，板子才按设计尺寸摆开。
 * 宽度写死而不是跟着容器走，也正是目录页的确定性要求
 *（见 client/dev/storybook/README.md 的第 5 条）。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Button } from './Button'
import { Sheet } from './Sheet'

const noop = () => undefined

/** 底下那排按钮。四条条目共用，省得各抄一遍。 */
function Actions() {
  return (
    <div style={{ display: 'flex', gap: 'var(--space-xxl)' }}>
      <Button onClick={noop}>再来一局</Button>
      <Button onClick={noop}>回首页</Button>
    </div>
  )
}

/** 比分那一行加按钮。中断局没有比分可言，所以那一条不用它。 */
function Body({ mine, theirs }: { mine: number; theirs: number }) {
  return (
    <>
      <p
        style={{
          margin: 0,
          color: 'var(--color-paper-ink)',
          fontSize: 28,
          fontWeight: 600,
          lineHeight: 1.4,
        }}
      >
        {`最终比分 ${mine} : ${theirs}`}
      </p>
      <Actions />
    </>
  )
}

export default {
  title: 'UI/Sheet',
  component: Sheet,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  decorators: [
    (Story: () => ReactNode) => (
      // 820 比板宽 775 再宽一点，好让 `min(775px, 100%)` 有个确定的 100% 可算；
      // 多出来的那 45px 空在右边，不影响这条条目要看的东西（理由见文件头）。
      <div style={{ width: 820 }}>
        <Story />
      </div>
    ),
  ],
}

export const Victory = {
  name: '胜局',
  args: {
    title: '你赢了',
    tone: 'victory',
    background: '/battle/final-victory-bg.webp',
    children: <Body mine={3} theirs={1} />,
  },
}

export const Defeat = {
  name: '败局',
  args: {
    title: '你输了',
    tone: 'defeat',
    background: '/battle/final-defeat-bg.webp',
    children: <Body mine={1} theirs={3} />,
  },
}

export const Draw = {
  name: '平局',
  args: {
    title: '平局',
    tone: 'draw',
    background: '/battle/final-draw-bg.webp',
    children: <Body mine={2} theirs={2} />,
  },
}

/**
 * 没有底图那一档：对局中断时没有输赢可言，用的是 `plain`；
 * 这一条同时也是「图还没下来」的样子——板子照样是完整可读的（见 Sheet.tsx 的文件头）。
 */
export const NoArt = {
  name: '无底图',
  args: { title: '对手掉线了', children: <Actions /> },
}
