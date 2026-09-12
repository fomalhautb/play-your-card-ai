/**
 * 一张卡的正面和背面由哪几层组成：每层占哪块矩形、贴哪张纹理、上什么色。
 *
 * 只算**清单**，不建任何显示对象——怎么把一层变成四边形网格、怎么投影，全在 CardSprite 里。
 * 拆出来是因为「卡面长什么样」和「卡面怎么画」是两件会各自演化的事：
 * 前者跟着设计稿改（黑客松版那套三档铭牌），后者跟着性能纪律改（共用几何、投影、合批）。
 * 混在一起的话 CardSprite 会长到四百行以上，而且每次调排版都要在投影代码中间找位置。
 *
 * 三档卡面（照黑客松 `ui/HandFan.tsx` 的 `HandCardFace` 分支）：
 * 1. **具名 AI 牌**——有专属原画，卡面下部压一块八角雕花匾，印技能名和模型名，左上盖费用章；
 * 2. **技能牌**——原画已经把卡名和效果印进图里了，只补一枚费用章盖住原画上那枚旧价；
 * 3. **查不到原画的牌**——退回一层渐变遮罩，印名字、描述和卡种色。
 * 正式的 42 张牌各有一张原画，所以第 3 档在真对局里看不到，是图集缺帧时的兜底。
 *
 * 卡面上的文字**一律烤成白色再 tint**：同一句话在不同颜色下只占一张纹理，
 * 屏幕上多摆一张牌不会多一张文字纹理（3.9 那条计数器实际量的就是纹理条数）。
 */

import { tokens } from '@ai-duel/design'
import { TextStyle, type Texture } from 'pixi.js'
import { COST_BADGE_SIZE, COST_BADGE_TEXT, DEFAULT_COST_BADGE_CENTER } from '../fx/badgeShapes'
import type { BakedTextures } from '../fx/bakedTextures'
import { CARD_PLAQUE } from '../fx/cardPlaque'
import { CARD_BODY_HEIGHT } from '../fx/cardShapes'
import { hexToInt, mix } from '../fx/colors'
import { CARD_HEIGHT, CARD_WIDTH } from '../layout/fanMath'
import type { TextTextureCache } from '../runtime/textCache'
import type { LayerRect } from './cardGeometry'

/**
 * 文字纹理按显示尺寸的几倍烤。
 *
 * 2 倍是「缩小采样不糊、又不白占显存」的常用档：卡面最大会被放到 2.2 倍
 *（放大查看）再乘 1.5 的渲染倍率，按两倍烤出来的纹理到那时正好够用；
 * 而在手牌那个尺寸上是两倍降采样，边缘比 1:1 烤还干净。
 */
const TEXT_SUPERSAMPLE = 2

/** 卡面上一层的贴图：纹理 + 可选的上色和透明度。 */
interface FacePart {
  texture: Texture
  tint?: number
  alpha?: number
}

/** 卡面上的一层：一块矩形，上面叠一到几张贴图（矩形一样的几层共用一份几何）。 */
export interface FaceLayer {
  rect: LayerRect
  /** 网格细分档：整张卡那么大的层要横向多切几刀，小件四个角就够。 */
  mesh: 'card' | 'small'
  parts: FacePart[]
}

/** 建一张卡的层清单要的东西。纹理和文字缓存由调用方给——canvas 不管资源从哪来。 */
export interface FacePartsDeps {
  baked: BakedTextures
  text: TextTextureCache
  /** 这一档要不要卡下的投影（见 fx/effectTier.ts 的 `TierConfig.cardShadow`）。 */
  shadow: boolean
}

/** 一张卡的展示数据里和"卡面长什么样"有关的那部分。字段说明见 CardSprite 的 `CardVisual`。 */
export interface FaceContent {
  name: string
  cost: number
  face: Texture
  accent: number
  skillName?: string
  costCenter?: { x: number; y: number }
  body?: { text: string; kind: string; kindInk: number }
  flippable?: boolean
}

/** 整张卡那么大的矩形（原点在底边中点，所以卡面在负 y 上）。 */
export function cardRect(): LayerRect {
  return { x: -CARD_WIDTH / 2, y: -CARD_HEIGHT, width: CARD_WIDTH, height: CARD_HEIGHT }
}

/**
 * 卡下那团投影占的矩形。
 *
 * 比卡面四周各大出一圈模糊半径，整体再往下挪 `offsetY`——和 CSS 的
 * `box-shadow: 0 10px 24px` 是同一件事。
 */
export function shadowRect(shadow: { blur: number; offsetY: number }): LayerRect {
  const { blur, offsetY } = shadow
  return {
    x: -CARD_WIDTH / 2 - blur,
    y: -CARD_HEIGHT - blur + offsetY,
    width: CARD_WIDTH + blur * 2,
    height: CARD_HEIGHT + blur * 2,
  }
}

