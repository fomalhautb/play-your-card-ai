/**
 * 结算层里的一张作答结果卡：左边一张迷你卡面，右边模型名、回答和理由，
 * 判定块盖上来，答完之前先摆三个跳动的点。
 *
 * 正式版简化第 4 步之二把底板、判定块和「保送留场」剥成素方块（见 components/Box.ts），
 * 宽度也从定死的 444 改回黑客松版那套**弹性**的：一侧几张就分几列，每列不窄于
 * `size.settle.cardMinWidth`（300），列间距 14。打进去的回答和理由仍然走 `Label`——
 * 那两段是**打字机**（见 typeInto），素方块换字是换整张纹理，做不了逐字露出。
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
import { Container, Graphics } from 'pixi.js'
import {
  SETTLE_ANSWER_CHAR_MS,
  SETTLE_LOADER_FADE_MS,
  SETTLE_REASONING_CHAR_MS,
  SETTLE_REASONING_MAX_MS,
  SETTLE_STAMP_MS,
} from '../director/timings'
import { CARD_WIDTH } from '../layout/fanMath'
import type { Animator } from '../runtime/animator'
import type { TextTextureCache } from '../runtime/textCache'
import { Box, type BoxDeps } from './Box'
import type { CardSprite } from './CardSprite'
import { Label } from './Label'

/**
 * 这张卡自己的几何和字号（px）。组件私有，理由见 design 的 README。
 * 高、内边距、头像宽和字号照旧；宽改成**下限**，真实宽度由 `SettleSquad` 按这一侧几张算。
 */
const BOX = {
  minWidth: tokens.size.settle.cardMinWidth as number,
  height: 154,
  pad: 14,
  avatarWidth: 77,
  gap: 14,
} as const
const TYPE = {
  name: { fontSize: 18, letterSpacing: 0 },
  answer: { fontSize: 30, letterSpacing: 0, weight: '700' },
  reasoning: { fontSize: tokens.font.size.base, letterSpacing: 0 },
  verdict: { fontSize: 20, letterSpacing: 1.2, weight: '700' },
} as const
/**
 * 判定块那一格的尺寸、离卡角多远、盖下来时的起始缩放和倾角。
 * 位置和倾角抄旧样式 `.settle-card__verdict`（top/right 8、rotate −6deg）；
 * 宽高写死是因为素方块的字会自己缩，不像从前那样要跟着文案量。
 */
const VERDICT = { width: 96, height: 36, inset: 8, fromScale: 1.6, tiltDeg: -6 } as const
/** 「保送留场」那条小签的尺寸和它离卡上沿多远。抄旧样式 `.settle-card__safe` 的 `top: 52px`。 */
const SAFE = { width: 80, height: 20, top: 52 } as const
/**
 * 三个等待点的直径、间距和跳多高。跳一次多久走令牌——它是「有人在想」这件事的节奏，
 * 和展示层的浮动、选目标的压暗同属一档环境动画，一起改才不会有一处快一处慢。
 */
const LOADER = { dot: 7, gap: 7, rise: 6, dur: tokens.duration.settle.dots } as const

export type SettleRowDeps = BoxDeps & {
  text: TextTextureCache
  animator: Animator
}

export class SettleRow extends Container {
  readonly rowId: string
  /** 这一张现在多宽。一侧多一张卡，整排的列宽就重算一次（见 `setWidth`）。 */
  boxWidth = BOX.minWidth
  readonly boxHeight = BOX.height

  private readonly deps: SettleRowDeps
  private readonly plate: Box
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

    this.plate = new Box({ width: BOX.minWidth, height: BOX.height }, deps)
    this.addChild(this.plate)
    this.addChild(this.mountAvatar(card))
    const bodyX = BOX.pad + BOX.avatarWidth + BOX.gap
    const nameLabel = new Label(
      name,
      { ...TYPE.name, align: 'left', maxWidth: BOX.minWidth - bodyX - BOX.pad },
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

  /**
   * 改这一张的宽。
   *
   * 只动底板和右上角那两块——右边那几段字是按**最小列宽**烤的（见构造函数和 typeInto），
   * 列变宽了它们只是右边多出一截空白，不会溢出；而打字机正在演的时候重烤一张纹理，
   * 会当场把已经露出来的那半句吞回去。
   */
  setWidth(width: number): void {
    if (width === this.boxWidth) return
    this.boxWidth = width
    this.plate.setSize(width, BOX.height)
    this.placeCorner()
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
    this.placeCorner()
    const duration = SETTLE_STAMP_MS / 1000
    block.scale.set(VERDICT.fromScale)
    block.alpha = 0
    // 从大缩到原大 + 淡入，就是"盖章"那一下：章是从上方压下来的，先大后小才有距离感。
    this.deps.animator.tween(block, { alpha: 1, duration, ease: 'power2.out' })
    this.deps.animator.tween(block.scale, { x: 1, y: 1, duration, ease: 'back.out(1.4)' })
    if (safePassed) this.addSafeBadge(duration)
    return SETTLE_STAMP_MS
  }

  /** 判定块和「保送留场」都贴着卡的右上角，卡一变宽就要重新摆。 */
  private placeCorner(): void {
    const verdict = this.verdictSlot.children[0]
    verdict?.position.set(
      this.boxWidth - VERDICT.inset - VERDICT.width / 2,
      VERDICT.inset + VERDICT.height / 2,
    )
    const safe = this.safeSlot.children[0]
    safe?.position.set(this.boxWidth - VERDICT.inset - SAFE.width, SAFE.top)
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
        // 按**最小列宽**烤：列可能后来被别的卡挤窄，按当前宽烤的话那时就溢出了。
        maxWidth: BOX.minWidth - slot.x - BOX.pad,
      },
      this.deps,
      color,
    )
    slot.addChild(label)

    /*
     * 打字机走的是「裁掉右边」而不是上一层遮罩，理由见 Label.setReveal：
     * Sprite 遮罩要离屏渲染（违反 3.1），Graphics 遮罩要每帧动模板缓冲（软件渲染下慢十倍）。
     *
     * GSAP 补的是一个数字代理，再由 onUpdate 把它交给 Label——`steps()` 缓动让这个数
     * 一格一格跳，跳几格就是几个字，和逐字打出来是同一件事。
     */
    label.setReveal(0)
    const progress = { value: 0 }
    this.deps.animator.tween(progress, {
      value: 1,
      duration: Math.max(duration, 0.001),
      delay,
      ease: `steps(${content.length})`,
      onUpdate: () => label.setReveal(progress.value),
    })
  }

  /**
   * 判定块：一块印着「✓ 正确 / ✗ 错误」的方块，歪 6° 压在卡的右上角。
   *
   * 轴放在它自己的中心：盖章那一下是「从大缩到原大」，pivot 留在左上角的话，
   * 章会从右下方甩进来而不是压下来；歪那 6° 同理要绕中心转。
   */
  private buildVerdict(correct: boolean): Container {
    const block = new Box(
      { width: VERDICT.width, height: VERDICT.height, label: correct ? '正确' : '错误' },
      this.deps,
    )
    block.pivot.set(VERDICT.width / 2, VERDICT.height / 2)
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
    const badge = new Box(
      { width: SAFE.width, height: SAFE.height, label: '保送留场', size: 'small' },
      this.deps,
    )
    badge.alpha = 0
    this.safeSlot.addChild(badge)
    this.placeCorner()
    this.deps.animator.tween(badge, {
      alpha: 1,
      duration: SETTLE_STAMP_MS / 1000,
      delay,
      ease: 'power2.out',
    })
  }
}
