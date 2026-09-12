/**
 * 控件上那两枚图标的占位剪影：离开、静音（对局顶栏右端那一行）。
 *
 * 真图标是美术资源（需求单图标 B），到位之前场景总得给按钮几张纹理，否则钮建不出来。
 * 这里现画几个几何图形烤成纹理顶上——它们是**占位**，不是设计：
 * 真资源到位后由调用方从各场景的 `icons` 传进来，这个文件连同它的调用一起删掉。
 *
 * 放在 `fx/` 而不是对局场景下面：这种占位本来就不属于某一个场景，
 * 而且画法要和真图标到位时的替换口径对得上。
 *
 * 一律画**实心剪影**而不是线稿：顶栏那两枚只有 44 像素见方、剪影本身还要再小一圈，
 * 细线稿在这个尺寸上会被抗锯齿吃掉大半（需求单按钮 K 那条同样的理由）。
 */

import { tokens } from '@ai-duel/design'
import { Graphics, type Renderer, type Texture } from 'pixi.js'

export interface DuelIcons {
  leave: Texture
  mute: Texture
}

/** 一个小喇叭：左边一块方箱，右边一个朝右的三角。 */
function drawSpeaker(g: Graphics, size: number): void {
  g.rect(size * 0.2, size * 0.34, size * 0.24, size * 0.32).fill({ color: 0xffffff })
  g.moveTo(size * 0.44, size * 0.5)
    .lineTo(size * 0.72, size * 0.22)
    .lineTo(size * 0.72, size * 0.78)
    .closePath()
    .fill({ color: 0xffffff })
}

function bake(renderer: Renderer, kind: 'leave' | 'mute'): Texture {
  const size = tokens.size.control.iconBattle
  const g = new Graphics()
  if (kind === 'leave') {
    // 一扇门加一根把手，表示「离开」。
    g.rect(size * 0.2, size * 0.2, size * 0.34, size * 0.6).fill({ color: 0xffffff })
    g.rect(size * 0.54, size * 0.44, size * 0.28, size * 0.12).fill({ color: 0xffffff })
  } else {
    drawSpeaker(g, size)
  }
  const texture = renderer.generateTexture({ target: g, resolution: 1, antialias: true })
  g.destroy()
  return texture
}

/**
 * 烤出两张占位图标。返回的纹理归调用方销毁——它是场景自己建的，不是外面传进来的资源。
 * 建场景时烤一次，之后不再动（烤纹理要走一次离屏渲染，不能发生在动画期间，见纪律 3.1）。
 */
export function bakePlaceholderIcons(renderer: Renderer): DuelIcons {
  return { leave: bake(renderer, 'leave'), mute: bake(renderer, 'mute') }
}
