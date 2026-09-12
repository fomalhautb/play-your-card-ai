/**
 * 建场景时的预热：把这一局可能用到的东西全部先过一遍 GPU。
 *
 * 为什么必须有这一步。Pixi 是**用到才传**：一张图集页要等到第一次真的画到它，
 * 才会 texImage2D 传上显存。不预热的话，第一次发牌那几帧里会夹着几次纹理上传，
 * 6.9 的「动画期间纹理上传次数 = 0」就永远过不去——而那条真正要拦的是运行期才发生的上传，
 * 不是开局的一次性装载。文字同理：卡面上的名字和费用是烤成纹理的（见 runtime/textCache.ts），
 * 烤的时候要走一次离屏渲染，那件事也必须发生在动画开始之前（3.5、3.1）。
 *
 * 做法是把这一局用得上的每张卡各建一张，正面画一遍、翻到背面再画一遍，然后拆掉。
 * 正面那遍带上全部卡面图集页和烤出来的边框圆章，背面那遍带上牌背图集页。
 * 正面那遍还顺手把两样带自己着色器的东西各画一次：卡面反光（fx/cardGlare.ts）和落地亮环
 * （fx/edgeRing.ts）。着色器是第一次真的画到才编译的，不在这里编译掉的话，玩家第一次 hover
 * 或第一次出牌会卡一帧，剧本里也会在计数窗口内多出一次编译（6.9 要求预热后为 0）。
 * 建出来的卡是一次性的：文字纹理留在缓存里（那正是要的结果），卡本身画完就销毁。
 */

import type { Container, Renderer } from 'pixi.js'
import { CardSprite, type CardSpriteDeps, type CardVisual } from '../components/CardSprite'
import type { EdgeRing } from '../fx/edgeRing'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'

/** 预热时把卡排成几列。只求都落在视口里被真的画到，排得好不好看没有意义。 */
const COLUMNS = 6
/** 预热卡的缩放。画小一点省填充率，纹理上传和文字烘焙一样都会发生。 */
const CARD_SCALE = 0.25

export interface WarmupOptions {
  renderer: Renderer
  /** 要渲染的根节点，就是场景平时渲染的那棵树。 */
  stage: Container
  /** 预热卡临时挂在哪一层。用完就摘干净。 */
  layer: Container
  /**
   * 这一局用得上的每一张卡各一份展示数据。
   *
   * 调用方按纪律 3.4 只加载了当前两副牌要的贴图，所以「有哪几张贴图」就是「这一局有哪几张牌」，
   * 场景照着卡池给出它们的卡名和费用（见 scenes/duel/cardVisuals.ts）。
   * 同一张牌给一份就够——同名的两张共用同一张卡面和同一段文字。
   */
  visuals: readonly CardVisual[]
  deps: CardSpriteDeps
  /**
   * 落地那圈亮环（见 fx/HitFx.ts 的 ring）。只为了逼它的着色器提前编译，预热完原样藏回去。
   * 低档位不建这一圈，那时传 null，这里就没什么可预热的。
   */
  ring: EdgeRing | null
  /** 视口尺寸，用来把预热卡摆在画得到的地方。 */
  width: number
  height: number
}

export function warmupScene(opts: WarmupOptions): void {
  const cards: CardSprite[] = []
  const visuals = opts.visuals
  visuals.forEach((visual, index) => {
    const card = new CardSprite(visual, opts.deps)
    const col = index % COLUMNS
    const row = Math.floor(index / COLUMNS)
    card.position.set(
      ((col + 0.5) * opts.width) / COLUMNS,
      ((row + 1) * opts.height) / (Math.ceil(visuals.length / COLUMNS) + 1),
    )
    card.scale.set(CARD_SCALE)
    // 反光平时是藏着、且完全透明的，那样不会被真的画到、着色器也就编译不了，所以手动点亮。
    // 低档位根本不建反光层（见 CardSpriteDeps.glare），那时这里就没什么可预热的。
    if (card.glare !== null) {
      card.glare.visible = true
      card.glare.alpha = 1
    }
    opts.layer.addChild(card)
    cards.push(card)
  })

  // 亮环平时是藏着、且完全透明的，那样不会被真的画到、着色器也就编译不了，所以手动点亮。
  // 量的是战场上小卡的大小，摆在视口正中：只要求真的有片元被画到，摆哪儿不影响结果。
  const ring = opts.ring
  if (ring !== null) {
    ring.setCard(CARD_WIDTH * CARD_SCALE, CARD_HEIGHT * CARD_SCALE)
    ring.position.set(opts.width / 2, opts.height / 2)
    ring.setTurn(0)
    ring.visible = true
    ring.alpha = 1
  }

  opts.renderer.render(opts.stage)
  if (ring !== null) {
    ring.visible = false
    ring.alpha = 0
  }
  // 翻到背面再画一遍：牌背是另一张图集，不翻过来它那一页要等到剧本里第一次翻牌才传。
  for (const card of cards) {
    if (card.glare !== null) {
      card.glare.visible = false
      card.glare.alpha = 0
    }
    card.setFlipAngle(180)
  }
  opts.renderer.render(opts.stage)

  for (const card of cards) {
    opts.layer.removeChild(card)
    // 纹理一张都不销毁：卡面归调用方，烤出来的文字和边框归缓存，这里只拆卡本身。
    card.destroy({ children: true, texture: false, textureSource: false })
  }
}
