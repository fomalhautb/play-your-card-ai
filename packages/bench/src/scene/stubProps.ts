/**
 * 桩场景的固定物：底色、卡池、粒子、全屏发光。
 *
 * 和 stubScene.ts 分开，是为了让那边只剩「怎么演」。这里的东西全部在建场景时造一次，
 * 运行期一个都不再 new——纪律 3.5 要求动画期间文字对象不重建，卡池就是为这条准备的。
 */

import { Container, Sprite, Text, Texture } from 'pixi.js'
import type { BenchSceneOptions } from './contract'
import { BENCH_COLORS } from './palette'
import { TIERS } from './stubLayout'

export interface CardView {
  root: Container
  face: Sprite
  label: Text
  key: string
}

export interface StubProps {
  /** 铺满视口的底色。它自己也是一次绘制，过度绘制那条指标里算一层。 */
  background: Sprite
  /** 牌库里每张牌各一个，运行期只在池子里搬。 */
  cards: CardView[]
  /** 命中特效那一圈叠加混合的粒子，条数按效果档位（纪律 3.7）。 */
  particles: Sprite[]
  /** 只有 high 档有的全屏叠加发光，别的档位是 null。 */
  glow: Sprite | null
}

export function buildStubProps(opts: BenchSceneOptions): StubProps {
  return {
    background: buildBackground(opts),
    cards: buildCards(opts),
    particles: buildParticles(opts),
    glow: buildGlow(opts),
  }
}

function buildBackground(opts: BenchSceneOptions): Sprite {
  const bg = new Sprite(Texture.WHITE)
  bg.width = opts.width
  bg.height = opts.height
  bg.tint = BENCH_COLORS.paperNight
  return bg
}

/**
 * 牌库里每张牌都先建好对象放进池子，之后只在池子里搬，运行期不 new。
 * 文字尤其重要：纪律 3.5 要求文字只创建一次，动画期间 textCreated 必须纹丝不动。
 */
function buildCards(opts: BenchSceneOptions): CardView[] {
  return Object.keys(opts.textures.faces).map((key) => {
    const face = new Sprite(opts.textures.faces[key] ?? opts.textures.back)
    face.anchor.set(0.5)
    const label = new Text({
      text: key,
      style: { fontFamily: 'sans-serif', fontSize: 14, fill: BENCH_COLORS.paperBase },
    })
    label.anchor.set(0.5)
    label.y = face.height / 2 - 16
    const root = new Container()
    root.addChild(face, label)
    root.visible = false
    return { root, face, label, key }
  })
}

function buildParticles(opts: BenchSceneOptions): Sprite[] {
  const particles: Sprite[] = []
  for (let i = 0; i < TIERS[opts.tier].particles; i += 1) {
    const particle = new Sprite(Texture.WHITE)
    particle.anchor.set(0.5)
    particle.width = 14
    particle.height = 14
    particle.blendMode = 'add'
    particle.visible = false
    particles.push(particle)
  }
  return particles
}

function buildGlow(opts: BenchSceneOptions): Sprite | null {
  if (!TIERS[opts.tier].fullscreenGlow) return null
  const glow = new Sprite(Texture.WHITE)
  glow.width = opts.width
  glow.height = opts.height
  glow.tint = BENCH_COLORS.themePurple
  glow.blendMode = 'add'
  glow.visible = false
  return glow
}
