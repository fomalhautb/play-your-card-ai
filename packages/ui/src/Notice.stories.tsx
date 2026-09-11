/**
 * 组件目录页条目：提示 E（错误红字）（7.1 第 3 条）。
 *
 * 状态矩阵：
 *   普通 ✓ · 悬停 — · 按下 — · 禁用 — · 加载 —
 *   它是一行字不是控件，五态全部不适用。三条条目分的是**语气**，不是状态。
 *
 * 条目外面套一个定宽的盒子：不给宽度的话这行字会撑成一长条，看不出换行时什么样。
 *
 * title 和导出名用英文的理由见 client/dev/storybook/README.md 的「基线图的文件名」。
 */

import type { ReactNode } from 'react'
import { Notice } from './Notice'

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ width: 420, padding: 16 }}>{children}</div>
}

export default {
  title: 'UI/Notice',
  component: Notice,
  // 「实时」开关是给画布条目用的，React 条目用不上，从面板上关掉。
  argTypes: { live: { control: false, table: { disable: true } } },
  decorators: [
    (Story: () => ReactNode) => (
      <Frame>
        <Story />
      </Frame>
    ),
  ],
}

/**
 * 错误红：这个组件最常见的用处，说一句「刚才那步没成」。
 *
 * 导出名叫 `ErrorTone` 不叫 `Error`：后者会盖住全局的 `Error`，biome 的
 * `noShadowRestrictedNames` 直接拦（三条条目于是统一带上 Tone 后缀）。
 */
export const ErrorTone = {
  name: '错误',
  args: { tone: 'error', children: '连不上账号服务（网络请求失败），过一会儿再试。' },
}

/** 成功绿：设置页重置存档之后那一句。 */
export const OkTone = {
  name: '成功',
  args: { tone: 'ok', children: '存档已经清空，回到新号的状态了。' },
}

/** 次级墨色：不算错，只是补充一句。账号页「绑定账号还没做」用它。 */
export const InfoTone = {
  name: '补充说明',
  args: { tone: 'info', children: '绑定账号还没做好，现在换个浏览器就是另一个号。' },
}
