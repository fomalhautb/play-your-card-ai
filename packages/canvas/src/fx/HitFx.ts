/**
 * 卡牌落地的命中特效：震屏 + 脚下扬尘 + 沿卡牌边缘跑一圈的金色追光。
 * 节奏和数值抄自旧客户端 `src/ui/playSummonFx.ts`。
 *
 * 三样都不挂 Filter（3.1）：
 * - 烟尘是一批共用同一张柔光纹理的精灵，全部合进同一个绘制批（3.9）；
 * - 追光不是 conic-gradient 而是一颗沿边框跑的光点，同样用那张柔光纹理，叠加混合；
 * - 震屏只改一个容器的 x / y。
 * 全程只动 transform、alpha、tint，不碰文字、纹理尺寸和遮罩（3.10）。
 *
 * 烟尘精灵在建场景时一次性建好、循环使用，不是每次落地现建现删——
 * 旧版 DOM 那套是"现建 div、演完 remove"，在 Pixi 里那等于每次出牌都新建一批显示对象，
 * 稳态每帧堆分配那条（3.10）过不去。
 */

import { tokens } from '@ai-duel/design'
import { type Container, Sprite } from 'pixi.js'
import type { Animator } from '../runtime/animator'
import type { Rng } from '../runtime/rng'
import type { BakedTextures } from './bakedTextures'
import { type EffectTier, TIER_CONFIG } from './effectTier'

/** 震屏里每一小段位移的时长。五段拼成一次抖动，末段翻倍收尾，全程约 0.3 秒。 */
const SHAKE_STEP = 0.05
/** 追光绕卡牌边缘跑满一圈的时长。淡入淡出都叠在这段里，所以它就是整条追光的总时长。 */
const EDGE_DUR = 0.5
/** 追光的淡入 / 淡出时长。淡入要快到几乎看不见过程，亮弧才像是"一下子亮起来就跑了"。 */
const EDGE_IN = 0.08
const EDGE_OUT = 0.16
/** 追光那颗光点画多大（长边、短边）。细长才像一小段亮弧，圆点看着像萤火虫。 */
const EDGE_COMET = { long: 46, short: 14 }

export interface HitFxOptions {
  /** 特效画在哪一层。这一层不吃指针事件，也不参与布局。 */
  layer: Container
  /** 震屏抖的是哪个容器。传整个世界根节点，抖的就是整屏。 */
  shakeTarget: Container
  animator: Animator
  baked: BakedTextures
  rng: Rng
  tier: EffectTier
}

/** 一次命中特效落在哪儿、多大范围。 */
export interface HitFxTarget {
  /** 落点中心（特效层坐标）。 */
  x: number
  y: number
  /** 落地那张卡的尺寸，追光绕着它的边跑。 */
  width: number
  height: number
}

export class HitFx {
  private readonly options: HitFxOptions
  /** 烟尘精灵池，按最高档的团数预先建好，低档只用前面几个。 */
  private readonly smoke: Sprite[] = []
  private readonly comet: Sprite

  constructor(options: HitFxOptions) {
    this.options = options
    const maxSmoke = Math.max(...Object.values(TIER_CONFIG).map((t) => t.smokeCount))
    for (let i = 0; i < maxSmoke; i += 1) {
      const puff = new Sprite(options.baked.softDot)
      puff.anchor.set(0.5)
      puff.alpha = 0
      // 灰褐色的尘，和旧版一套配色：取纸面色板里偏深的那档线色。
      puff.tint = tokens.color.battle.lineDark
      options.layer.addChild(puff)
      this.smoke.push(puff)
    }

    this.comet = new Sprite(options.baked.softDot)
    this.comet.anchor.set(0.5)
    this.comet.alpha = 0
    this.comet.tint = tokens.color.theme.gold
    this.comet.blendMode = 'add'
    options.layer.addChild(this.comet)
  }

  /**
   * 播一次落地特效。返回整段演出的时长（秒），调用方拿它排后续节奏。
   *
   * 节奏（t0 = 落地那一刻）：震屏、烟尘、边缘追光同时起，追光在 t0+0.5 收，
   * 最后一样东西（烟尘）在 t0+0.8 前后收尾。
   */
  play(target: HitFxTarget): number {
    const config = TIER_CONFIG[this.options.tier]
    if (config.screenShake) this.shake()
    // 烟尘以"卡牌底边中点"为落点：卡是砸下来的，灰是从脚下扑起来的。
    this.spawnSmoke(target.x, target.y + target.height / 2, config.smokeCount)
    if (config.edgeLight) this.runEdgeLight(target)
    return 0.8
  }

