/**
 * 文字页的通用外壳：左上角返回、正中标题、右上角一两颗控件、下面一块能滚的正文。
 *
 * 设置、账号、关于这三页除了正文以外长得一模一样（旧版 `InfoScreen` 就是这套：
 * 返回在左上角，静音摆在对角的右上角）。**需求单里没有这一档**——旧版只有信息页一页
 * 用得上，它的那几块是就地写在 `info.css` 里的。这里把它提成组件是为了后面两页不再抄一遍
 *（7.1 第 2 条：新界面需要新样式，先给组件库加变体，再在界面里用）。
 *
 * ## 版式在这里，不在各页
 *
 * 各页只给标题、返回去哪、右上角摆什么、正文是什么。页宽、内边距、安全区留白、
 * 标题字号、两档屏幕的差别全在 `page.css` 里——三页共用一份，改一次三页一起变。
 *
 * ## 安全区靠 CSS 的 `env()`，不走 `platform.safeArea`
 *
 * `platform.safeArea` 存在是因为**画布够不着 CSS**（见 platform 的 safeArea.ts 文件头）。
 * 这一页整个是真 DOM，`env(safe-area-inset-*)` 直接就能用，而且它跟着浏览器逐帧更新，
 * 比订阅一次快照再写进 style 更准。`Dialog` 也是这么做的。
 *
 * ## 底色可以让出去
 *
 * 默认铺页面底色；铺了自己底图的页面（关于页）在外层写 `--ui-page-background: transparent`
 * 就能让底图透出来。这是这个组件对外开放的唯一一个样式旋钮，理由见 page.css。
 *
 * ## `position: absolute` 铺满
 *
 * 这一层铺的是整屏。用 absolute 而不是 fixed：目录页那条条目要拍得出来，
 * 外面套一个定尺寸的相对定位盒子就行（同 `Veil`）。真界面里最近的定位祖先就是视口，
 * 效果和 fixed 一样。
 */

import type { ReactNode } from 'react'
import { Icon } from './Icon'
import './page.css'

export interface PageProps {
  title: string
  children: ReactNode
  /** 左上角那颗返回。不给就整颗不渲染（比如从抽屉里弹出来的页面）。 */
  onBack?: () => void
  /** 返回钮的无障碍名字。默认「返回」。 */
  backLabel?: string
  /** 右上角那一两颗控件（静音、全屏）。不给就空着。 */
  actions?: ReactNode
}

export function Page({ title, children, onBack, backLabel = '返回', actions }: PageProps) {
  return (
    <main className="ui-page">
      <header className="ui-page__head">
        {/*
          返回钮和右上角那一簇各占一边，标题在中间。两边都用同一个固定宽度占位
          （见 page.css 的 .ui-page__slot），标题才真的落在正中——
          靠 `justify-content: space-between` 的话，右边少一颗钮标题就会偏。
        */}
        <div className="ui-page__slot">
          {onBack === undefined ? null : (
            <button type="button" className="ui-page__back" onClick={onBack}>
              <Icon name="back" size={20} />
              <span>{backLabel}</span>
            </button>
          )}
        </div>
        <h1 className="ui-page__title">{title}</h1>
        <div className="ui-page__slot ui-page__slot--end">{actions}</div>
      </header>
      {/*
        正文自己滚，不让整页滚：整页滚的话顶上那条页眉会跟着卷走，
        而返回钮是这几页唯一的出口，不该滚没了。
      */}
      <div className="ui-page__body">
        <div className="ui-page__inner">{children}</div>
      </div>
    </main>
  )
}
