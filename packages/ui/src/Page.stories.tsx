/**
 * 组件目录页条目：文字页的通用外壳（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   壳本身不是控件，五态全部不适用；页眉上那颗返回和那枚圆章的状态各在
 *   自己的条目里（`UI/SealButton`）。条目分的是**页眉上摆了什么**和**手机档**。
 *
 * 这个组件在需求单里还没有编号，理由见 Page.tsx 的文件头。
 *
 * 外面那个定尺寸的相对定位盒子是必须的：`Page` 是 `position: absolute`，
 * 没有定位祖先的话它会铺到视口上，而截图回归拍的是条目那一块。
 * 手机档那条把盒子换成 390 宽——但**页面自己的断点认的是视口**，而目录页的视口钉死在
 * 1280×900，所以那一条拍到的仍然是桌面档的页眉，只是被塞进了一个窄盒子里。
 * 这是有意的：把断点改成容器查询就等于让版式跟着容器宽度走，那正是截图回归里
 * 「差一点就换一种排法」的开关（见 client/dev/storybook/README.md 的第 5 条）。
 *
 * title 和导出名用英文的理由见同一份 README 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Notice } from './Notice'
import { Page } from './Page'
import { SealButton } from './SealButton'

const noop = () => undefined

/** 定尺寸的相对定位盒子，理由见文件头。 */
function Frame({ width, children }: { width: number; children: ReactNode }) {
  return <div style={{ position: 'relative', width, height: 560 }}>{children}</div>
}

/** 一段够长的正文，看得出正文栏的宽度和行距。 */
function Body() {
  return (
    <>
      <p style={{ margin: '24px 0 0', fontSize: 17, lineHeight: 1.9, letterSpacing: '0.08em' }}>
        出牌吧！AI！ 是一个把大模型答题做成卡牌对战的小游戏：你派出的每一张 AI
        牌都会替你答一道题，答得多的一方拿下这一轮。
      </p>
      <Notice tone="info">这一页的文案是条目里的示例，不是正式文案。</Notice>
    </>
  )
}

export default {
  title: 'UI/Page',
  component: Page,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  args: { title: '开发者信息', onBack: noop, children: <Body /> },
}

/** 页眉三样都齐：左边返回、正中标题、右上角一枚静音圆章。 */
export const Full = {
  name: '完整页眉',
  args: {
    actions: <SealButton icon="unmuted" label="关闭声音" onClick={noop} />,
  },
  render: (args: Parameters<typeof Page>[0]) => (
    <Frame width={960}>
      <Page {...args} />
    </Frame>
  ),
}

/** 右上角什么都不摆：设置页和账号页就是这一档（静音在正文里是一条开关）。 */
export const NoActions = {
  name: '没有右上角',
  args: { title: '设置' },
  render: (args: Parameters<typeof Page>[0]) => (
    <Frame width={960}>
      <Page {...args} />
    </Frame>
  ),
}

/** 塞进手机那么窄的一栏里：正文栏跟着缩，页眉的断点不跟着（理由见文件头）。 */
export const Narrow = {
  name: '窄栏',
  args: {
    actions: <SealButton icon="unmuted" label="关闭声音" onClick={noop} />,
  },
  render: (args: Parameters<typeof Page>[0]) => (
    <Frame width={390}>
      <Page {...args} />
    </Frame>
  ),
}
