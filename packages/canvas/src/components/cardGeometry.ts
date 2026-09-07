/**
 * 卡上各层网格的几何：谁共用一份、谁自己开一份。
 *
 * 卡面上的每一层都是一张四边形网格，形状由四个角决定（投影怎么算见 cardProjection.ts）。
 * 关键的观察是：**没有被倾斜也没在翻面的卡，各层的角点在卡自己的坐标系里完全一样**——
 * 位置、旋转、缩放都由 Pixi 的世界变换负责，不进顶点。所以平放的卡可以全场共用同一批几何，
 * 一张牌都不用自己建。
 *
 * 这不是省内存的小聪明，是 6.9 那条「稳态每帧堆分配」的硬要求：一个几何连着三个 Buffer
 * 和一堆描述对象，一张卡五份、开局一次发八张，摊到发牌那一百来帧上就直接顶穿上限。
 * 而真正需要自己一份的只有此刻正被指针倾斜、或者正在翻面的那一两张（见 CardSprite 的
 * takeOwnGeometry）。
 *
 * 共用的那批只在建卡时读、之后谁都不许改：CardSprite 在"还是平放"时会跳过整个投影，
 * 那是这条约定唯一的保障。
 */

import { PerspectivePlaneGeometry } from 'pixi.js'
import { CardProjector, type Corners, createCorners } from './cardProjection'

/** 一层在卡的坐标系里占的矩形。 */
export interface LayerRect {
  x: number
  y: number
  width: number
  height: number
}

/** 网格的细分格数（横向、纵向的顶点数）。 */
export interface MeshVertices {
  x: number
  y: number
}

/** 角度全是 0 的投影器，拿来算"平放"时的四个角。它的角度从头到尾不动。 */
const flat = new CardProjector()
const scratch: Corners = createCorners()

/**
 * 平放时全场共用的那批几何，按"矩形 + 细分 + 是否镜像"归类。
 *
 * 细分必须和这张卡以后自己那份一模一样，不能因为"平放不需要透视校正"就省成四个角。
 * 试过，画面当场坏掉：Pixi 的 BatchableMesh 把「按纹理矩阵换算过的 UV」缓存在自己身上，
 * 缓存有效性只看几何 UV 缓冲的 _updateID 和纹理矩阵的 _updateID。换几何时这两个 id
 * 很容易和上一份撞上（都是刚建好、各自只更新过一次），于是四顶点那份的旧 UV 被当成
 * 十顶点新几何的 UV 接着用——数组短了一截，后面的顶点取到 undefined，
 * 图集里的卡面就整张采空，卡变成一块黑的（边框铭牌那种非图集纹理不受影响，
 * 它们的纹理矩阵是简单矩阵，压根不走这条缓存）。
 * 顶点数一致时旧 UV 恰好等于新 UV，这条缓存撞了也没事，所以两边必须同一个细分。
 */
const shared = new Map<string, PerspectivePlaneGeometry>()

function keyOf(rect: LayerRect, vertices: MeshVertices, mirrored: boolean): string {
  return `${rect.x},${rect.y},${rect.width},${rect.height}|${vertices.x}x${vertices.y}|${mirrored}`
}

/**
 * 建一份自己的几何，初值是平放的姿态。
 * 卡第一次真的要投影（被倾斜、或者开始翻面）时才走这条路。
 */
export function newLayerGeometry(
  rect: LayerRect,
  vertices: MeshVertices,
  mirrored: boolean,
): PerspectivePlaneGeometry {
  const geometry = new PerspectivePlaneGeometry({
    width: rect.width,
    height: rect.height,
    verticesX: vertices.x,
    verticesY: vertices.y,
  })
  flat.project(rect.x, rect.y, rect.width, rect.height, scratch, mirrored)
  geometry.setCorners(...scratch)
  return geometry
}

/**
 * 取平放时共用的那一份，没有就建一份留着。
 *
 * 缓存不设上限也不清理：键是由卡面几何和文字纹理尺寸决定的，一副牌里最多几十种，
 * 而且建一次之后整局都在用。反过来说，**拿到手的几何绝对不能改**，
 * 改了就是把全场的平放卡一起改了。
 */
export function sharedFlatGeometry(
  rect: LayerRect,
  vertices: MeshVertices,
  mirrored: boolean,
): PerspectivePlaneGeometry {
  const key = keyOf(rect, vertices, mirrored)
  const hit = shared.get(key)
  if (hit !== undefined) return hit
  const geometry = newLayerGeometry(rect, vertices, mirrored)
  shared.set(key, geometry)
  return geometry
}