  /**
   * 整屏抖 2~3px，约 0.3 秒。
   *
   * 连着落两张牌时旧的抖动要让位，不然两条补间抢同一个 transform 会把幅度叠出去，
   * 所以起手先把这个目标身上的补间全停掉。
   */
  private shake(): void {
    const target = this.options.shakeTarget
    this.options.animator.killTweensOf(target)
    const timeline = this.options.animator.timeline({
      onComplete: () => target.position.set(0, 0),
    })
    timeline
      .to(target, { x: 3, y: -2, duration: SHAKE_STEP, ease: 'power1.inOut' })
      .to(target, { x: -2.5, y: 2, duration: SHAKE_STEP, ease: 'power1.inOut' })
      .to(target, { x: 2, y: 1.5, duration: SHAKE_STEP, ease: 'power1.inOut' })
      .to(target, { x: -1.5, y: -1, duration: SHAKE_STEP, ease: 'power1.inOut' })
      .to(target, { x: 0, y: 0, duration: SHAKE_STEP * 2, ease: 'power2.out' })
  }

  /** 落点两侧扑起来的几团灰褐色烟尘。 */
  private spawnSmoke(cx: number, cy: number, count: number): void {
    const { animator, rng } = this.options
    for (let i = 0; i < count; i += 1) {
      const puff = this.smoke[i]
      if (puff === undefined) return
      const size = 34 + rng.next() * 30
      puff.setSize(size, size)
      puff.position.set(cx, cy)
      // 按奇偶分左右，保证两边都有。纯随机方向的话经常整把灰全扑到同一侧，看着像风吹的。
      const dir = i % 2 === 0 ? -1 : 1
      animator.fromTo(
        puff,
        { alpha: 0.5, x: cx, y: cy },
        {
          x: cx + dir * (38 + rng.next() * 52),
          y: cy - (18 + rng.next() * 38),
          alpha: 0,
          duration: 0.62 + rng.next() * 0.18,
          ease: 'power2.out',
          overwrite: 'auto',
        },
      )
      animator.fromTo(
        puff.scale,
        { x: 0.45, y: 0.45 },
        {
          x: 1.5 + rng.next() * 0.7,
          y: 1.5 + rng.next() * 0.7,
          duration: 0.62,
          ease: 'power2.out',
          overwrite: 'auto',
        },
      )
    }
  }

  /**
   * 沿卡牌边缘跑一圈的金色亮弧：淡入 → 绕一圈 → 淡出。
   *
   * 匀速转（ease: 'none'）：追光要像绕着边框"跑"，带缓动的话会在某一段莫名其妙地慢下来。
   * 位置由一个 0→1 的进度代理算出来，补间本身只改这个普通对象，
   * 每帧写到精灵上的仍然只有 position 和 rotation（3.10）。
   */
  private runEdgeLight(target: HitFxTarget): void {
    const { animator } = this.options
    const progress = { t: 0 }
    const comet = this.comet
    comet.setSize(EDGE_COMET.long, EDGE_COMET.short)

    const timeline = animator.timeline({ onComplete: () => (comet.alpha = 0) })
    timeline.to(
      progress,
      {
        t: 1,
        duration: EDGE_DUR,
        ease: 'none',
        onUpdate: () => {
          const point = perimeterPoint(progress.t, target.width, target.height)
          comet.position.set(target.x + point.x, target.y + point.y)
          comet.rotation = point.angle
        },
      },
      0,
    )
    timeline.fromTo(comet, { alpha: 0 }, { alpha: 1, duration: EDGE_IN, ease: 'power2.out' }, 0)
    timeline.to(comet, { alpha: 0, duration: EDGE_OUT, ease: 'power2.in' }, EDGE_DUR - EDGE_OUT)
  }
}

/**
 * 沿一个以原点为中心、宽 w 高 h 的矩形边缘走到 t（0~1）处的位置和切线方向。
 *
 * 圆角忽略不计：光点自己是一团 46×14 的软光，比任何圆角都糊，走直角还是圆角看不出来。
 * 起点在上边中点，顺时针走。
 */
function perimeterPoint(t: number, w: number, h: number): { x: number; y: number; angle: number } {
  const half = { w: w / 2, h: h / 2 }
  const perimeter = 2 * (w + h)
  // 从上边中点起跑：这样一圈的开头和结尾都落在卡的正上方，看着最自然。
  const d = (((t % 1) + 1) % 1) * perimeter + w / 2
  const p = d % perimeter

  if (p < w) return { x: -half.w + p, y: -half.h, angle: 0 }
  if (p < w + h) return { x: half.w, y: -half.h + (p - w), angle: Math.PI / 2 }
  if (p < 2 * w + h) return { x: half.w - (p - w - h), y: half.h, angle: Math.PI }
  return { x: -half.w, y: half.h - (p - 2 * w - h), angle: -Math.PI / 2 }
}
