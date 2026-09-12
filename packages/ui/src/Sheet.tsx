/**
 * 面板 H（羊皮纸结算底板）（需求单「三、面板和底板」）。
 *
 * 整局打完盖在全屏正中的那块羊皮纸：标题、比分和一排按钮摆在它上面。
 * 归 `ui` 而不是 `canvas`，是需求单「拿不准的地方」第 1 条定的——终局结算是文字界面。
 *
 * ## 标题归它管，别的交给 children
 *
 * 需求单把标题的字号、字重、字距和三档结果的字色都算进了这块板的「关键值」，
 * 所以标题是这个组件的一部分，不是调用方摆上去的一行字——交出去的话，
 * 三档结果各配什么颜色就会变成每个调用方各抄一遍。
 * 比分、按钮那些各页不同的东西才走 `children`。
 *
 * ## 四角那些星芒和麦穗在图里，不在代码里
 *
 * 底板有三张现成的原画（`/battle/final-{victory,defeat,draw}-bg.webp`，
 * 已经登记在 client 的 `preload/manifests.ts` 里）。装饰全画在图上，所以这个组件
 * 只负责「摆一张图 + 在它上面排内容」，一笔装饰都不画。
 *
 * 图的地址由调用方给（`background`）：`ui` 不认识素材路径——它不知道壳的 public
 * 在哪儿，也不该知道（同 canvas 的纹理「谁加载谁负责」）。不给就退回纯色纸面，
 * 目录页的条目和图还没下来的那一刻走的就是这一档。
 *
 * ## 尺寸：宽度定死一档，不按内容撑
 *
 * 原画是 775×517。内容多一行少一行都不该让这块板变形，所以宽度定死、高度靠
 * `aspect-ratio` 跟上，内容在里面居中。窄屏上整块按 `min(…, 100%)` 缩，比例不变
 *（同 Button / Dialog 那条响应式）。
 */

import type { ReactNode } from 'react'
import './sheet.css'

/** 三种结果各一档，决定标题的字色。`plain` 给「没有输赢可言」的场合（对局中断）。 */
export type SheetTone = 'victory' | 'defeat' | 'draw' | 'plain'

export interface SheetProps {
  /** 板正中那行大字。中断局传的是中断原因。 */
  title: string
  /** 标题下面的东西：比分、一排按钮。 */
  children?: ReactNode
  /** 默认 `plain`：标题是普通墨色。 */
  tone?: SheetTone
  /**
   * 底板原画的地址。不给就只有纯色纸面加一道框。
   *
   * 注意它是**装饰**：内容不靠它定位，图没下来的时候这块板照样是完整可读的——
   * 结算是玩家打完一局最想看的一屏，不能因为一张图没到就白着。
   */
  background?: string
}

export function Sheet({ title, children, tone = 'plain', background }: SheetProps) {
  return (
    <div className="ui-sheet" data-tone={tone}>
      {background === undefined ? null : (
        // `alt=""` + aria-hidden：它是底纹，读屏软件念它只会打断真正的内容。
        <img
          className="ui-sheet__art"
          src={background}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
      )}
      <div className="ui-sheet__content">
        <p className="ui-sheet__title">{title}</p>
        {children}
      </div>
    </div>
  )
}
