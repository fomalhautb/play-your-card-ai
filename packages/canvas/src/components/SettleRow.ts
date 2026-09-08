/**
 * 结算层里的一张作答结果卡（需求单面板 K）：左边一张迷你卡面，右边模型名、回答和理由，
 * 判定块（徽章 H）盖上来，答完之前先摆三个跳动的点（条 E）。
 *
 * **打字机是用遮罩做的，不是一个字一个字换文字**。旧版靠 GSAP 的 TextPlugin 改 innerHTML，
 * 那在画布上等价于「每多一个字就烤一张新纹理」——一句十个字的答案要烤十张，
 * 3.5 那条（文字只创建一次并缓存）当场破功。这里改成整句先烤一张，
 * 再用一张白色精灵当遮罩、把它的 `scale.x` 从 0 补到 1，缓动用 `steps(字数)`：
 * 看到的仍然是一个字一个字蹦出来，而全程只有一张纹理、每帧只改一个 transform（3.10）。
 *
 * 卡由调用方建也由调用方销毁——这张迷你卡面就是那个 AI 上场时的那张牌。
 */

import { tokens } from '@ai-duel/design'
import { Container, Graphics, Sprite, Texture } from 'pixi.js'
import {
  SETTLE_ANSWER_CHAR_MS,
  SETTLE_LOADER_FADE_MS,
  SETTLE_REASONING_CHAR_MS,
  SETTLE_REASONING_MAX_MS,
  SETTLE_STAMP_MS,
} from '../director/timings'
import type { UiTextures } from '../fx/uiTextures'
import { CARD_WIDTH } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Badge } from './Badge'
import type { CardSprite } from './CardSprite'
import { Label } from './Label'

/**
 * 这张卡自己的几何和字号（px）。组件私有，理由见 design 的 README。
 * 来源：需求单面板 K（444×154、padding 14、头像 77×116、回答 30px/700、模型名 18px）
 * 和徽章 H 的字号（20px/700）。徽章 H 那条上量到的 172×110 没有采用，理由见 VERDICT。
 */
const BOX = { width: 444, height: 154, pad: 14, avatarWidth: 77, gap: 14 } as const
const TYPE = {
  name: { fontSize: 18, letterSpacing: 0 },
  answer: { fontSize: 30, letterSpacing: 0, weight: '700' },
  reasoning: { fontSize: tokens.font.size.base, letterSpacing: 0 },
  verdict: { fontSize: 20, letterSpacing: 1.2, weight: '700' },
} as const
/**
 * 判定块的内边距、离卡角多远、盖下来时的起始缩放和倾角。
 * 抄旧样式 `.settle-card__verdict`（padding 8px 18px、top/right 8、rotate −6deg）
 * 和 `VERDICT_TILT_DEG`。宽高不写死，跟着字走——理由见 buildVerdict。
 */
const VERDICT = { padX: 18, padY: 8, inset: 8, fromScale: 1.6, tiltDeg: -6 } as const
/** 「保送留场」那条小签离卡上沿多远。抄旧样式 `.settle-card__safe` 的 `top: 52px`。 */
const SAFE_TOP = 52
/** 三个等待点的直径、间距和跳多高。 */
const LOADER = { dot: 7, gap: 7, rise: 6, dur: 0.45 } as const

export interface SettleRowDeps {
  /** 「保送留场」那枚小签走 Badge D，它要预烤的药丸纹理。 */
  ui: UiTextures
  text: TextTextureCache
  animator: Animator
}

export class SettleRow extends Container {
  readonly rowId: string
  readonly boxWidth = BOX.width
  readonly boxHeight = BOX.height

  private readonly deps: SettleRowDeps
  private readonly loader = new Container()
  private readonly answerSlot = new Container()
  private readonly reasoningSlot = new Container()
  private readonly verdictSlot = new Container()
  private readonly safeSlot = new Container()

  constructor(rowId: string, name: string, card: CardSprite, deps: SettleRowDeps) {
    super()
    this.rowId = rowId
    this.deps = deps
    this.label = `settle-row:${rowId}`
    this.eventMode = 'none'

    this.addChild(this.buildPlate())
    this.addChild(this.mountAvatar(card))
    const bodyX = BOX.pad + BOX.avatarWidth + BOX.gap
    const nameLabel = new Label(
      name,
      { ...TYPE.name, align: 'left', maxWidth: BOX.width - bodyX - BOX.pad },
      deps,
      tokens.color.battle.inkMuted,
    )
    nameLabel.position.set(bodyX, BOX.pad + 10)
    this.answerSlot.position.set(bodyX, BOX.pad + 48)
    this.reasoningSlot.position.set(bodyX, BOX.pad + 84)
    this.buildLoader(bodyX)
    this.addChild(
      nameLabel,
      this.answerSlot,
      this.reasoningSlot,
      this.loader,
      this.verdictSlot,
      this.safeSlot,
    )
    // 建出来是藏着的：一张结果卡是跟着 `settle-row` cue 一条条淡入的，不是一上来就都在。
    this.alpha = 0
  }