/** 正面从下往上有哪几层。第一层（原画 + 边框）的矩形就是整张卡，反光会借它那份几何。 */
export function frontLayersOf(visual: FaceContent, deps: FacePartsDeps): FaceLayer[] {
  const layers: FaceLayer[] = [
    {
      rect: cardRect(),
      mesh: 'card',
      parts: [{ texture: visual.face }, { texture: deps.baked.cardChrome }],
    },
  ]
  if (visual.skillName !== undefined) layers.push(...plaqueLayers(visual, deps, visual.skillName))
  else if (visual.body !== undefined) layers.push(...bodyLayers(visual, deps, visual.body))
  layers.push(...costLayers(visual, deps))
  if (visual.flippable === true) layers.push(...sealLayers(deps))
  return layers
}

/** 八角雕花匾那一档：匾 + 技能名 + 模型名。 */
function plaqueLayers(visual: FaceContent, deps: FacePartsDeps, skillName: string): FaceLayer[] {
  const { width, height, top, skill, name } = CARD_PLAQUE
  /*
   * 匾上的字色跟着插画主色走（黑客松 `--card-ink` = `color-mix(accent 30%, 纸面墨色)`）。
   * 匾本身是共享纹理、颜色统一，只有这两行字逐张上色——tint 不触发重建，符合 3.10。
   */
  const ink = mix(visual.accent, 0.3, hexToInt(tokens.color.paper.ink))
  return [
    {
      rect: { x: -width / 2, y: -top, width, height },
      mesh: 'small',
      parts: [{ texture: deps.baked.cardPlaque }],
    },
    textLayer(deps, 'plaqueSkill', skillName, skill.fontSize, 0, -top + skill.centerY, {
      maxWidth: skill.maxWidth,
      tint: ink,
    }),
    textLayer(deps, 'plaqueName', visual.name, name.fontSize, 0, -top + name.centerY, {
      maxWidth: name.maxWidth,
      tint: ink,
    }),
  ]
}

/** 兜底那一档：渐变遮罩 + 名字 + 描述 + 底栏卡种色。 */
function bodyLayers(
  visual: FaceContent,
  deps: FacePartsDeps,
  body: { text: string; kind: string; kindInk: number },
): FaceLayer[] {
  // 内边距抄黑客松 `.card-face__body` 的 `padding: 26px 10px 9px`，行距 1.4。
  const nameCenter = -CARD_BODY_HEIGHT + 26 + BODY.name / 2
  const textTop = nameCenter + BODY.name / 2 + 3
  return [
    {
      rect: {
        x: -CARD_WIDTH / 2,
        y: -CARD_BODY_HEIGHT,
        width: CARD_WIDTH,
        height: CARD_BODY_HEIGHT,
      },
      mesh: 'small',
      parts: [{ texture: deps.baked.cardBody }],
    },
    textLayer(deps, 'bodyName', visual.name, BODY.name, 0, nameCenter, {
      maxWidth: CARD_WIDTH - 20,
      tint: hexToInt(tokens.color.card.edgeTint),
    }),
    textLayer(deps, 'bodyText', clampLines(body.text), BODY.text, 0, textTop, {
      maxWidth: CARD_WIDTH - 20,
      tint: hexToInt(tokens.color.battle.paperShade),
      alpha: 0.82,
      wrapWidth: CARD_WIDTH - 20,
      // 描述有一到三行，按顶边对齐才不会因为行数不同上下乱跳。
      fromTop: true,
    }),
    textLayer(deps, 'bodyKind', body.kind, BODY.text, 0, -9 - BODY.text / 2, {
      maxWidth: CARD_WIDTH - 20,
      tint: body.kindInk,
    }),
  ]
}

/** 兜底文字层的三档字号和行距，抄 `.card-face__name / __text / __stats`。 */
const BODY = { name: 14, text: 11, line: 11 * 1.4 } as const

/**
 * 描述最多留三行。
 *
 * 黑客松那边靠 `-webkit-line-clamp: 3` 截，这里的文字是烤好的纹理、截不了，
 * 所以按字数先切一刀：卡面 130 宽、11px 的字一行装得下约 12 个汉字，三行就是 36。
 * 只有查不到原画的牌才会走到这里，切得糙一点不影响正式卡面。
 */
