/**
 * 开发页索引：把 `client/dev` 下的几页列出来（架构 7.2 第 5 条）。
 *
 * 这一整个目录在生产构建里不存在，理由见 App.tsx 那张开发页表。
 * 清单写死在这里而不是从路由表反推：路由表里的开发页本来就是同一份数据，
 * 但那边只有路径没有说明，而这一页真正有用的是每条后面那句「它是干什么的」。
 */

import './devIndex.css'

interface DevPage {
  path: string
  title: string
  note: string
}

const PAGES: DevPage[] = [
  {
    path: '/dev/duel',
    title: '对局场景调试',
    note: '本地开一局，能切效果档位、看渲染计数和帧率。',
  },
]

export function DevIndex() {
  return (
    <main className="dev-index">
      <h1>开发页</h1>
      <ul className="dev-index__list">
        {PAGES.map((page) => (
          <li key={page.path}>
            <a href={page.path}>{page.title}</a>
            <span>{page.note}</span>
          </li>
        ))}
      </ul>
      <p>
        组件目录页不在这里，它是另一个服务：<code>pnpm storybook</code>。
      </p>
    </main>
  )
}
