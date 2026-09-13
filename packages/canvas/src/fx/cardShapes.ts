/**
 * 卡面本身那几张预烤纹理的画法：边框羽化带、卡下的软阴影、兜底文字层的渐变遮罩、
 * 问号圆章、对手的隐藏牌背。
 *
 * 和 `badgeShapes.ts` 的分界：那边是**徽章**（费用圆章、角标），界面上单独也会用；
 * 这边这几样只长在卡上，别处不会出现。两边都只画形状，烤成纹理的时机在 `bakedTextures.ts`。
 *
 * 为什么全都要烤成纹理而不是直接挂 Graphics：纪律 3.1 不许挂 Filter，所以羽化、阴影这类
 * 软边只能靠一张自带渐变的纹理；纪律 3.9 要求合批别被打断，而 Graphics 每换一次几何
 * 就是一次单独绘制，十几张牌各画一份就是十几次。烤成**全场共享的一张**之后，
 * 所有卡的同一层能合进同一批，屏幕上多摆一张牌不会多一张纹理。
 *
 * 软边一律用「一圈套一圈的纯色，逐圈降透明度」堆出来，不用 Graphics 的渐变填充：
 * 那条路在不同后端上的插值不完全一致（4.4 要求各浏览器一样），而一堆纯色形状是确定的。
 */

import { Graphics } from 'pixi.js'
import { CARD_HEIGHT, CARD_RADIUS, CARD_WIDTH } from '../layout/fanMath'
import { paintCardPlaque } from './cardPlaque'
import { PALETTE } from './colors'
import { type Mold, mold } from './mold'

/**
 * 只有这张牌背用得到的两个颜色。
 *
 * 夜色圆章的底在旧样式里连着透明度写（`rgb(20 17 12 / 78%)`），Pixi 的 fill 和 alpha 分开，
 * 所以拆成两项。来源：黑客松版 styles.css 的 .card-help-mark。
 * 墨蓝是对局界面的那一档，这里只有对手牌背上那枚纹章在用。
 * 来源：styles.css 的 .battle --battle-navy。
 */
const SEAL_BASE = { color: '#141110', alpha: 0.78 } as const
const BATTLE_NAVY = '#253149'

/**
 * 白边内侧那圈羽化带的基准宽度（卡面基准尺寸下的像素）。
 *
 * 黑客松版写的是 `4.7cqw`——按卡宽取的百分比，150 宽的卡上正好 7px（styles.css 的
 * `--card-edge-feather`）。这里烤的纹理本来就跟着卡一起缩放，所以直接取那个 7。
 */
const FEATHER = 7
/**
 * 羽化带一共向内铺多少像素。
 *
 * 黑客松那两层 inset 阴影里，宽的那层是「扩散 7px 之后再模糊 16.8px」，
 * 加起来 23.8 就是它彻底消失的地方，取整成 24。再往里画纯属白烤像素。
 */
const FEATHER_DEPTH = Math.ceil(FEATHER + FEATHER * 2.4)

/**
 * 卡下那团软阴影，抄黑客松 `.card-face` 的 `box-shadow: 0 10px 24px rgb(0 0 0 / 45%)`。
 *
 * `blur` 同时也是阴影往四周探出去多少：纹理要比卡大出这么一圈才装得下化开的边。
 */
export const CARD_SHADOW = { blur: 24, offsetY: 10, alpha: 0.45 } as const
/** 阴影一共分几圈化开。24 像素上 12 圈已经看不出台阶，再多只是白画。 */
const SHADOW_RINGS = 12

/**
 * 没有专属原画时，卡底那层渐变遮罩有多高（卡面基准尺寸下的像素）。
 *
 * 黑客松那层的高度是被内容撑出来的（`.card-face__body` 的 padding 26/10/9 加三行文字），
 * 这里的文字是烤好的纹理、撑不动父级，所以按那一版的实测高度写死。
 */
export const CARD_BODY_HEIGHT = 118
/** 渐变分几条横带。40 条在 118px 上每条不到 3px，看不出分界。 */
const BODY_BANDS = 40