function clampLines(text: string): string {
  const limit = 36
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/** 费用圆章那一档：盘底（逐张上色）+ 金属圈 + 数字 + TOKEN 小字。 */
function costLayers(visual: FaceContent, deps: FacePartsDeps): FaceLayer[] {
  const center = visual.costCenter ?? {
    x: (CARD_WIDTH * DEFAULT_COST_BADGE_CENTER.x) / 100,
    y: (CARD_HEIGHT * DEFAULT_COST_BADGE_CENTER.y) / 100,
  }
  const cx = -CARD_WIDTH / 2 + center.x
  const top = -CARD_HEIGHT + center.y - COST_BADGE_SIZE / 2
  const label = String(visual.cost)
  const number = label.length > 1 ? COST_BADGE_TEXT.number.double : COST_BADGE_TEXT.number.single
  return [
    {
      rect: centered(cx, top + COST_BADGE_SIZE / 2, COST_BADGE_SIZE, COST_BADGE_SIZE),
      mesh: 'small',
      // 盘底画的是白的，按这张牌的盘底色 tint；金属圈全场一个颜色，不上色。
      parts: [
        { texture: deps.baked.costDisc, tint: visual.accent },
        { texture: deps.baked.costRings },
      ],
    },
    textLayer(deps, 'costNumber', label, number.fontSize, cx, top + number.centerY, {
      tint: hexToInt(tokens.color.paper.base),
    }),
    textLayer(
      deps,
      'costUnit',
      'TOKEN',
      COST_BADGE_TEXT.unit.fontSize,
      cx,
      top + COST_BADGE_TEXT.unit.centerY,
      {
        tint: hexToInt(tokens.color.paper.base),
      },
    ),
  ]
}

/** 问号圆章离卡的上边和右边各留多远。抄黑客松手牌上那枚的位置。 */
const SEAL_INSET = 6

/** 能翻面的牌右上角那枚问号章：底圈一层 + 问号一层。 */
function sealLayers(deps: FacePartsDeps): FaceLayer[] {
  const size = tokens.size.seal.helpMark
  const cx = CARD_WIDTH / 2 - SEAL_INSET - size / 2
  const cy = -CARD_HEIGHT + SEAL_INSET + size / 2
  return [
    {
      rect: centered(cx, cy, size, size),
      mesh: 'small',
      parts: [{ texture: deps.baked.cardSeal }],
    },
    // 问号在圆里略微偏上一点点才像印上去的；0.68 倍直径是 Badge 那边同一个比例。
    textLayer(deps, 'sealMark', '?', size * 0.68, cx, cy, {
      tint: hexToInt(tokens.color.seal.mark),
    }),
  ]
}

/** 背面只有一层：整张卡那么大的牌背。 */
export function backLayerOf(back: Texture): FaceLayer {
  return { rect: cardRect(), mesh: 'card', parts: [{ texture: back }] }
}

/** 共享的文字样式，按「字号 + 折行宽度」归类。样式一变就要重新量文字，不能每张牌各建一份。 */
const styles = new Map<string, TextStyle>()

function styleOf(fontSize: number, wrapWidth: number | undefined): TextStyle {
  const key = `${fontSize}|${wrapWidth ?? 0}`
  const hit = styles.get(key)
  if (hit !== undefined) return hit
  const style = new TextStyle({
    fontFamily: tokens.font.family.serif,
    fontSize,
    fontWeight: '600',
    // 一律烤白色，颜色靠 tint 给：同一句话在不同颜色下才只占一张纹理（见文件头）。
    fill: 0xffffff,
    align: 'center',
    ...(wrapWidth === undefined ? {} : { wordWrap: true, wordWrapWidth: wrapWidth }),
  })
  styles.set(key, style)
  return style
}

/**
 * 烤一段文字并算出它该占哪块矩形。
 *
 * 字**按显示尺寸的两倍烤**，再按比例缩回去（见 `TEXT_SUPERSAMPLE`）；
 * `maxWidth` 是这一行的上限，超了就整体压窄、既不换行也不裁字
 *（对应黑客松那段 SVG 的 `textLength`：铭牌只有一行高，换行会顶出匾外）。
 */
function textLayer(
  deps: FacePartsDeps,
  kind: string,
  content: string,
  fontSize: number,
  cx: number,
  cy: number,
  options: {
    maxWidth?: number
    tint?: number
    alpha?: number
    wrapWidth?: number
    /** 真值时 `cy` 给的是这一层的**顶边**而不是中心。行数不定的段落用它。 */
    fromTop?: boolean
  },
): FaceLayer {
  const baked = Math.max(1, Math.round(fontSize * TEXT_SUPERSAMPLE))
  const wrap = options.wrapWidth === undefined ? undefined : options.wrapWidth * TEXT_SUPERSAMPLE
  const style = styleOf(baked, wrap)
  const texture = deps.text.get(`${kind}|${baked}|${content}`, content, style)
  const scale = fontSize / baked
  let width = texture.width * scale
  let height = texture.height * scale
  const max = options.maxWidth
  if (max !== undefined && width > max) {
    height *= max / width
    width = max
  }
  const centerY = options.fromTop === true ? cy + height / 2 : cy
  return {
    rect: centered(cx, centerY, width, height),
    mesh: 'small',
    parts: [
      {
        texture,
        ...(options.tint === undefined ? {} : { tint: options.tint }),
        ...(options.alpha === undefined ? {} : { alpha: options.alpha }),
      },
    ],
  }
}

/** 以 (cx, cy) 为中心的矩形。卡上的小件都是按中心摆的，换算一次省得到处写减法。 */
function centered(cx: number, cy: number, width: number, height: number): LayerRect {
  return { x: cx - width / 2, y: cy - height / 2, width, height }
}