  /** 淡入。返回时长（毫秒）由调用方从 `SETTLE_ROW_IN_MS` 取——这里只管演。 */
  appear(durationMs: number): void {
    this.deps.animator.fromTo(
      this,
      { alpha: 0 },
      { alpha: 1, duration: durationMs / 1000, ease: 'power2.out', overwrite: 'auto' },
    )
  }

  /**
   * 开口作答：转圈淡出 → 大字答案打字 → 小字推理打字。
   *
   * `durationMs` 是这一整段的时长（编排层按字数算好的，见 `settle-typing` cue）。
   * 两段字各分多少由字数按比例摊，用的是编排层算总长时的那三个常量本身——
   * 抄一份数字过来的话，改了 timings 而忘了改这里，两边就会走岔：编排层排好的那一格
   * 还是那么长，格子里两段字的分界却挪了位。
   */
  startTyping(answer: string, reasoning: string, durationMs: number): void {
    this.fadeLoader()
    const answerWeight = answer.length * SETTLE_ANSWER_CHAR_MS
    const reasoningWeight = Math.min(
      reasoning.length * SETTLE_REASONING_CHAR_MS,
      SETTLE_REASONING_MAX_MS,
    )
    // 两段都是空串时分母会是 0，垫一个挡住除零；那种情况下两段的时长本来也都是 0。
    const totalWeight = Math.max(answerWeight + reasoningWeight, 1)
    const usable = Math.max(0, durationMs / 1000 - SETTLE_LOADER_FADE_MS / 1000)
    const answerDur = usable * (answerWeight / totalWeight)

    const startAt = SETTLE_LOADER_FADE_MS / 1000
    this.typeInto(this.answerSlot, answer, TYPE.answer, tokens.color.battle.ink, answerDur, startAt)
    this.typeInto(
      this.reasoningSlot,
      reasoning,
      TYPE.reasoning,
      tokens.color.battle.inkMuted,
      usable - answerDur,
      startAt + answerDur,
    )
  }

  /**
   * 盖判定章。`safePassed` 为真时紧接着还要补一枚「保送留场」。
   * 返回时长（毫秒），和 `settle-stamp` cue 的 `durationMs` 一致。
   */
  stamp(correct: boolean, safePassed: boolean): number {
    this.fadeLoader()
    const block = this.buildVerdict(correct)
    this.verdictSlot.addChild(block)
    const duration = SETTLE_STAMP_MS / 1000
    block.scale.set(VERDICT.fromScale)
    block.alpha = 0
    // 从大缩到原大 + 淡入，就是"盖章"那一下：章是从上方压下来的，先大后小才有距离感。
    this.deps.animator.tween(block, { alpha: 1, duration, ease: 'power2.out' })
    this.deps.animator.tween(block.scale, { x: 1, y: 1, duration, ease: 'back.out(1.4)' })
    if (safePassed) this.addSafeBadge(duration)
    return SETTLE_STAMP_MS
  }

  /** 底板：一块圆角纸，一圈细边。 */
  private buildPlate(): Graphics {
    return new Graphics()
      .roundRect(0, 0, BOX.width, BOX.height, tokens.radius.lg)
      .fill({ color: tokens.color.battle.paper })
      .stroke({ width: 1, color: tokens.color.battle.line })
  }

  /** 左边那张迷你卡面。整张卡缩到 77 宽，字和插画跟着一起变小。 */
  private mountAvatar(card: CardSprite): Container {
    const holder = new Container()
    const scale = BOX.avatarWidth / CARD_WIDTH
    card.scale.set(scale)
    // 卡的原点在底边中点，所以摆的是卡脚的位置。
    card.position.set(BOX.pad + BOX.avatarWidth / 2, BOX.height - BOX.pad)
    holder.addChild(card)
    return holder
  }