/** 问号圆章的模具直径。用的时候会缩到 22，按 64 烤在高分屏上也够。 */
const SEAL_SIZE = 64

/**
 * 雕花匾那一档的边框纹理按渲染倍率的几倍烤。
 *
 * 匾在卡面上只有 120 宽，而放大查看时会被拉到约 400 个设备像素（2.2 倍 × 渲染倍率 1.5）。
 * 按一倍烤只有 180，拉上去糊；两倍是 360，和那个上限差得已经看不出来了。
 * 再往上调要先看常驻纹理内存（6.9 那条按平方涨）。
 */
const PLAQUE_CHROME_RESOLUTION = 2

/**
 * 卡面的边框：1px 米白实线，内侧再压两层羽化带；`plaque` 为真时顺带把那块八角雕花匾
 * 也画进同一张纹理。
 *
 * 边线、羽化带、卡面底色在黑客松那边是同一个颜色（`--card-edge-tint`），
 * 三者一致，白边和插画之间才没有一条硬邦邦的接缝。
 *
 * 羽化是拿「一圈 1px 宽的描边」一层层往里画出来的，每圈各有自己的透明度，圈与圈不重叠，
 * 所以某一圈画多少透明度，屏幕上就是多少——不用去算叠加。透明度按黑客松那两层
 * inset 阴影合成：窄而实的一层贴着白边收口，宽而淡的一层把过渡拖长。
 *
 * 匾为什么和边框合成一张而不是自己一层：它每张牌都一样、位置也一样，本来就属于
 * 「每张牌都有的那一层」；更硬的理由是过度绘制（3.2）按包围盒算，单独一层就是在整张原画
 * 之上再铺一块卡面 13% 大的实心，构筑页一屏二三十张卡加起来直接顶穿预算。
 * 分成两张纹理（有匾 / 没匾）而不是一张：技能牌的原画已经把卡名和效果印进图里了，
 * 再盖一块匾会把画面压死。
 */
export function drawCardChrome(plaque: boolean): Mold {
  const g = new Graphics()
  const edge = PALETTE.cardEdgeTint
  /*
   * 描边画在内侧半个线宽的位置，描边的**外沿**才正好落在卡的轮廓上；
   * 圆角跟着一起往里缩半个线宽。原画和牌背的圆角是构建期烤进 alpha 的
   *（见 assets/build-atlas.mjs），两边对不上就会露出一小段直角。
   */
  g.roundRect(0.5, 0.5, CARD_WIDTH - 1, CARD_HEIGHT - 1, CARD_RADIUS - 0.5).stroke({
    width: 1,
    color: edge,
    alpha: 0.92,
  })
  for (let d = 1; d <= FEATHER_DEPTH; d += 1) {
    // d 是离卡边缘多少像素；两层各自的扩散段是满透明度，出了扩散段再按模糊半径线性收。
    const near = 0.62 * falloff(d - 1, FEATHER / 3.5, FEATHER)
    const far = 0.3 * falloff(d - 1, FEATHER, FEATHER * 2.4)
    // 两层阴影是叠加上去的，合成透明度按"都没挡住的概率"算。
    const alpha = 1 - (1 - near) * (1 - far)
    if (alpha <= 0) break
    g.roundRect(
      d + 0.5,
      d + 0.5,
      CARD_WIDTH - 2 * d - 1,
      CARD_HEIGHT - 2 * d - 1,
      Math.max(0, CARD_RADIUS - d - 0.5),
    ).stroke({ width: 1, color: edge, alpha })
  }
  if (plaque) paintCardPlaque(g)
  return mold(CARD_WIDTH, CARD_HEIGHT, g, plaque ? PLAQUE_CHROME_RESOLUTION : undefined)
}

/** 扩散段内是 1，出了扩散段按模糊半径线性收到 0。 */
function falloff(distance: number, spread: number, blur: number): number {
  if (distance <= spread) return 1
  const t = 1 - (distance - spread) / blur
  return t < 0 ? 0 : t
}

