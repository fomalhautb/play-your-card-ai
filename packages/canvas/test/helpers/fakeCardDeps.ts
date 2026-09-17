/**
 * 造一张**真的** `CardSprite` 所需的最小依赖。
 *
 * 给「补间和销毁的时序」那类测试用（test/disposeFlip.test.ts）：那边要的是一张会真的
 * 建几何、真的在 `destroy()` 里把几何收掉的卡，画面长什么样一眼都不看。
 * 所以纹理一律给 `Texture.EMPTY`——烤纹理要 Renderer 和 GPU，Node 下起不来，
 * 而这条检查也确实不需要它们；空纹理照样能建网格、算角点、销毁几何。
 *
 * 反光层不建（`glare: false`）：它自带一份着色器，Node 下没有 GL 上下文。
 * 投影层照建（`shadow: true`）：它在卡上是**单独一组**几何，销毁时和卡面那几组一起收，
 * 留着才能盖住「卡身上不止一份几何」这条路。
 */

import { Texture } from 'pixi.js'
import { CardSprite, type CardSpriteDeps, type CardVisual } from '../../src/components/CardSprite'
import type { BakedTextures } from '../../src/fx/bakedTextures'
import type { TextTextureCache } from '../../src/runtime/textCache'

/** 烤纹理表里的键，逐条列出来是为了漏了一条就编译不过（见 fx/bakedTextures.ts 的 MOLDS）。 */
const BAKED_KEYS = [
  'softDot',
  'cardChrome',
  'cardChromePlaque',
  'cardShadow',
  'cardBody',
  'cardSeal',
  'costDisc',
  'costRings',
  'foeBack',
] as const satisfies readonly (keyof BakedTextures)[]

/** 一份全是空纹理的烤纹理表。restore / destroy 无事可做——压根没烤过东西。 */
function fakeBaked(): BakedTextures {
  const textures: Record<string, unknown> = {}
  for (const key of BAKED_KEYS) textures[key] = Texture.EMPTY
  textures.restore = () => undefined
  textures.destroy = () => undefined
  return textures as unknown as BakedTextures
}

/** 文字纹理缓存：真的那份要 Renderer，这里每次都还一张空纹理。 */
function fakeTextCache(): TextTextureCache {
  return { get: () => Texture.EMPTY } as unknown as TextTextureCache
}

function fakeCardDeps(): CardSpriteDeps {
  return { baked: fakeBaked(), text: fakeTextCache(), glare: false, shadow: true }
}

/**
 * 建一张真卡。
 *
 * 给了 `skillName`，走的是「有雕花匾」那一档：卡上因此多出几层小件、也就多出几组几何，
 * 销毁时要收的东西比光板卡多，正好是这类测试想盯住的情况。
 */
export function createTestCard(instanceId: string, deps = fakeCardDeps()): CardSprite {
  const visual: CardVisual = {
    instanceId,
    name: '测试卡',
    cost: 1,
    face: Texture.EMPTY,
    accent: 0xffffff,
    back: Texture.EMPTY,
    skillName: '测试技能',
  }
  return new CardSprite(visual, deps)
}
