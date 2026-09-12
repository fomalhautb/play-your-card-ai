/**
 * 过度绘制那对「换外观 / 还原」的单测（src/page/overdraw.ts）。
 *
 * 这一步是纯场景图操作，不碰 WebGL，所以能在 node 里跑；真正的渲染和读回归
 * Playwright 那边（tests/deterministic.spec.ts）。这里盯的是最容易悄悄坏掉的两件事：
 * 带自己着色器的网格有没有被摘干净，以及还原之后场景是不是一点没变。
 *
 * 自定义着色器故意用 WGSL 的 GpuProgram 建，而不是真实场景用的 GlProgram：
 * GlProgram 的构造要建一个测试用 canvas 去查浮点精度，node 里没有 document，一建就炸。
 * 这里只在乎「网格身上挂没挂着色器」，挂的是哪种程序无所谓。
 */

import {
  Container,
  GpuProgram,
  Graphics,
  Mesh,
  PerspectivePlaneGeometry,
  Shader,
  Sprite,
  Texture,
  TextureSource,
  TilingSprite,
} from 'pixi.js'
import { describe, expect, it } from 'vitest'
import { restoreAfterOverdraw, swapForOverdraw } from '../src/page/overdraw'

/** 一段能过 WGSL 解析的最小程序。内容不重要，有它才能建出「自带着色器」的网格。 */
const WGSL = /* wgsl */ `
@vertex
fn main(@location(0) aPosition: vec2<f32>) -> @builtin(position) vec4<f32> {
    return vec4<f32>(aPosition, 0.0, 1.0);
}
`

/** 只在内存里量尺寸，不上传任何像素——单测不需要真纹理。 */
function sizedTexture(width: number, height: number): Texture {
  return new Texture({ source: new TextureSource({ width, height, resolution: 1 }) })
}

function quad(): PerspectivePlaneGeometry {
  // 顶点数和真实卡牌一样是 5×2，远在 Pixi「不超过 100 个顶点才进合批」的门槛以内。
  return new PerspectivePlaneGeometry({ width: 150, height: 225, verticesX: 5, verticesY: 2 })
}

/**
 * 一棵覆盖了各类节点的小树，形状照着真实场景摆：
 * 会染色的容器 → 靠 scale 撑大的精灵、普通贴图网格、带自己着色器的网格、
 * 一块图形、一个换不掉外观的平铺精灵，以及一个藏起来的精灵。
 */
function buildTree() {
  const white = sizedTexture(1, 1)

  const root = new Container()
  root.tint = 0xff8800
  root.alpha = 0.5
  root.blendMode = 'normal'

  const sprite = new Sprite(sizedTexture(64, 96))
  sprite.width = 150
  sprite.height = 225

  const plainMesh = new Mesh({ geometry: quad(), texture: sizedTexture(150, 225) })

  const glareMesh = new Mesh({
    geometry: quad(),
    shader: new Shader({
      gpuProgram: new GpuProgram({
        vertex: { source: WGSL, entryPoint: 'main' },
        fragment: { source: WGSL, entryPoint: 'main' },
      }),
    }),
  })
  glareMesh.blendMode = 'screen'
  glareMesh.alpha = 0.4

  const graphics = new Graphics().rect(0, 0, 4, 4).fill(0xff0000)

  /*
   * 换不掉外观的那一类。真实场景里这一档是 `Text`，但它要量文字、要 document，
   * node 里建不出来；平铺精灵和它一样既不是 Sprite 也不是 Mesh、更不是 Graphics，
   * 走的是同一条「只能涂 tint」的路。
   */
  const tiling = new TilingSprite({ texture: sizedTexture(8, 8), width: 16, height: 16 })

  const hidden = new Sprite(sizedTexture(32, 32))
  hidden.visible = false
  hidden.tint = 0x00ff00
  hidden.alpha = 0.25
  hidden.blendMode = 'multiply'

  root.addChild(sprite, plainMesh, glareMesh, graphics, tiling, hidden)
  return { white, root, sprite, plainMesh, glareMesh, graphics, tiling, hidden }
}

