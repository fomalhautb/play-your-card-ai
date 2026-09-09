/**
 * 顶栏那两颗图标钮的占位剪影。
 *
 * 真图标是美术资源，第 33 条才搬进新客户端；在那之前场景总得给 `TopBar` 两张纹理，
 * 否则右上角那两颗钮建不出来。这里现画两个几何图形烤成纹理顶上——
 * 它们是**占位**，不是设计：真资源到位后调用方从 `DuelSceneOptions.icons` 传进来，
 * 这个文件连同它的调用就一起删掉。
 *
 * 画法和目录页 TopBar 条目里的占位图形一致（那边拍的也是顶栏的版式，不是图标长什么样）。
 */

import { tokens } from '@ai-duel/design'
import { Graphics, type Renderer, type Texture } from 'pixi.js'

export interface DuelIcons {
  leave: Texture
  mute: Texture
}

function bake(renderer: Renderer, kind: 'leave' | 'mute'): Texture {
  const size = tokens.size.control.iconBattle
  const g = new Graphics()
  if (kind === 'mute') {
    // 一个小喇叭：左边一块方箱，右边一个朝右的三角。
    g.rect(size * 0.2, size * 0.34, size * 0.24, size * 0.32).fill({ color: 0xffffff })
    g.moveTo(size * 0.44, size * 0.5)
      .lineTo(size * 0.72, size * 0.22)
      .lineTo(size * 0.72, size * 0.78)
      .closePath()
      .fill({ color: 0xffffff })
  } else {
    // 一扇门加一根把手，表示「离开」。
    g.rect(size * 0.2, size * 0.2, size * 0.34, size * 0.6).fill({ color: 0xffffff })
    g.rect(size * 0.54, size * 0.44, size * 0.28, size * 0.12).fill({ color: 0xffffff })
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
