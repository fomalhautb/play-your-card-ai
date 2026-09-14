/**
 * 文字页的通用外壳：一颗返回、一个标题、右上角那一两颗控件，下面一块能滚的正文。
 *
 * 设置、账号、关于三页除了正文以外长得一样，版式放在这里，三页共用一份。
 *
 * 正式版简化第 3 步之前，这里还管着页宽、字号、安全区留白和两档屏幕的差别，
 * 现在只剩「一列，正文自己滚」。**正文自己滚、整页不滚**这一条要留着：
 * 整页滚的话顶上那颗返回会跟着卷走，而它是这几页唯一的出口。
 */

import type { ReactNode } from 'react'
import './page.css'

export interface PageProps {
  title: string
  children: ReactNode
  /** 返回钮。不给就整颗不渲染（比如从抽屉里弹出来的页面）。 */
  onBack?: () => void
  /** 返回钮上的字。默认「返回」。 */
  backLabel?: string
  /** 页眉上那一两颗控件（静音、全屏）。不给就空着。 */
  actions?: ReactNode
}

export function Page({ title, children, onBack, backLabel = '返回', actions }: PageProps) {
  return (
    <main className="ui-page">
      {onBack === undefined ? null : (
        <button type="button" onClick={onBack}>
          {backLabel}
        </button>
      )}
      <h1>{title}</h1>
      {actions}
      <div className="ui-page__body">{children}</div>
    </main>
  )
}
