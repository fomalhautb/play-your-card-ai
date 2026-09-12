/**
 * 中央横幅：把「第几轮了、该谁出牌」这类轻量提示用一行大字念出来。
 *
 * 一次只显示一条。旧版在 `MatchStage` 里排了个队一条条播，那件事**不在这里**——
 * 排队和闸门归编排层（`director/banner.ts` 已经按同样的规矩排好了期），
 * 这个组件只认「现在播这一条，播 `BANNER_TOTAL_MS` 那么久」。
 *
 * 所以 `show` 是霸道的：上一条还没播完就再叫一次，上一条当场被顶掉。
 * 这符合编排层的口径——它排期时已经保证了两条横幅不会重叠，真重叠了说明排期错了，
 * 那时"后来的盖住先来的"比"两条糊在一起"好读。
 *
 * 淡入淡出的时长全部 import `director/timings.ts` 的 `BANNER_TOTAL_MS` 拆出来，
 * 不在这里抄第二份数字。三段的比例（0.3 / 0.75 / 0.35）是旧版的原样。
 *
 * 正式版简化第 4 步之二把这行字剥成**纯文字**：46px 的大字装不进素方块那三档字号，
 * 而它本来也不该有底和框（横幅就是一行喊出来的话）。所以这里自己烤一张文字纹理，
 * 和 `Box` 一样**不指定字体**，用 Pixi 的默认字体——这一版不做字体选型。
 */

import { Container, Sprite, TextStyle } from 'pixi.js'
import { BANNER_TOTAL_MS } from '../director/timings'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { BOX_INK } from './Box'

/**
 * 横幅那行字的字号和字距（px）。来源：黑客松版 styles.css 的 `.battle__banner`
 *（46px / 0.28em，乘开就是 12.88）。一行最多 860 宽，抄 `.battle__banner-slot`。
 */
const FONT_SIZE = 46
const LETTER_SPACING = 12.88
const MAX_WIDTH = 860

/** 这一行字的样式，全局缓存一份（同 Box 的 styleOf）。 */
const STYLE = new TextStyle({
  fontSize: FONT_SIZE,
  letterSpacing: LETTER_SPACING,
  fontWeight: '700',
  fill: BOX_INK,
})

/**
 * 淡入 / 停留 / 淡出三段各占总时长的多少。
 *
 * 旧版是三个各自独立的常量（0.3 / 0.75 / 0.35 秒），timings 那边只导出了它们的和
 *（`BANNER_TOTAL_MS`）——编排层排期只需要总长。这里按原来的比例拆回去，
 * 于是改 timings 里那一条，三段会一起等比例变，节奏不会走样。
 */
const PHASE = { in: 0.3 / 1.4, hold: 0.75 / 1.4, out: 0.35 / 1.4 } as const
/** 进场从多小弹到原大、退场再涨到多大。抄旧版的 `scale 0.86 → 1 → 1.05`。 */
const SCALE = { from: 0.86, to: 1.05 } as const

export interface BannerDeps {
  text: TextTextureCache
  animator: Animator
}

export class Banner extends Container {
  private readonly deps: BannerDeps
  /** 当前那条。播完自己销毁，所以平时这里是 null。 */
  private current: Sprite | null = null

  constructor(deps: BannerDeps) {
    super()
    this.deps = deps
    this.label = 'banner'
    // 横幅盖在战场正上方，吃了指针事件下面就点不着了（旧版同样是纯显示）。
    this.eventMode = 'none'
  }

  /**
   * 播一条：淡入 → 停留 → 淡出。返回整段时长（毫秒），和 `banner` cue 的 `durationMs` 一致。
   *
   * 原点在横幅的中心，调用方把它摆在屏幕上想要的位置（旧版是"去掉左侧栏之后那块的
   * 水平中点、纵向 24% 处"，那是版式的事，归场景）。
   */
  show(text: string): number {
    this.clear()
    const texture = this.deps.text.get(`banner|${text}`, text, STYLE)
    const label = new Sprite(texture)
    label.anchor.set(0.5)
    // 太长就整体缩一档，不换行也不裁字：横幅只有一行高。
    const fit = Math.min(1, MAX_WIDTH / texture.width)
    label.alpha = 0
    label.scale.set(SCALE.from * fit)
    this.current = label
    this.addChild(label)

    const total = BANNER_TOTAL_MS / 1000
    /*
     * 收尾时要认一下"当前那条还是不是我"：这条还没播完就被下一条顶掉的话，
     * `this.current` 已经换人了，不认的话这一下会把刚上来的那条收掉。
     */
    const timeline = this.deps.animator.timeline({
      onComplete: () => {
        if (this.current === label) this.clear()
      },
    })
    timeline.to(label, { alpha: 1, duration: total * PHASE.in, ease: 'back.out(1.6)' }, 0)
    timeline.to(
      label.scale,
      { x: fit, y: fit, duration: total * PHASE.in, ease: 'back.out(1.6)' },
      0,
    )
    const outAt = total * (PHASE.in + PHASE.hold)
    timeline.to(label, { alpha: 0, duration: total * PHASE.out, ease: 'power2.in' }, outAt)
    timeline.to(
      label.scale,
      {
        x: SCALE.to * fit,
        y: SCALE.to * fit,
        duration: total * PHASE.out,
        ease: 'power2.in',
      },
      outAt,
    )
    return BANNER_TOTAL_MS
  }

  /**
   * 当场收掉正在播的那条。
   * 对局中断时编排层会发 `clear-overlays`，那一下要把所有还立着的过场收干净。
   */
  clear(): void {
    if (this.current === null) return
    this.deps.animator.killTweensOf(this.current)
    this.deps.animator.killTweensOf(this.current.scale)
    // 纹理归缓存共用，销毁精灵时不能跟着收（同 Box.setLabel）。
    this.current.destroy({ texture: false, textureSource: false })
    this.current = null
  }
}