/**
 * 卡下那团软阴影。
 *
 * 画法是一圈套一圈的黑色圆角矩形，从最外面那圈开始画、每圈都半透明，叠出来就是化开的边。
 * 每圈的透明度取同一个小值，叠 N 层之后正好到 `shadow.alpha`：
 * 一个点被几圈盖住取决于它离卡轮廓多远，于是越靠近卡越黑，自然就成了渐变。
 *
 * 纹理不带 `offsetY`——那是摆的时候往下挪，不是画进纹理里的。
 * 画进去的话纹理上半截就白留一条空，等于多传一片透明像素。
 *
 * @param shadow 哪一档阴影。不给就是卡牌那一档（`CARD_SHADOW`）；选英雄页的人物卡另有一档
 *   更浅更紧的（见 scenes/hero/heroCard.ts 的 `HERO_SHADOW`），所以这里收参数而不是读常量。
 */
export function drawCardShadow(
  shadow: { blur: number; offsetY: number; alpha: number } = CARD_SHADOW,
): Mold {
  const { blur } = shadow
  const g = new Graphics()
  // 叠 SHADOW_RINGS 层同样透明度的黑，合起来正好是目标透明度。
  const step = 1 - (1 - shadow.alpha) ** (1 / SHADOW_RINGS)
  for (let i = SHADOW_RINGS; i >= 1; i -= 1) {
    const grow = (blur * i) / SHADOW_RINGS
    g.roundRect(
      blur - grow,
      blur - grow,
      CARD_WIDTH + grow * 2,
      CARD_HEIGHT + grow * 2,
      CARD_RADIUS + grow,
    ).fill({ color: 0x000000, alpha: step })
  }
  return mold(CARD_WIDTH + blur * 2, CARD_HEIGHT + blur * 2, g)
}

/**
 * 没有专属原画时压在卡底的那层渐变遮罩（黑客松 `.card-face__body` 的背景）。
 *
 * 只有查不到原画的牌才用得上——42 张正式卡各有一张自己的图，所以画面上正常看不到它。
 * 留着是因为图集缺一帧时它比"一张糊着牌背的空卡"好认，缺谁一眼就能读出来。
 *
 * 渐变按黑客松那三个色标（底部 92%、45% 处 86%、顶部 0%）分成横带铺，理由同文件头。
 */
export function drawCardBody(): Mold {
  const g = new Graphics()
  const band = CARD_BODY_HEIGHT / BODY_BANDS
  /*
   * 每一条都是「从自己这儿一直铺到底」的矩形，后一条压在前一条上面，所以某一行的
   * 最终透明度是前面所有条叠出来的。条与条之间**不留缝也不重叠半个像素**——
   * 早先按「各画各那一条」画，相邻两条在边界上重合半像素，叠出来是一道道横纹。
   *
   * 每条自己的透明度由"叠到这儿应该是多少"反推：还剩多少没挡住（remaining）乘上
   * 这一条要再挡掉的比例，就是它该写的 alpha。
   */
  let remaining = 1
  for (let i = 1; i <= BODY_BANDS; i += 1) {
    // t = 0 是这一层的顶（全透明），t = 1 是卡的底边。色标抄黑客松那三档。
    const t = i / BODY_BANDS
    const target = t < 0.55 ? (t / 0.55) * 0.86 : 0.86 + ((t - 0.55) / 0.45) * 0.06
    const next = 1 - target
    const alpha = remaining <= 0 ? 0 : 1 - next / remaining
    remaining = next
    if (alpha <= 0) continue
    const top = (i - 1) * band
    g.rect(0, top, CARD_WIDTH, CARD_BODY_HEIGHT - top).fill({ color: 0x090806, alpha })
  }
  return mold(CARD_WIDTH, CARD_BODY_HEIGHT, g)
}

/**
 * 「看背面」的问号圆章：一枚夜色实心圆加一圈米线，圆里那个问号由调用方另贴一张文字纹理。
 *
 * 和界面上那枚（`components/Badge.ts` 的问号章）长得一样但不是同一个对象：
 * 卡面的每一层都要过透视投影、是四边形网格（见 CardSprite 的文件头），
 * 而 Badge 是普通容器，挂到卡上就没有近大远小了。这里把底和圈烤成**一张**，
 * 卡上因此只多一层网格——Badge 那边分两层是为了底色和圈色能分别上色，卡上不需要。
 */
