/**
 * 「模具」：一段画好的 Graphics，外加它该被烤成多大一张纹理。
 *
 * 尺寸要显式写死，不能让 Pixi 按包围盒算。同一个零件常常拆成好几层分别烤
 *（匾额就有板面、外框、内框、四角、星芒五层），描边和填充的包围盒天生不一样大，
 * 交给包围盒的话五张纹理各是各的尺寸，叠回去就错位了。
 * 写死之后五张都是 224×68，叠在同一个位置即可。
 */

import type { Graphics } from 'pixi.js'

export interface Mold {
  graphics: Graphics
  /** 烤成纹理时的取景框，原点固定在 (0, 0)。 */
  width: number
  height: number
}

/** 画一个模具。draw 里画到画布外面的部分会被取景框裁掉，这是预期行为。 */
export function mold(width: number, height: number, graphics: Graphics): Mold {
  return { graphics, width, height }
}
