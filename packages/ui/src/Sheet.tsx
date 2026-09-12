/**
 * 一块底板：一行标题，下面摆调用方给的东西。终局结算那一屏用它。
 *
 * 从前这是「面板 H（羊皮纸结算底板）」：775×517 的原画底图、三档结果各一种标题字色。
 * 正式版简化第 3 步剥成一个带边框的 `<section>`，底图和字色都去掉了——
 * 结果是胜是负由调用方写在标题里（见 client 的 ResultScreen）。
 */

import type { ReactNode } from 'react'
import './sheet.css'

export interface SheetProps {
  /** 板正中那行字。中断局传的是中断原因。 */
  title: string
  /** 标题下面的东西：比分、一排按钮。 */
  children?: ReactNode
}

export function Sheet({ title, children }: SheetProps) {
  return (
    <section className="ui-sheet">
      <h2>{title}</h2>
      {children}
    </section>
  )
}