  /** 三个跳动的点。答完就淡出（见 fadeLoader）。 */
  private buildLoader(x: number): void {
    for (let i = 0; i < 3; i += 1) {
      const dot = new Graphics()
        .circle(0, 0, LOADER.dot / 2)
        .fill({ color: tokens.color.battle.inkMuted })
      dot.position.set(x + i * (LOADER.dot + LOADER.gap), BOX.height / 2)
      this.loader.addChild(dot)
      this.deps.animator.tween(dot, {
        y: dot.y - LOADER.rise,
        duration: LOADER.dur,
        delay: i * (LOADER.dur / 3),
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    }
  }

  /**
   * 收掉那三个点。
   *
   * 必须把补间也停掉：它们是 `repeat: -1` 的，自己永远不会结束，
   * 留着帧循环就一直认为「还有东西在动」，停不下来（3.6）。
   */
  private fadeLoader(): void {
    if (!this.loader.visible) return
    for (const dot of this.loader.children) this.deps.animator.killTweensOf(dot)
    this.deps.animator.tween(this.loader, {
      alpha: 0,
      duration: SETTLE_LOADER_FADE_MS / 1000,
      ease: 'power2.in',
      onComplete: () => {
        this.loader.visible = false
      },
    })
  }

  /**
   * 把一段字「打」进某个位置：整段先烤一张纹理，再用遮罩逐字露出来。
   *
   * 遮罩是一张白色精灵，动的只有它的 `scale.x`；缓动用 `steps(字数)`，
   * 于是它不是平滑滑过去而是一格一格跳，一格正好一个字。
   * 空串直接不建——`steps(0)` 在 GSAP 里是非法的。
   */
  private typeInto(
    slot: Container,
    content: string,
    style: { fontSize: number; letterSpacing: number; weight?: '400' | '600' | '700' },
    color: string,
    duration: number,
    delay: number,
  ): void {
    if (content.length === 0) return
    const label = new Label(
      content,
      {
        fontSize: style.fontSize,
        letterSpacing: style.letterSpacing,
        weight: style.weight,
        align: 'left',
        maxWidth: BOX.width - slot.x - BOX.pad,
      },
      this.deps,
      color,
    )
    slot.addChild(label)

    const mask = new Sprite(Texture.WHITE)
    mask.anchor.set(0, 0.5)
    // 遮罩要比字高一点：字形的上下沿会探出纹理的中线一截，贴着切会削掉笔画。
    mask.setSize(label.textWidth, label.textHeight * 1.6)
    /*
     * 白色纹理是 1×1 的，「铺满这段字」本身就是靠 scale 做到的：setSize 之后 scale.x
     * 等于字的像素宽，不是 1。补间的终点得取这个数——写死 1 的话打完字只露出一个像素。
     */
    const full = mask.scale.x
    mask.scale.x = 0
    slot.addChild(mask)
    label.mask = mask

    this.deps.animator.tween(mask.scale, {
      x: full,
      duration: Math.max(duration, 0.001),
      delay,
      ease: `steps(${content.length})`,
    })
  }

  /**
   * 判定块：一块深色圆角牌，上面「✓ 正确 / ✗ 错误」，歪 6° 压在卡的右上角。
   *
   * 尺寸跟着字走（左右各留 18、上下各留 8），不写死宽高：需求单上量到的 172×110
   * 是连影子和周围留白一起量的，照它画出来那枚章能盖住半张卡，把答案和推理全糊掉。
   * 旧样式 `.settle-card__verdict` 才是准的——它本来就是一块「文字 + 内边距」的牌子。
   */
  private buildVerdict(correct: boolean): Container {
    const block = new Container()
    const fill = correct ? tokens.color.theme.forest : tokens.color.theme.brick
    const label = new Label(
      correct ? '✓ 正确' : '✗ 错误',
      TYPE.verdict,
      this.deps,
      tokens.color.battle.paper,
    )
    const width = Math.round(label.textWidth) + VERDICT.padX * 2
    const height = Math.round(label.textHeight) + VERDICT.padY * 2
    block.addChild(
      new Graphics()
        .roundRect(-width / 2, -height / 2, width, height, tokens.radius.sm)
        .fill({ color: fill }),
      label,
    )
    block.position.set(BOX.width - VERDICT.inset - width / 2, VERDICT.inset + height / 2)
    block.rotation = (VERDICT.tiltDeg * Math.PI) / 180
    return block
  }

  /**
   * 「保送留场」那枚小标，跟在判定块之后补上来，贴在它正下方。
   *
   * 做得比判定块小一号、也不歪：判定仍然是「错」，这条只是补一句「但它留下了」，
   * 抢过那枚章的话玩家会以为这张卡答对了。配色直接用战场小卡角标那档青色（徽章 D 的 safe），
   * 旧样式里这两处本来就是同一组值。
   */
  private addSafeBadge(delay: number): void {
    const badge = new Badge({ variant: 'D', text: '保送留场', tone: 'safe' }, this.deps)
    badge.position.set(BOX.width - VERDICT.inset - badge.boxWidth, SAFE_TOP)
    badge.alpha = 0
    this.safeSlot.addChild(badge)
    this.deps.animator.tween(badge, {
      alpha: 1,
      duration: SETTLE_STAMP_MS / 1000,
      delay,
      ease: 'power2.out',
    })
  }
}
