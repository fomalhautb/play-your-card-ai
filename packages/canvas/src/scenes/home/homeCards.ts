/**
 * 首页橱窗里那四张展示卡：摆成一道弧口朝上的扇面，指针停上去就抬起、放正、跟着倾斜。
 *
 * 摆的是**真卡**（卡池里四家各自的旗舰款，由装配层查好传进来），所以这里看到的名字、
 * 费用、插画和对局里抽到同一张时完全一致，不需要另维护一份占位数据。
 *
 * 抬起只做上浮、放大、回正，**不动层级**：卡与卡的遮挡一律按摆放顺序，抬起来的卡照样被
 * 右边的邻居压住——这正是设计稿要的效果（旧版 HomeScreen 同样写死）。
 * 从前压在它们上面的桌面弧和前景道具随正式版简化第 4 步一起删了。
 *
 * 抬起只给鼠标：触屏的 `pointerover` / `pointerout` 是按下和抬手那一刻发的，
 * 照做就是「按住抬起来、松手掉回去」，一闪而过，除了掉帧什么也没留下。
 */

import { Container } from 'pixi.js'
import { CardSprite, type CardSpriteDeps, type CardVisual } from '../../components/CardSprite'
import { CardTilt } from '../../components/cardTilt'
import { CARD_HEIGHT, CARD_WIDTH } from '../../layout/fanMath'
import type { Animator } from '../../runtime/animator'
import type { HomeCardSpot } from './homeLayout'

/**
 * hover 时上浮多少，写成卡高的百分比。
 * 旧版是 `CARD_LIFT_PERCENT = -9.1`：设计上想要「抬起约 1.5cqi」，换算成卡自身高度的
 * 百分比（1.5 / 16.5 ≈ 9.1%）之后就和缩放无关了，任何窗口下抬起来一样高。
 */
const LIFT_RATIO = 0.091
/** hover 放大到多少。 */
const HOVER_SCALE = 1.06
/** 上浮和落回同一个时长，来回扫动时不会一边快一边慢。抄旧版的 `CARD_HOVER_DUR`。 */
const HOVER_DUR = 0.28
/*
 * 倾斜的最大角不在这里定：`CardTilt` 全场共用手牌那一档（`HOVER_TILT_DEG = 10`），
 * 而旧版首页展示卡的 `CARD_TILT_DEG` 正好也是 10，两边本来就是同一个数。
 */

export interface HomeCardsDeps extends CardSpriteDeps {
  animator: Animator
  /** 这一档要不要跟指针倾斜（见 fx/effectTier.ts 的 `TierConfig.cardTilt`）。 */
  tilt: boolean
}

/** 一张展示卡：卡本体、它的倾斜跟随、它此刻的静止姿态。 */
interface Showcase {
  card: CardSprite
  tilt: CardTilt
  spot: HomeCardSpot
}

/**
 * 四张展示卡那一层。原点在视口左上角——每张卡的落点是版式算好的视口坐标，
 * 不像人物那样跟着画走（卡的位置本来就是从画里的百分比换算出来的）。
 */
export class HomeCards extends Container {
  private readonly deps: HomeCardsDeps
  private readonly shows: Showcase[] = []
  private hovered: CardSprite | null = null

  constructor(visuals: readonly CardVisual[], deps: HomeCardsDeps) {
    super()
    this.deps = deps
    this.label = 'home-cards'
    for (const visual of visuals) {
      const card = new CardSprite(visual, deps)
      const tilt = new CardTilt(card, deps.tilt)
      this.addChild(card)
      const show: Showcase = { card, tilt, spot: { x: 0, y: 0, rotation: 0, scale: 1 } }
      this.shows.push(show)
      this.bind(show)
    }
  }

  /** 按版式摆好四张卡。 */
  place(spots: readonly HomeCardSpot[]): void {
    this.shows.forEach((show, index) => {
      const spot = spots[index]
      if (spot === undefined) return
      show.spot = spot
      // 摆版式会把 hover 抬起的姿态一起覆盖掉，所以顺手把「谁被抬着」也清了。
      if (this.hovered === show.card) this.hovered = null
      show.card.position.set(spot.x, spot.y)
      show.card.rotation = (spot.rotation * Math.PI) / 180
      show.card.scale.set(spot.scale)
    })
  }

  /** 逐帧推进倾斜跟随。返回还有没有卡在动（帧循环靠它决定停不停，3.6）。 */
  advance(deltaMs: number): boolean {
    let busy = false
    for (const show of this.shows) {
      if (show.tilt.advance(deltaMs)) busy = true
    }
    return busy
  }

  private bind(show: Showcase): void {
    const { card, tilt } = show
    card.on('pointerover', (event) => {
      if (event.pointerType !== 'mouse') return
      this.hovered = card
      this.pose(show, true)
    })
    card.on('pointerout', (event) => {
      if (event.pointerType !== 'mouse') return
      if (this.hovered === card) this.hovered = null
      tilt.release()
      this.pose(show, false)
    })
    card.on('globalpointermove', (event) => {
      if (this.hovered !== card || event.pointerType !== 'mouse') return
      const local = card.toLocal(event.global)
      /*
       * 换算成卡面里的 0~1（左上角 0,0）。卡的原点在**底边中点**，
       * 所以横向要补半张卡宽、纵向要补一整张卡高（见 CardSprite 的坐标约定）。
       */
      tilt.setPointer(
        (local.x + CARD_WIDTH / 2) / CARD_WIDTH,
        (local.y + CARD_HEIGHT) / CARD_HEIGHT,
      )
    })
  }

  /** 抬起或落回。三条属性一起补间，时长一致。 */
  private pose(show: Showcase, lifted: boolean): void {
    const { card, spot } = show
    const { animator } = this.deps
    animator.tween(card, {
      y: lifted ? spot.y - CARD_HEIGHT * spot.scale * LIFT_RATIO : spot.y,
      rotation: lifted ? 0 : (spot.rotation * Math.PI) / 180,
      duration: HOVER_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })
    const scale = lifted ? spot.scale * HOVER_SCALE : spot.scale
    animator.tween(card.scale, {
      x: scale,
      y: scale,
      duration: HOVER_DUR,
      ease: 'power2.out',
      overwrite: 'auto',
    })
  }
}