describe('swapForOverdraw', () => {
  it('带自己着色器的网格连着色器一起摘掉，摘完能进合批', () => {
    const t = buildTree()
    // Mesh 建好时会把纹理一并写进自带着色器的 texture 上，所以这个字段是有的，
    // 只是基类 Shader 的类型里没声明——这里断的正是它有没有被这趟调试渲染改掉。
    const shader = t.glareMesh.shader as (Shader & { texture?: Texture }) | null
    expect(t.glareMesh.batched).toBe(false)

    swapForOverdraw(t.root, t.white)

    // 着色器留着的话，它自己算的那点渐变 alpha 乘上 tint 的 1/255 会被四舍五入成 0，
    // 整层就白画了。摘成 null 才当普通贴图四边形算，每个像素正好加 1。
    expect(t.glareMesh.shader).toBeNull()
    expect(t.glareMesh.texture).toBe(t.white)
    expect(t.glareMesh.batched).toBe(true)
    expect(t.glareMesh.tint).toBe(0x010101)
    expect(t.glareMesh.blendMode).toBe('add')
    expect(t.glareMesh.alpha).toBe(1)
    expect(t.glareMesh.filters).toEqual([])
    // 换纹理时着色器已经摘掉了，所以原着色器身上的纹理一次都没被改过。
    expect(shader?.texture).not.toBe(t.white)
  })

  it('普通贴图网格也换白纹理，shader 本来就是 null，不受影响', () => {
    const t = buildTree()
    swapForOverdraw(t.root, t.white)
    expect(t.plainMesh.shader).toBeNull()
    expect(t.plainMesh.texture).toBe(t.white)
    expect(t.plainMesh.tint).toBe(0x010101)
  })

  it('精灵换白纹理之后宽高不变，覆盖面积才还是原来那块', () => {
    const t = buildTree()
    swapForOverdraw(t.root, t.white)
    expect(t.sprite.texture).toBe(t.white)
    expect(t.sprite.width).toBe(150)
    expect(t.sprite.height).toBe(225)
    expect(t.sprite.tint).toBe(0x010101)
    expect(t.sprite.blendMode).toBe('add')
  })

  it('中间的容器一律恢复成不染色，否则 tint 会逐层相乘', () => {
    const t = buildTree()
    swapForOverdraw(t.root, t.white)
    expect(t.root.tint).toBe(0xffffff)
    expect(t.root.blendMode).toBe('inherit')
    expect(t.root.alpha).toBe(1)
  })

  it('图形换成按包围盒填的一块实心白，还原之后画法一模一样', () => {
    const t = buildTree()
    const original = t.graphics.context
    const swap = swapForOverdraw(t.root, t.white)
    // 换过之后是另一份画法：不换的话它画出去的还是原来那些深浅不一的像素，
    // tint 1/255 乘上去四舍五入常常是 0，整块底板就从这条指标里消失了。
    expect(t.graphics.context).not.toBe(original)
    expect(t.graphics.tint).toBe(0x010101)
    expect(t.graphics.blendMode).toBe('add')
    restoreAfterOverdraw(swap)
    expect(t.graphics.context).toBe(original)
  })

  it('外观换不掉的节点计进 unswapped', () => {
    const t = buildTree()
    const swap = swapForOverdraw(t.root, t.white)
    // 只有平铺精灵一个：容器不画东西，精灵、网格、图形都换掉了，藏起来的那个根本没遍历到。
    expect(swap.unswapped).toBe(1)
    expect(t.tiling.tint).toBe(0x010101)
  })

  it('不可见的节点一点都不动', () => {
    const t = buildTree()
    const texture = t.hidden.texture
    swapForOverdraw(t.root, t.white)
    expect(t.hidden.texture).toBe(texture)
    expect(t.hidden.tint).toBe(0x00ff00)
    expect(t.hidden.alpha).toBe(0.25)
    expect(t.hidden.blendMode).toBe('multiply')
    expect(t.hidden.filters).toBeUndefined()
  })
})

describe('restoreAfterOverdraw', () => {
  it('每个节点都回到原样', () => {
    const t = buildTree()
    const before = {
      rootTint: t.root.tint,
      rootAlpha: t.root.alpha,
      rootBlend: t.root.blendMode,
      spriteTexture: t.sprite.texture,
      spriteWidth: t.sprite.width,
      spriteHeight: t.sprite.height,
      spriteTint: t.sprite.tint,
      plainTexture: t.plainMesh.texture,
      glareShader: t.glareMesh.shader,
      glareTexture: t.glareMesh.texture,
      glareBlend: t.glareMesh.blendMode,
      glareAlpha: t.glareMesh.alpha,
      graphicsTint: t.graphics.tint,
    }

    restoreAfterOverdraw(swapForOverdraw(t.root, t.white))

    expect(t.root.tint).toBe(before.rootTint)
    expect(t.root.alpha).toBe(before.rootAlpha)
    expect(t.root.blendMode).toBe(before.rootBlend)

    expect(t.sprite.texture).toBe(before.spriteTexture)
    expect(t.sprite.width).toBe(before.spriteWidth)
    expect(t.sprite.height).toBe(before.spriteHeight)
    expect(t.sprite.tint).toBe(before.spriteTint)

    expect(t.plainMesh.texture).toBe(before.plainTexture)
    expect(t.plainMesh.shader).toBeNull()

    expect(t.glareMesh.shader).toBe(before.glareShader)
    expect(t.glareMesh.texture).toBe(before.glareTexture)
    expect(t.glareMesh.blendMode).toBe(before.glareBlend)
    expect(t.glareMesh.alpha).toBe(before.glareAlpha)
    expect(t.glareMesh.batched).toBe(false)

    expect(t.graphics.tint).toBe(before.graphicsTint)

    // 原来没挂 Filter 的节点还原成空数组（存的时候就是这么记的），不是又冒出一个 Filter。
    expect(t.root.filters).toEqual([])
    expect(t.glareMesh.filters).toEqual([])
  })
})