export function drawCardSeal(): Mold {
  const r = SEAL_SIZE / 2
  const width = SEAL_SIZE * 0.045
  const g = new Graphics()
  g.circle(r, r, r).fill({ color: SEAL_BASE.color, alpha: SEAL_BASE.alpha })
  g.circle(r, r, r - width).stroke({ width, color: PALETTE.sealMark })
  return mold(SEAL_SIZE, SEAL_SIZE, g)
}

/** 对手隐藏牌背上那枚藏青纹章占卡宽的多少，以及它的上限。抄 `.card-back-hidden__crest`。 */
const CREST = { ratio: 0.58, max: 76, viewBox: 64 } as const

/**
 * 对手手牌的隐藏牌背：米白纸底 + 内圈细边 + 一枚藏青纹章，一个字的牌面信息都不带。
 *
 * 用浅色而不是藏青底，是因为这张牌背只出现在深蓝色的战场上：同为深色的话对比度太低，
 * 倒挂在顶栏下的那截几乎看不出是牌。反过来用米白，牌背就是战场上最亮的一块。
 *
 * 它是**一张全场共享的纹理**，对手有几张牌都只占一张——正因如此这里可以把纸底、
 * 内边、纹章一次画全，不像逐张上色的那些零件要拆层。
 * 黑客松那道手绘抖动滤镜不做：纪律 3.1 不挂 Filter。
 */
export function drawFoeBack(): Mold {
  const g = new Graphics()
  const navy = BATTLE_NAVY
  g.roundRect(0, 0, CARD_WIDTH, CARD_HEIGHT, CARD_RADIUS).fill({
    color: PALETTE.battlePaperShade,
  })
  /*
   * 纸面中间那块亮一点的椭圆光，抄 `radial-gradient(ellipse at 50% 32%, …)`。
   * 同样是一圈套一圈叠出来的：外圈淡、内圈实，叠到中心接近满。
   */
  const rings = 10
  const step = 0.22
  for (let i = rings; i >= 1; i -= 1) {
    const t = i / rings
    g.ellipse(CARD_WIDTH / 2, CARD_HEIGHT * 0.32, CARD_WIDTH * 0.76 * t, CARD_HEIGHT * 0.76 * t)
    g.fill({ color: PALETTE.battlePaper, alpha: step })
  }
  g.roundRect(0.5, 0.5, CARD_WIDTH - 1, CARD_HEIGHT - 1, CARD_RADIUS - 0.5).stroke({
    width: 1,
    color: navy,
    alpha: 0.62,
  })
  // 内圈细边，纯装饰：让牌背有"压了一道边"的层次，不至于是一整块平色。
  g.roundRect(9, 9, CARD_WIDTH - 18, CARD_HEIGHT - 18, CARD_RADIUS - 1).stroke({
    width: 1,
    color: navy,
    alpha: 0.24,
  })

  const size = Math.min(CARD_WIDTH * CREST.ratio, CREST.max)
  const scale = size / CREST.viewBox
  g.save()
  g.setTransform(scale, 0, 0, scale, (CARD_WIDTH - size) / 2, (CARD_HEIGHT - size) / 2)
  // 三层都按 64 的画布写，和黑客松那份 SVG 逐点对得上；线宽跟着 setTransform 一起缩。
  g.poly([32, 3, 51, 12, 61, 32, 51, 52, 32, 61, 13, 52, 3, 32, 13, 12], true)
  g.stroke({ width: 1.4, color: navy, alpha: 0.72 })
  g.poly([32, 15, 49, 32, 32, 49, 15, 32], true)
  g.stroke({ width: 0.9, color: navy, alpha: 0.72 * 0.7 })
  g.poly([32, 21, 35.6, 28.4, 43, 32, 35.6, 35.6, 32, 43, 28.4, 35.6, 21, 32, 28.4, 28.4], true)
  g.fill({ color: navy, alpha: 0.78 })
  g.restore()
  return mold(CARD_WIDTH, CARD_HEIGHT, g)
}
